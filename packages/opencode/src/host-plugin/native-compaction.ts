import type {
  ChatHeadersInput,
  ChatHeadersOutput,
  ChatMessageInput,
  CompactionHookOutput,
  PluginInput,
  PluginMessageGroup,
} from "./types";

const REQUEST_MARKER = "<honk_native_compaction_v2/>";
const CHECKPOINT_START = "<honk_native_compaction_v2>";
const CHECKPOINT_END = "</honk_native_compaction_v2>";
const REMOTE_COMPACTION_FEATURE = "remote_compaction_v2";
// OpenCode's cached OpenAI transport interprets this private header as
// "use HTTP for this turn" and removes it before the request reaches OpenAI.
const FORCE_HTTP_HEADER = "x-opencode-title";

type JsonRecord = Record<string, unknown>;

interface NativeCompactionCheckpoint {
  readonly version: 1;
  readonly provider: "openai";
  readonly endpoint: string;
  readonly model: string;
  readonly responseID?: string;
  readonly boundary?: string;
  readonly output: JsonRecord;
}

interface NativeCompactionFetchState {
  readonly loadedSessions: Set<string>;
  readonly pending: Map<string, NativeCompactionCheckpoint | null>;
  readonly checkpoints: Map<string, NativeCompactionCheckpoint>;
  readonly rollback: Map<string, NativeCompactionCheckpoint | null>;
  readonly fallbackPending: Set<string>;
}

interface ParsedCompactionResponse {
  readonly checkpoint: NativeCompactionCheckpoint;
  readonly completedResponse: JsonRecord;
}

interface NativeCompactionRuntime {
  observeMessage(input: ChatMessageInput): Promise<void>;
  prepareCompaction(sessionID: string, output: CompactionHookOutput): Promise<void>;
  prepareHeaders(input: ChatHeadersInput, output: ChatHeadersOutput): Promise<void>;
  complete(sessionID: string): void;
  fail(sessionID: string): void;
  remove(sessionID: string): void;
  dispose(): void;
}

const runtimes = new Set<NativeCompactionFetchState>();
let originalFetch: typeof fetch | undefined;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const candidate = record(value)?.[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function normalizeEndpoint(input: RequestInfo | URL): string | undefined {
  try {
    const url =
      input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return undefined;
  }
}

function headersFrom(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers);
}

function sessionIDFromRequest(body: JsonRecord, headers: Headers): string | undefined {
  return (
    headers.get("session-id") ??
    headers.get("x-session-id") ??
    headers.get("x-session-affinity") ??
    stringField(body, "prompt_cache_key")
  );
}

function requestBody(init: RequestInit | undefined): JsonRecord | undefined {
  if (typeof init?.body !== "string") return undefined;
  try {
    return record(JSON.parse(init.body));
  } catch {
    return undefined;
  }
}

function inputText(item: unknown): string {
  const value = record(item);
  if (value === undefined) return "";
  if (typeof value.content === "string") return value.content;
  if (!Array.isArray(value.content)) return "";
  return value.content
    .map((part) => stringField(part, "text") ?? "")
    .filter(Boolean)
    .join("\n");
}

function inputItems(body: JsonRecord): unknown[] | undefined {
  return Array.isArray(body.input) ? body.input : undefined;
}

function inputFingerprint(value: unknown): string {
  // OpenCode filters the previous summary pair before a later compaction but
  // still serializes the older head. Remember its last item so the next native
  // request can send only checkpoint + newly compactable history.
  const text = JSON.stringify(value) ?? "undefined";
  const hash = text
    .split("")
    .reduce(
      (current, character) => Math.imul(current ^ character.charCodeAt(0), 16_777_619),
      2_166_136_261,
    );
  return `${text.length.toString(36)}:${(hash >>> 0).toString(36)}`;
}

function withRemoteCompactionFeature(headers: Headers): Headers {
  const features = (headers.get("x-codex-beta-features") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!features.includes(REMOTE_COMPACTION_FEATURE)) {
    features.push(REMOTE_COMPACTION_FEATURE);
  }
  headers.set("x-codex-beta-features", features.join(","));
  return headers;
}

function canonicalCompactionOutput(value: unknown): JsonRecord | undefined {
  const item = record(value);
  if (
    item === undefined ||
    (item.type !== "compaction" && item.type !== "compaction_summary") ||
    typeof item.encrypted_content !== "string" ||
    item.encrypted_content.trim().length === 0
  ) {
    return undefined;
  }
  if (item.id !== undefined && item.id !== null && typeof item.id !== "string") {
    return undefined;
  }
  const metadata = item.internal_chat_message_metadata_passthrough;
  if (
    metadata !== undefined &&
    metadata !== null &&
    (record(metadata) === undefined ||
      (record(metadata)?.turn_id !== undefined &&
        record(metadata)?.turn_id !== null &&
        typeof record(metadata)?.turn_id !== "string"))
  ) {
    return undefined;
  }
  return {
    type: "compaction",
    ...(typeof item.id === "string" ? { id: item.id } : {}),
    encrypted_content: item.encrypted_content,
    ...(record(metadata) === undefined
      ? {}
      : {
          internal_chat_message_metadata_passthrough:
            typeof record(metadata)?.turn_id === "string"
              ? { turn_id: record(metadata)?.turn_id }
              : {},
        }),
  };
}

function parseSseEvents(text: string): JsonRecord[] {
  return text.split(/\r?\n\r?\n/).flatMap((block): JsonRecord[] => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .join("\n");
    if (data.length === 0 || data === "[DONE]") return [];
    try {
      const parsed = record(JSON.parse(data));
      return parsed === undefined ? [] : [parsed];
    } catch {
      return [];
    }
  });
}

async function parseCompactionResponse(
  response: Response,
  input: { readonly endpoint: string; readonly model: string; readonly boundary?: string },
): Promise<ParsedCompactionResponse | undefined> {
  if (!response.ok) return undefined;
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const events = contentType.includes("text/event-stream")
    ? parseSseEvents(text)
    : (() => {
        try {
          const parsed = record(JSON.parse(text));
          return parsed === undefined ? [] : [parsed];
        } catch {
          return [];
        }
      })();
  const completed = events.findLast((event) => event.type === "response.completed");
  const completedResponse =
    record(completed?.response) ??
    (events.length === 1 && Array.isArray(events[0]?.output) ? events[0] : undefined);
  const responseID = stringField(completedResponse, "id");
  if (completedResponse === undefined || responseID === undefined) {
    return undefined;
  }
  const streamed = events
    .flatMap((event) => (event.type === "response.output_item.done" ? [event.item] : []))
    .map(canonicalCompactionOutput)
    .filter((item): item is JsonRecord => item !== undefined);
  const completedOutput = (Array.isArray(completedResponse.output) ? completedResponse.output : [])
    .map(canonicalCompactionOutput)
    .filter((item): item is JsonRecord => item !== undefined);
  if (streamed.length > 1 || completedOutput.length > 1) return undefined;
  const output = streamed[0] ?? completedOutput[0];
  if (
    output === undefined ||
    (streamed[0] !== undefined &&
      completedOutput[0] !== undefined &&
      JSON.stringify(streamed[0]) !== JSON.stringify(completedOutput[0]))
  ) {
    return undefined;
  }
  return {
    checkpoint: {
      version: 1,
      provider: "openai",
      endpoint: input.endpoint,
      model: input.model,
      responseID,
      ...(input.boundary === undefined ? {} : { boundary: input.boundary }),
      output,
    },
    completedResponse,
  };
}

function checkpointMarker(checkpoint: NativeCompactionCheckpoint): string {
  return `${CHECKPOINT_START}${JSON.stringify(checkpoint)}${CHECKPOINT_END}`;
}

function parseCheckpoint(value: string): NativeCompactionCheckpoint | undefined {
  const start = value.indexOf(CHECKPOINT_START);
  if (start === -1) return undefined;
  const end = value.indexOf(CHECKPOINT_END, start + CHECKPOINT_START.length);
  if (end === -1) return undefined;
  try {
    const parsed = record(JSON.parse(value.slice(start + CHECKPOINT_START.length, end)));
    const output = canonicalCompactionOutput(parsed?.output);
    if (
      parsed?.version !== 1 ||
      parsed.provider !== "openai" ||
      typeof parsed.endpoint !== "string" ||
      typeof parsed.model !== "string" ||
      output === undefined ||
      (parsed.responseID !== undefined && typeof parsed.responseID !== "string") ||
      (parsed.boundary !== undefined && typeof parsed.boundary !== "string")
    ) {
      return undefined;
    }
    return {
      version: 1,
      provider: "openai",
      endpoint: parsed.endpoint,
      model: parsed.model,
      ...(typeof parsed.responseID === "string" ? { responseID: parsed.responseID } : {}),
      ...(typeof parsed.boundary === "string" ? { boundary: parsed.boundary } : {}),
      output,
    };
  } catch {
    return undefined;
  }
}

function checkpointFromInput(input: readonly unknown[]):
  | {
      readonly checkpoint: NativeCompactionCheckpoint;
      readonly index: number;
    }
  | undefined {
  for (let index = input.length - 1; index >= 0; index--) {
    if (record(input[index])?.role !== "assistant") continue;
    const checkpoint = parseCheckpoint(inputText(input[index]));
    if (checkpoint !== undefined) return { checkpoint, index };
  }
  return undefined;
}

function stripCompactionMarkers(item: unknown): unknown {
  const strip = (text: string) =>
    text
      .replaceAll(REQUEST_MARKER, "")
      .replace(/<honk_native_compaction_v2>[\s\S]*?<\/honk_native_compaction_v2>/g, "");
  const value = record(item);
  if (value === undefined) return item;
  if (typeof value.content === "string") {
    return { ...value, content: strip(value.content) };
  }
  if (!Array.isArray(value.content)) return item;
  return {
    ...value,
    content: value.content.map((part) => {
      const content = record(part);
      if (content === undefined || typeof content.text !== "string") return part;
      return { ...content, text: strip(content.text) };
    }),
  };
}

function requestMarkerIndex(input: readonly unknown[]): number {
  return input.findLastIndex((item) => inputText(item).includes(REQUEST_MARKER));
}

function historySinceCheckpoint(
  input: readonly unknown[],
  previous: NativeCompactionCheckpoint | null,
): readonly unknown[] | undefined {
  if (previous === null) return input;
  if (previous.boundary !== undefined) {
    const boundary = input.findLastIndex((item) => inputFingerprint(item) === previous.boundary);
    return boundary === -1 ? undefined : input.slice(boundary + 1);
  }
  const persisted = checkpointFromInput(input);
  return persisted === undefined ? input : input.slice(persisted.index + 1);
}

function nativeCompactionRequest(
  body: JsonRecord,
  previous: NativeCompactionCheckpoint | null,
): JsonRecord | undefined {
  const input = inputItems(body);
  if (input === undefined) return undefined;
  const markerIndex = requestMarkerIndex(input);
  if (markerIndex === -1) return undefined;
  const history = input.slice(0, markerIndex);
  const next = historySinceCheckpoint(history, previous);
  if (next === undefined) return undefined;
  return {
    ...body,
    input: [
      ...(previous === null ? [] : [structuredClone(previous.output)]),
      ...next,
      ...input.slice(markerIndex + 1),
      { type: "compaction_trigger" },
    ],
  };
}

function fallbackCompactionRequest(
  body: JsonRecord,
  previous: NativeCompactionCheckpoint | null,
): JsonRecord {
  const input = inputItems(body);
  if (input === undefined) return body;
  const markerIndex = requestMarkerIndex(input);
  if (markerIndex === -1) return body;
  const history = input.slice(0, markerIndex);
  const next = historySinceCheckpoint(history, previous) ?? history;
  return {
    ...body,
    input: [
      ...(previous === null ? [] : [structuredClone(previous.output)]),
      ...next,
      stripCompactionMarkers(input[markerIndex]),
      ...input.slice(markerIndex + 1),
    ],
  };
}

function replayRequest(
  body: JsonRecord,
  checkpoint: NativeCompactionCheckpoint,
  markerIndex: number,
): JsonRecord {
  const input = inputItems(body) ?? [];
  return {
    ...body,
    input: [structuredClone(checkpoint.output), ...input.slice(markerIndex + 1)],
  };
}

function errorResponse(message: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        type: "invalid_request_error",
        code: "honk_native_compaction_mismatch",
        message,
      },
    }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

function fakeSummaryResponse(
  checkpoint: NativeCompactionCheckpoint,
  completedResponse: JsonRecord,
): Response {
  // Let OpenCode finish its ordinary compaction lifecycle and persist the
  // opaque checkpoint inside the summary record it already knows how to keep.
  const messageID = `msg_honk_compaction_${Date.now().toString(36)}`;
  const marker = checkpointMarker(checkpoint);
  const responseID = checkpoint.responseID ?? `resp_honk_compaction_${Date.now().toString(36)}`;
  const model = checkpoint.model;
  const message = {
    type: "message",
    id: messageID,
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text: marker, annotations: [] }],
  };
  const events = [
    {
      type: "response.created",
      response: {
        id: responseID,
        created_at: Math.floor(Date.now() / 1_000),
        model,
        status: "in_progress",
        output: [],
      },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...message, status: "in_progress", content: [] },
    },
    {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      item_id: messageID,
      delta: marker,
      logprobs: [],
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: message,
    },
    {
      type: "response.completed",
      response: {
        ...completedResponse,
        id: responseID,
        model,
        status: "completed",
        incomplete_details: null,
        output: [message],
        usage: record(completedResponse.usage) ?? {
          input_tokens: 0,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 0,
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    },
  ];
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
}

function isCodexCompactionEndpoint(endpoint: string): boolean {
  return (
    endpoint.endsWith("/backend-api/codex/responses") || endpoint.endsWith("/api/codex/responses")
  );
}

async function attemptNativeCompaction(input: {
  readonly delegate: typeof fetch;
  readonly resource: RequestInfo | URL;
  readonly init: RequestInit | undefined;
  readonly request: JsonRecord;
  readonly headers: Headers;
  readonly endpoint: string;
  readonly model: string;
  readonly boundary?: string;
}): Promise<ParsedCompactionResponse | undefined> {
  try {
    return parseCompactionResponse(
      await input.delegate(input.resource, {
        ...input.init,
        body: JSON.stringify(input.request),
        headers: withRemoteCompactionFeature(input.headers),
      }),
      {
        endpoint: input.endpoint,
        model: input.model,
        ...(input.boundary === undefined ? {} : { boundary: input.boundary }),
      },
    );
  } catch (error) {
    if (
      input.init?.signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw error;
    }
    return undefined;
  }
}

export function createNativeCompactionFetch(
  resolveState: (sessionID: string) => NativeCompactionFetchState | undefined,
  delegate: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    const endpoint = normalizeEndpoint(input);
    const body = requestBody(init);
    if (
      endpoint === undefined ||
      body === undefined ||
      init?.method !== "POST" ||
      !endpoint.endsWith("/responses")
    ) {
      return delegate(input, init);
    }
    const headers = headersFrom(init);
    const sessionID = sessionIDFromRequest(body, headers);
    if (sessionID === undefined) return delegate(input, init);
    const state = resolveState(sessionID);
    if (state === undefined) return delegate(input, init);

    const markerIndex = requestMarkerIndex(inputItems(body) ?? []);
    if (markerIndex === -1) state.pending.delete(sessionID);
    if (markerIndex !== -1 && state.pending.has(sessionID)) {
      const previous = state.pending.get(sessionID) ?? null;
      const model = stringField(body, "model");
      if (previous !== null && (previous.endpoint !== endpoint || previous.model !== model)) {
        return errorResponse(
          `Honk cannot compact this native checkpoint through ${endpoint} with model ${String(model)}; it is bound to ${previous.endpoint} with model ${previous.model}.`,
        );
      }
      const request = nativeCompactionRequest(body, previous);
      if (request !== undefined && isCodexCompactionEndpoint(endpoint)) {
        const parsed =
          model === undefined
            ? undefined
            : await attemptNativeCompaction({
                delegate,
                resource: input,
                init,
                request,
                headers,
                endpoint,
                model,
                ...(markerIndex === 0
                  ? previous?.boundary === undefined
                    ? {}
                    : { boundary: previous.boundary }
                  : {
                      boundary: inputFingerprint((inputItems(body) ?? [])[markerIndex - 1]),
                    }),
              });
        if (parsed !== undefined) {
          state.pending.delete(sessionID);
          state.rollback.set(sessionID, previous);
          state.fallbackPending.delete(sessionID);
          state.checkpoints.set(sessionID, parsed.checkpoint);
          return fakeSummaryResponse(parsed.checkpoint, parsed.completedResponse);
        }
      }

      state.pending.delete(sessionID);
      state.rollback.delete(sessionID);
      state.fallbackPending.add(sessionID);
      if (previous === null) state.checkpoints.delete(sessionID);
      else state.checkpoints.set(sessionID, previous);
      const fallback = fallbackCompactionRequest(body, previous);
      return delegate(input, {
        ...init,
        body: JSON.stringify(fallback),
        headers: previous === null ? headers : withRemoteCompactionFeature(headers),
      });
    }

    const checkpoint = state.checkpoints.get(sessionID);
    if (checkpoint === undefined) return delegate(input, init);
    const persisted = checkpointFromInput(inputItems(body) ?? []);
    if (persisted === undefined) return delegate(input, init);
    if (checkpointMarker(persisted.checkpoint) !== checkpointMarker(checkpoint)) {
      return errorResponse(
        "Honk refused a compacted-session marker that does not match the persisted checkpoint.",
      );
    }
    if (checkpoint.endpoint !== endpoint) {
      return errorResponse(
        `Honk cannot replay this compacted session through ${endpoint}; it was compacted through ${checkpoint.endpoint}.`,
      );
    }
    if (checkpoint.model !== body.model) {
      return errorResponse(
        `Honk cannot replay this compacted session with model ${String(body.model)}; it was compacted with ${checkpoint.model}.`,
      );
    }
    return delegate(input, {
      ...init,
      body: JSON.stringify(replayRequest(body, checkpoint, persisted.index)),
      headers: withRemoteCompactionFeature(headers),
    });
  };
}

function installFetchInterceptor(): void {
  if (originalFetch !== undefined) return;
  // The bundled Honk plugin initializes before OpenCode creates its cached
  // OpenAI HTTP fallback, so that transport captures this narrow interceptor.
  originalFetch = globalThis.fetch;
  globalThis.fetch = createNativeCompactionFetch(
    (sessionID) =>
      [...runtimes].findLast(
        (state) =>
          state.pending.has(sessionID) ||
          state.checkpoints.has(sessionID) ||
          state.loadedSessions.has(sessionID),
      ),
    originalFetch,
  );
}

function checkpointFromMessages(
  messages: readonly PluginMessageGroup[],
): NativeCompactionCheckpoint | undefined {
  for (const message of [...messages].reverse()) {
    if (
      message.info.role !== "assistant" ||
      message.info.summary !== true ||
      typeof message.info.finish !== "string" ||
      (message.info.error !== undefined && message.info.error !== null)
    ) {
      continue;
    }
    for (const part of [...message.parts].reverse()) {
      if (part.type !== "text" || typeof part.text !== "string") continue;
      const checkpoint = parseCheckpoint(part.text);
      if (checkpoint !== undefined) return checkpoint;
    }
    // Only the newest completed compaction is active. A later plain-text
    // fallback deliberately supersedes any older native checkpoint.
    return undefined;
  }
  return undefined;
}

function providerFromMessages(messages: readonly PluginMessageGroup[]): string | undefined {
  for (const message of [...messages].reverse()) {
    if (message.info.role !== "user") continue;
    const model = record(message.info.model);
    const providerID = stringField(model, "providerID");
    if (providerID !== undefined) return providerID;
  }
  return undefined;
}

export function createNativeCompactionRuntime(plugin: PluginInput): NativeCompactionRuntime {
  const state: NativeCompactionFetchState = {
    loadedSessions: new Set(),
    pending: new Map(),
    checkpoints: new Map(),
    rollback: new Map(),
    fallbackPending: new Set(),
  };
  const modelProviderBySession = new Map<string, string>();
  runtimes.add(state);
  installFetchInterceptor();

  const loadSession = async (sessionID: string) => {
    if (state.loadedSessions.has(sessionID)) return;
    const result = await plugin.client.session.messages({
      path: { id: sessionID },
      query: { directory: plugin.directory },
    });
    if (result.data === undefined) {
      throw new Error(`honk: failed to inspect session ${sessionID} for native compaction.`);
    }
    const checkpoint = checkpointFromMessages(result.data);
    if (checkpoint !== undefined) state.checkpoints.set(sessionID, checkpoint);
    const providerID = providerFromMessages(result.data);
    if (providerID !== undefined) modelProviderBySession.set(sessionID, providerID);
    state.loadedSessions.add(sessionID);
  };

  return {
    async observeMessage(input) {
      await loadSession(input.sessionID);
      if (input.model !== undefined) {
        modelProviderBySession.set(input.sessionID, input.model.providerID);
      }
    },
    async prepareCompaction(sessionID, output) {
      await loadSession(sessionID);
      if (modelProviderBySession.get(sessionID) !== "openai") return;
      state.pending.set(sessionID, state.checkpoints.get(sessionID) ?? null);
      if (!output.context.includes(REQUEST_MARKER)) output.context.push(REQUEST_MARKER);
    },
    async prepareHeaders(input, output) {
      await loadSession(input.sessionID);
      const checkpoint = state.checkpoints.get(input.sessionID);
      if (checkpoint !== undefined && input.model.providerID !== "openai") {
        throw new Error(
          `honk: session ${input.sessionID} contains an OpenAI native compaction checkpoint and cannot switch to ${input.model.providerID}/${input.model.id}.`,
        );
      }
      if (state.pending.has(input.sessionID) && input.model.providerID !== "openai") {
        state.pending.delete(input.sessionID);
        return;
      }
      if (checkpoint === undefined && !state.pending.has(input.sessionID)) return;
      output.headers[FORCE_HTTP_HEADER] = "true";
      const headers = withRemoteCompactionFeature(new Headers(output.headers));
      output.headers["x-codex-beta-features"] =
        headers.get("x-codex-beta-features") ?? REMOTE_COMPACTION_FEATURE;
    },
    complete(sessionID) {
      if (state.fallbackPending.delete(sessionID)) state.checkpoints.delete(sessionID);
      state.rollback.delete(sessionID);
      state.pending.delete(sessionID);
    },
    fail(sessionID) {
      if (state.rollback.has(sessionID)) {
        const previous = state.rollback.get(sessionID) ?? null;
        if (previous === null) state.checkpoints.delete(sessionID);
        else state.checkpoints.set(sessionID, previous);
      }
      state.rollback.delete(sessionID);
      state.fallbackPending.delete(sessionID);
      state.pending.delete(sessionID);
    },
    remove(sessionID) {
      state.loadedSessions.delete(sessionID);
      state.pending.delete(sessionID);
      state.checkpoints.delete(sessionID);
      state.rollback.delete(sessionID);
      state.fallbackPending.delete(sessionID);
      modelProviderBySession.delete(sessionID);
    },
    dispose() {
      runtimes.delete(state);
      state.loadedSessions.clear();
      state.pending.clear();
      state.checkpoints.clear();
      state.rollback.clear();
      state.fallbackPending.clear();
      modelProviderBySession.clear();
    },
  };
}

export const nativeCompactionProtocol = {
  checkpointEnd: CHECKPOINT_END,
  checkpointStart: CHECKPOINT_START,
  forceHttpHeader: FORCE_HTTP_HEADER,
  remoteFeature: REMOTE_COMPACTION_FEATURE,
  requestMarker: REQUEST_MARKER,
} as const;
