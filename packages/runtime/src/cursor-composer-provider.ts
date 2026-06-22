import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";
import readline from "node:readline";
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type ImageContent,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type TextContent,
  type ToolCall,
  type Usage,
} from "@earendil-works/pi-ai/base";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_COMPOSER_ACP_MODEL_ID,
  CURSOR_COMPOSER_MODEL_ID,
  CURSOR_COMPOSER_MODEL_NAME,
  CURSOR_PROVIDER_ID,
} from "@honk/shared/cursor-composer";

const CURSOR_API = "cursor-acp";
const CURSOR_ACP_AUTH_SENTINEL = "__honk_cursor_acp_cli_auth__";
const CURSOR_AGENT_BIN_ENV_VAR = "CURSOR_AGENT_BIN";
const CURSOR_API_KEY_ENV_VAR = "CURSOR_API_KEY";
const CURSOR_MODEL_CONTEXT_WINDOW = 128_000;
const CURSOR_MODEL_MAX_TOKENS = 16_384;
const CURSOR_APPROX_CHARS_PER_TOKEN = 4;
const CURSOR_IMAGE_TOKEN_ESTIMATE = 1_200;
const CURSOR_ACP_REQUEST_TIMEOUT_MS = 30_000;
const CURSOR_SYNTHETIC_TOOL_EVENT_ARG = "__honkCursorSyntheticToolEvent";
const CURSOR_SYNTHETIC_TOOL_RESULT_ARG = "__honkCursorResult";

interface CursorComposerProviderOptions {
  readonly cwd: string;
  readonly fastEnabled?: boolean;
}

interface CursorToolEventState {
  readonly contentIndexByCallId: Map<string, number>;
  readonly rawUpdateByCallId: Map<string, Record<string, unknown>>;
  readonly completedCallIds: Set<string>;
  readonly completedFingerprints: Set<string>;
}

interface CursorAcpTurnState {
  pendingPlanMarkdown: string | null;
}

type AssistantContent = AssistantMessage["content"][number];
type JsonRpcId = string | number;

interface JsonRpcPendingRequest {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout> | null;
}

interface JsonRpcChildOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly onNotification?: (method: string, params: unknown) => void;
  readonly onRequest?: (method: string, params: unknown) => Promise<unknown>;
}

interface CursorImage {
  readonly data: string;
  readonly mimeType: string;
}

interface CursorUserMessage {
  readonly text: string;
  readonly images?: readonly CursorImage[];
}

interface AcpTextContentBlock {
  readonly type: "text";
  readonly text: string;
}

interface AcpImageContentBlock {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

type AcpContentBlock = AcpTextContentBlock | AcpImageContentBlock;

class CursorComposerAbortError extends Error {
  constructor() {
    super("Cursor Composer request was aborted.");
  }
}

class JsonRpcResponseError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

class CursorAcpChild {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: readline.Interface;
  private readonly pending = new Map<JsonRpcId, JsonRpcPendingRequest>();
  private readonly stderrChunks: string[] = [];
  private nextId = 1;
  private closed = false;
  private spawnError: Error | null = null;

  constructor(private readonly options: JsonRpcChildOptions) {
    this.child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk: Buffer | string) => {
      this.appendStderr(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });
    this.child.on("error", (error) => {
      this.spawnError = error instanceof Error ? error : new Error(String(error));
      this.rejectAll(this.spawnError);
    });
    this.child.on("exit", (code, signal) => {
      const detail = `Cursor ACP process exited (code=${String(code)}, signal=${String(signal)})`;
      this.rejectAll(new Error(this.stderrText() ? `${detail}: ${this.stderrText()}` : detail));
    });
  }

  request(
    method: string,
    params: unknown,
    timeoutMs: number | null = CURSOR_ACP_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error("Cursor ACP process is already closed."));
    }
    if (this.spawnError) {
      return Promise.reject(this.spawnError);
    }
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timeout =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`Cursor ACP request timed out: ${method}`));
            }, timeoutMs);
      timeout?.unref?.();
      this.pending.set(id, { method, resolve, reject, timeout });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (this.closed || this.spawnError) {
      return;
    }
    this.write({ jsonrpc: "2.0", method, params });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.lines.close();
    this.child.stdin.end();
    this.child.kill();
    this.rejectAll(new Error("Cursor ACP process closed."));
  }

  stderrText(): string {
    return this.stderrChunks.join("").trim().slice(-4000);
  }

  private appendStderr(chunk: string): void {
    if (!chunk) {
      return;
    }
    this.stderrChunks.push(chunk);
    if (this.stderrChunks.length > 20) {
      this.stderrChunks.splice(0, this.stderrChunks.length - 20);
    }
  }

  private write(message: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const message = toRecord(parsed);
    if (!message) {
      return;
    }
    const method = stringField(message, "method");
    const id = jsonRpcIdField(message, "id");
    if (method && id !== undefined) {
      void this.handleRequest(id, method, message.params);
      return;
    }
    if (method) {
      this.options.onNotification?.(method, message.params);
      return;
    }
    if (id !== undefined && ("result" in message || "error" in message)) {
      this.handleResponse(id, message);
    }
  }

  private handleResponse(id: JsonRpcId, message: Record<string, unknown>): void {
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    if (message.error !== undefined) {
      pending.reject(jsonRpcError(message.error, pending.method));
      return;
    }
    pending.resolve(message.result);
  }

  private async handleRequest(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    try {
      if (!this.options.onRequest) {
        throw new JsonRpcResponseError(-32601, `Unsupported Cursor ACP request: ${method}`);
      }
      const result = await this.options.onRequest(method, params);
      this.write({ jsonrpc: "2.0", id, result });
    } catch (error) {
      const responseError =
        error instanceof JsonRpcResponseError
          ? error
          : new JsonRpcResponseError(
              -32603,
              error instanceof Error ? error.message : String(error),
            );
      this.write({
        jsonrpc: "2.0",
        id,
        error: {
          code: responseError.code,
          message: responseError.message,
          ...(responseError.data === undefined ? {} : { data: responseError.data }),
        },
      });
    }
  }

  private rejectAll(error: Error): void {
    if (this.pending.size === 0) {
      return;
    }
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
    }
  }
}

export function registerCursorComposerProvider(
  modelRegistry: Pick<ModelRegistry, "registerProvider">,
  options: CursorComposerProviderOptions,
): void {
  modelRegistry.registerProvider(CURSOR_PROVIDER_ID, {
    name: "Cursor",
    baseUrl: "https://cursor.com",
    // pi requires an auth-bearing provider to register models. Cursor ACP's primary auth is the
    // external Cursor Agent CLI login, so this sentinel only lets pi call streamSimple; it is never
    // passed to Cursor. Stored Cursor keys and CURSOR_API_KEY still override it when present.
    apiKey: CURSOR_ACP_AUTH_SENTINEL,
    api: CURSOR_API,
    streamSimple: (model, context, streamOptions) =>
      streamCursorComposer(model, context, streamOptions, {
        cwd: options.cwd,
        fastEnabled: options.fastEnabled ?? false,
      }),
    models: [
      {
        id: CURSOR_COMPOSER_MODEL_ID,
        name: CURSOR_COMPOSER_MODEL_NAME,
        api: CURSOR_API,
        reasoning: false,
        input: ["text", "image"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: CURSOR_MODEL_CONTEXT_WINDOW,
        maxTokens: CURSOR_MODEL_MAX_TOKENS,
      },
    ],
  });
}

function streamCursorComposer(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  providerOptions: Required<CursorComposerProviderOptions>,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message = createInitialAssistantMessage(model);
  stream.push({ type: "start", partial: message });

  void runCursorComposerStream({
    model,
    context,
    options,
    providerOptions,
    stream,
    message,
  });

  return stream;
}

async function runCursorComposerStream(input: {
  readonly model: Model<Api>;
  readonly context: Context;
  readonly options: SimpleStreamOptions | undefined;
  readonly providerOptions: Required<CursorComposerProviderOptions>;
  readonly stream: AssistantMessageEventStream;
  readonly message: AssistantMessage;
}): Promise<void> {
  const apiKey = resolveCursorApiKey(input.options?.apiKey);
  const toolEventState = createCursorToolEventState();
  const turnState: CursorAcpTurnState = { pendingPlanMarkdown: null };
  let rpc: CursorAcpChild | null = null;
  let sessionId: string | null = null;
  const abortRun = () => {
    if (rpc && sessionId) {
      rpc.notify("session/cancel", { sessionId });
    }
    rpc?.close();
  };
  input.options?.signal?.addEventListener("abort", abortRun, { once: true });

  try {
    throwIfAborted(input.options);
    const promptInput = buildCursorUserMessage(input.context);
    const promptInputTokens = estimateCursorPromptTokens(promptInput);
    rpc = new CursorAcpChild({
      command: resolveCursorAgentCommand(),
      args: ["--model", CURSOR_COMPOSER_ACP_MODEL_ID, "acp"],
      cwd: input.providerOptions.cwd,
      ...(apiKey ? { env: { [CURSOR_API_KEY_ENV_VAR]: apiKey } } : {}),
      onNotification: (method, params) => {
        if (method === "session/update") {
          applyCursorAcpSessionUpdate(
            input.stream,
            input.message,
            params,
            toolEventState,
            turnState,
          );
        }
        if (method === "cursor/update_todos") {
          updatePendingPlanFromTodos(turnState, params);
        }
      },
      onRequest: (method, params) =>
        handleCursorAcpRequest({
          method,
          params,
          turnState,
          signal: input.options?.signal,
        }),
    });

    const initialized = await rpc.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        _meta: { parameterizedModelPicker: true },
      },
      clientInfo: {
        name: "honk",
        version: "0.0.0",
      },
    });
    void initialized;
    throwIfAborted(input.options);

    await rpc.request("authenticate", { methodId: "cursor_login" });
    throwIfAborted(input.options);

    const sessionResponse = await rpc.request("session/new", {
      cwd: input.providerOptions.cwd,
      mcpServers: [],
    });
    sessionId = readSessionId(sessionResponse);
    if (!sessionId) {
      throw new Error("Cursor ACP session/new did not return a session id.");
    }
    await applyCursorAcpFastConfig({
      rpc,
      sessionId,
      configOptions: readConfigOptions(sessionResponse),
      fastEnabled: input.providerOptions.fastEnabled,
    });
    throwIfAborted(input.options);

    const promptResponse = await rpc.request(
      "session/prompt",
      {
        sessionId,
        prompt: cursorAcpPromptBlocks(promptInput),
      },
      null,
    );
    throwIfAborted(input.options);

    if (readStopReason(promptResponse) === "cancelled") {
      throw new CursorComposerAbortError();
    }
    appendPendingPlanIfNeeded(input.stream, input.message, turnState);
    endOpenContent(input.stream, input.message);
    stripSyntheticCursorToolContent(input.message);
    applyCursorApproximateUsage(input.message, promptInputTokens);
    input.message.stopReason = "stop";
    input.stream.push({
      type: "done",
      reason: "stop",
      message: input.message,
    });
  } catch (error) {
    const aborted = error instanceof CursorComposerAbortError || input.options?.signal?.aborted;
    pushError(
      input.stream,
      input.message,
      aborted
        ? "Cursor Composer request was aborted."
        : formatCursorAcpError(error, apiKey, rpc?.stderrText()),
      aborted ? "aborted" : "error",
    );
  } finally {
    input.options?.signal?.removeEventListener("abort", abortRun);
    rpc?.close();
  }
}

function createInitialAssistantMessage(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: CURSOR_API,
    provider: model.provider,
    model: model.id,
    usage: createUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function createUsage(input = 0, output = 0, cacheRead = 0, cacheWrite = 0): Usage {
  const totalTokens = input + output + cacheRead + cacheWrite;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function estimateTextTokens(text: string): number {
  return text.length > 0 ? Math.ceil(text.length / CURSOR_APPROX_CHARS_PER_TOKEN) : 0;
}

function estimateCursorPromptTokens(prompt: CursorUserMessage): number {
  return (
    estimateTextTokens(prompt.text) + (prompt.images?.length ?? 0) * CURSOR_IMAGE_TOKEN_ESTIMATE
  );
}

function stringifyUsageValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function estimateCursorAssistantOutputTokens(message: AssistantMessage): number {
  const text = message.content
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.text;
        case "thinking":
          return block.thinking;
        case "toolCall":
          return `Tool call (${block.name}, call ${block.id}): ${stringifyUsageValue(block.arguments)}`;
      }
    })
    .filter((part) => part.length > 0)
    .join("\n");
  return estimateTextTokens(text);
}

function applyCursorApproximateUsage(message: AssistantMessage, promptInputTokens: number): void {
  message.usage = createUsage(
    Math.max(0, Math.round(promptInputTokens)),
    estimateCursorAssistantOutputTokens(message),
    0,
    0,
  );
}

function resolveCursorApiKey(rawApiKey: string | undefined): string | undefined {
  const trimmed = rawApiKey?.trim();
  if (trimmed && trimmed !== CURSOR_ACP_AUTH_SENTINEL) {
    return trimmed;
  }
  return process.env[CURSOR_API_KEY_ENV_VAR]?.trim() || undefined;
}

function resolveCursorAgentCommand(): string {
  return process.env[CURSOR_AGENT_BIN_ENV_VAR]?.trim() || "agent";
}

function buildCursorUserMessage(context: Context): CursorUserMessage {
  const text = buildTranscriptText(context);
  const images = latestUserImages(context);
  return images.length > 0 ? { text, images } : { text };
}

function cursorAcpPromptBlocks(prompt: CursorUserMessage): AcpContentBlock[] {
  return [
    { type: "text", text: prompt.text },
    ...(prompt.images?.map((image) => ({
      type: "image" as const,
      data: image.data,
      mimeType: image.mimeType,
    })) ?? []),
  ];
}

function buildTranscriptText(context: Context): string {
  const sections: string[] = [];
  const systemPrompt = context.systemPrompt?.trim();
  if (systemPrompt) {
    sections.push(`System:\n${systemPrompt}`);
  }
  for (const message of context.messages) {
    const rendered = renderMessageForTranscript(message);
    if (rendered) {
      sections.push(rendered);
    }
  }
  return sections.join("\n\n").trim();
}

function renderMessageForTranscript(message: Message): string | null {
  switch (message.role) {
    case "user": {
      const text = renderUserContent(message.content);
      return text ? `User:\n${text}` : null;
    }
    case "assistant": {
      const text = renderAssistantContent(message.content);
      return text ? `Assistant:\n${text}` : null;
    }
    case "toolResult": {
      const text = renderTextAndImageContent(message.content);
      return text ? `Tool result (${message.toolName}):\n${text}` : null;
    }
  }
}

function renderUserContent(content: MessageForRole<"user">["content"]): string {
  return typeof content === "string" ? content.trim() : renderTextAndImageContent(content);
}

function renderTextAndImageContent(content: readonly (TextContent | ImageContent)[]): string {
  return content
    .map((item) => {
      if (item.type === "text") {
        return item.text.trim();
      }
      return `[image: ${item.mimeType}]`;
    })
    .filter((item) => item.length > 0)
    .join("\n");
}

function renderAssistantContent(content: readonly AssistantMessage["content"][number][]): string {
  return content
    .map((item) => {
      switch (item.type) {
        case "text":
          return item.text.trim();
        case "thinking":
          return "";
        case "toolCall":
          return `[tool call: ${item.name}]`;
      }
    })
    .filter((item) => item.length > 0)
    .join("\n");
}

type MessageForRole<TRole extends Message["role"]> = Extract<Message, { role: TRole }>;

function latestUserImages(context: Context): CursorImage[] {
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (message?.role !== "user" || typeof message.content === "string") {
      continue;
    }
    return message.content
      .filter((item): item is ImageContent => item.type === "image")
      .map((item) => ({
        data: item.data,
        mimeType: item.mimeType,
      }));
  }
  return [];
}

function applyCursorAcpSessionUpdate(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  params: unknown,
  toolEventState: CursorToolEventState,
  turnState: CursorAcpTurnState,
): void {
  const update = toRecord(toRecord(params)?.update);
  if (!update) {
    return;
  }
  const sessionUpdate = stringField(update, "sessionUpdate");
  switch (sessionUpdate) {
    case "agent_message_chunk": {
      const content = toRecord(update.content);
      if (content && content.type === "text" && typeof content.text === "string") {
        appendTextDelta(stream, message, content.text);
      }
      break;
    }
    case "tool_call":
    case "tool_call_update":
      applyCursorAcpToolUpdate(stream, message, update, toolEventState);
      break;
    case "plan":
      turnState.pendingPlanMarkdown =
        cursorAcpPlanMarkdown(update) ?? turnState.pendingPlanMarkdown;
      break;
    default:
      break;
  }
}

function applyCursorAcpToolUpdate(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  update: Record<string, unknown>,
  toolEventState: CursorToolEventState,
): void {
  const mergedUpdate = mergeCursorAcpToolUpdate(toolEventState, update);
  const rawToolCall = cursorAcpSyntheticRawToolCall(mergedUpdate);
  if (!rawToolCall) {
    return;
  }
  const callId =
    stringField(mergedUpdate, "toolCallId") ?? `cursor-acp:${cursorToolFingerprint(rawToolCall)}`;
  const status = normalizeAcpToolStatus(mergedUpdate.status);
  if (status === "completed" || status === "failed") {
    appendCursorToolCompleted(stream, message, callId, rawToolCall, toolEventState);
    return;
  }
  appendCursorToolStarted(stream, message, callId, rawToolCall, toolEventState);
}

function mergeCursorAcpToolUpdate(
  state: CursorToolEventState,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const callId = stringField(update, "toolCallId");
  if (!callId) {
    return update;
  }
  const previous = state.rawUpdateByCallId.get(callId);
  const merged = previous ? { ...previous, ...update } : update;
  state.rawUpdateByCallId.set(callId, merged);
  return merged;
}

function createCursorToolEventState(): CursorToolEventState {
  return {
    contentIndexByCallId: new Map<string, number>(),
    rawUpdateByCallId: new Map<string, Record<string, unknown>>(),
    completedCallIds: new Set<string>(),
    completedFingerprints: new Set<string>(),
  };
}

function appendCursorToolStarted(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  callId: string,
  rawToolCall: unknown,
  state: CursorToolEventState,
): void {
  if (state.contentIndexByCallId.has(callId)) {
    return;
  }
  const toolCall = cursorSyntheticToolCall(callId, rawToolCall);
  if (!toolCall) {
    return;
  }
  const contentIndex = message.content.length;
  message.content.push(toolCall);
  stream.push({
    type: "toolcall_start",
    contentIndex,
    partial: message,
  });
  state.contentIndexByCallId.set(callId, contentIndex);
}

function appendCursorToolCompleted(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  callId: string,
  rawToolCall: unknown,
  state: CursorToolEventState,
): void {
  const fingerprint = cursorToolFingerprint(rawToolCall);
  if (state.completedCallIds.has(callId) || state.completedFingerprints.has(fingerprint)) {
    return;
  }
  const toolCall = cursorSyntheticToolCall(callId, rawToolCall);
  if (!toolCall) {
    return;
  }
  let contentIndex = state.contentIndexByCallId.get(callId);
  if (contentIndex === undefined) {
    contentIndex = message.content.length;
    message.content.push(toolCall);
    stream.push({
      type: "toolcall_start",
      contentIndex,
      partial: message,
    });
    state.contentIndexByCallId.set(callId, contentIndex);
  } else {
    message.content[contentIndex] = toolCall;
  }
  stream.push({
    type: "toolcall_end",
    contentIndex,
    toolCall,
    partial: message,
  });
  state.completedCallIds.add(callId);
  state.completedFingerprints.add(fingerprint);
}

function cursorSyntheticToolCall(callId: string, rawToolCall: unknown): ToolCall | null {
  const record = toRecord(rawToolCall);
  if (!record) {
    return null;
  }
  const rawName =
    stringField(record, "name") ?? stringField(record, "type") ?? stringField(record, "toolName");
  if (!rawName) {
    return null;
  }
  return {
    type: "toolCall",
    id: callId,
    name: piToolNameForCursorTool(rawName),
    arguments: {
      ...cursorToolArguments(record),
      [CURSOR_SYNTHETIC_TOOL_EVENT_ARG]: true,
      ...(record.result !== undefined ? { [CURSOR_SYNTHETIC_TOOL_RESULT_ARG]: record.result } : {}),
    },
  };
}

function cursorToolFingerprint(rawToolCall: unknown): string {
  const record = toRecord(rawToolCall);
  if (!record) {
    return stringifyUsageValue(rawToolCall);
  }
  const name =
    stringField(record, "name") ??
    stringField(record, "type") ??
    stringField(record, "toolName") ??
    "";
  return [
    name,
    stringifyUsageValue(record.args),
    stringifyUsageValue(record.input),
    stringifyUsageValue(record.result),
  ].join("\n");
}

function piToolNameForCursorTool(toolName: string): string {
  if (toolName === "shell" || toolName === "execute") {
    return "bash";
  }
  return toolName;
}

function cursorToolArguments(toolCall: Record<string, unknown>): Record<string, unknown> {
  return recordField(toolCall, "args") ?? recordField(toolCall, "input") ?? {};
}

function cursorAcpSyntheticRawToolCall(
  update: Record<string, unknown>,
): Record<string, unknown> | null {
  const kind = stringField(update, "kind") ?? "cursor";
  const title = stringField(update, "title");
  const rawInput = toRecord(update.rawInput) ?? {};
  const args = cursorAcpToolArguments(kind, title, rawInput);
  const status = normalizeAcpToolStatus(update.status);
  const result = cursorAcpToolResult(status, update.rawOutput ?? update.output ?? update.content);
  return {
    type: cursorAcpToolType(kind),
    args,
    ...(result === undefined ? {} : { result }),
  };
}

function cursorAcpToolType(kind: string): string {
  return kind === "execute" ? "shell" : kind;
}

function cursorAcpToolArguments(
  kind: string,
  title: string | undefined,
  rawInput: Record<string, unknown>,
): Record<string, unknown> {
  if (kind === "execute") {
    const command =
      normalizeCommandValue(rawInput.command) ??
      commandFromExecutableArgs(rawInput) ??
      extractCommandFromTitle(title);
    return {
      ...(command ? { command } : {}),
      ...(typeof rawInput.cwd === "string" ? { workingDirectory: rawInput.cwd } : {}),
    };
  }
  return Object.keys(rawInput).length > 0 ? rawInput : title ? { title } : {};
}

function commandFromExecutableArgs(rawInput: Record<string, unknown>): string | undefined {
  const executable = normalizeCommandValue(rawInput.executable);
  const args = normalizeCommandValue(rawInput.args);
  if (executable && args) {
    return `${executable} ${args}`;
  }
  return executable;
}

function normalizeCommandValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts = value.flatMap((part) =>
    typeof part === "string" && part.trim() ? [part.trim()] : [],
  );
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function extractCommandFromTitle(title: string | undefined): string | undefined {
  if (!title) {
    return undefined;
  }
  return /`([^`]+)`/.exec(title)?.[1]?.trim() || undefined;
}

function normalizeAcpToolStatus(
  status: unknown,
): "pending" | "inProgress" | "completed" | "failed" | undefined {
  switch (status) {
    case "pending":
      return "pending";
    case "in_progress":
    case "inProgress":
      return "inProgress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return undefined;
  }
}

function cursorAcpToolResult(
  status: "pending" | "inProgress" | "completed" | "failed" | undefined,
  output: unknown,
): unknown {
  const outputText = cursorAcpOutputText(output);
  if (status === "failed") {
    return {
      status: "error",
      error: outputText ?? cursorAcpErrorOutput(output) ?? "Cursor tool failed",
    };
  }
  if (status !== "completed") {
    return undefined;
  }
  const outputRecord = toRecord(output);
  return {
    status: "success",
    value: {
      exitCode:
        numberField(outputRecord, "exitCode") ?? numberField(outputRecord, "exit_code") ?? 0,
      signal: stringField(outputRecord ?? {}, "signal") ?? "",
      stdout: cursorAcpStdout(outputRecord, outputText),
      stderr: stringField(outputRecord ?? {}, "stderr") ?? "",
      executionTime:
        numberField(outputRecord, "executionTime") ??
        numberField(outputRecord, "execution_time") ??
        numberField(outputRecord, "durationMs") ??
        0,
    },
  };
}

function cursorAcpStdout(
  output: Record<string, unknown> | null,
  fallback: string | undefined,
): string {
  if (!output) {
    return fallback ?? "";
  }
  const directOutput =
    stringField(output, "stdout") ??
    stringField(output, "content") ??
    stringField(output, "output") ??
    stringField(output, "text") ??
    textFromAcpToolContent(output.content);
  return directOutput ?? "";
}

function cursorAcpOutputText(output: unknown): string | undefined {
  return textFromUnknown(output) ?? textFromAcpToolContent(output);
}

function cursorAcpErrorOutput(output: unknown): string | undefined {
  const record = toRecord(output);
  return record ? (textFromUnknown(record.error) ?? textFromUnknown(record.message)) : undefined;
}

function textFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  const record = toRecord(value);
  if (!record) {
    return undefined;
  }
  for (const key of ["stdout", "stderr", "output", "text", "message", "summary"] as const) {
    const field = record[key];
    if (typeof field === "string" && field.trim().length > 0) {
      return field.trim();
    }
  }
  return textFromAcpToolContent(record.content);
}

function textFromAcpToolContent(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const chunks: string[] = [];
  for (const item of value) {
    const record = toRecord(item);
    const content = toRecord(record?.content);
    if (
      record?.type === "content" &&
      content?.type === "text" &&
      typeof content.text === "string"
    ) {
      const text = content.text.trim();
      if (text) {
        chunks.push(text);
      }
    }
  }
  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

async function handleCursorAcpRequest(input: {
  readonly method: string;
  readonly params: unknown;
  readonly turnState: CursorAcpTurnState;
  readonly signal: AbortSignal | undefined;
}): Promise<unknown> {
  if (input.method === "session/request_permission") {
    return {
      outcome: input.signal?.aborted
        ? { outcome: "cancelled" }
        : { outcome: "selected", optionId: selectAcpPermissionOption(input.params) },
    };
  }
  if (input.method === "cursor/ask_question") {
    return { answers: [] };
  }
  if (input.method === "cursor/create_plan") {
    const plan = stringField(toRecord(input.params) ?? {}, "plan");
    if (plan) {
      input.turnState.pendingPlanMarkdown = plan;
    }
    return { accepted: true };
  }
  throw new JsonRpcResponseError(-32601, `Unsupported Cursor ACP request: ${input.method}`);
}

function selectAcpPermissionOption(params: unknown): string {
  const options = toRecord(params)?.options;
  if (!Array.isArray(options)) {
    return "allow-once";
  }
  const records = options.flatMap((option) => {
    const record = toRecord(option);
    return record ? [record] : [];
  });
  return (
    findPermissionOption(records, "allow_once") ??
    findPermissionOption(records, "allow_always") ??
    records
      .map((record) => stringField(record, "optionId"))
      .find((id): id is string => Boolean(id)) ??
    "allow-once"
  );
}

function findPermissionOption(
  options: readonly Record<string, unknown>[],
  kind: string,
): string | undefined {
  const option = options.find((entry) => entry.kind === kind && stringField(entry, "optionId"));
  return option ? stringField(option, "optionId") : undefined;
}

async function applyCursorAcpFastConfig(input: {
  readonly rpc: CursorAcpChild;
  readonly sessionId: string;
  readonly configOptions: readonly Record<string, unknown>[];
  readonly fastEnabled: boolean;
}): Promise<void> {
  const fastOption = input.configOptions.find(isCursorFastConfigOption);
  if (!fastOption) {
    return;
  }
  const configId = stringField(fastOption, "id");
  if (!configId) {
    return;
  }
  const value = cursorBooleanConfigValue(fastOption, input.fastEnabled);
  if (value === undefined || fastOption.currentValue === value) {
    return;
  }
  await input.rpc.request("session/set_config_option", {
    sessionId: input.sessionId,
    configId,
    ...(typeof value === "boolean" ? { type: "boolean", value } : { value }),
  });
}

function isCursorFastConfigOption(option: Record<string, unknown>): boolean {
  const id = stringField(option, "id")?.toLowerCase() ?? "";
  const name = stringField(option, "name")?.toLowerCase() ?? "";
  const category = stringField(option, "category")?.toLowerCase() ?? "";
  return (
    (category === "model_config" || category === "model_option" || category === "") &&
    (id === "fast" || name === "fast" || name.includes("fast mode"))
  );
}

function cursorBooleanConfigValue(
  option: Record<string, unknown>,
  enabled: boolean,
): string | boolean | undefined {
  if (option.type === "boolean") {
    return enabled;
  }
  if (option.type !== "select" || !Array.isArray(option.options)) {
    return undefined;
  }
  const wanted = enabled ? "true" : "false";
  for (const entry of flattenSelectOptions(option.options)) {
    if (entry.toLowerCase() === wanted) {
      return entry;
    }
  }
  return undefined;
}

function flattenSelectOptions(options: readonly unknown[]): string[] {
  const values: string[] = [];
  for (const option of options) {
    const record = toRecord(option);
    if (!record) {
      continue;
    }
    const value = stringField(record, "value");
    if (value) {
      values.push(value);
      continue;
    }
    if (Array.isArray(record.options)) {
      values.push(...flattenSelectOptions(record.options));
    }
  }
  return values;
}

function readSessionId(response: unknown): string | null {
  const sessionId = stringField(toRecord(response) ?? {}, "sessionId");
  return sessionId ?? null;
}

function readStopReason(response: unknown): string | null {
  const stopReason = stringField(toRecord(response) ?? {}, "stopReason");
  return stopReason ?? null;
}

function readConfigOptions(response: unknown): Record<string, unknown>[] {
  const configOptions = toRecord(response)?.configOptions;
  if (!Array.isArray(configOptions)) {
    return [];
  }
  return configOptions.flatMap((option) => {
    const record = toRecord(option);
    return record ? [record] : [];
  });
}

function updatePendingPlanFromTodos(turnState: CursorAcpTurnState, params: unknown): void {
  const todos = toRecord(params)?.todos;
  if (!Array.isArray(todos)) {
    return;
  }
  const lines = todos.flatMap((todo) => {
    const record = toRecord(todo);
    const content = record
      ? (stringField(record, "content") ?? stringField(record, "title"))
      : undefined;
    const status = typeof record?.status === "string" ? record.status : "pending";
    const marker = status === "completed" ? "x" : " ";
    return content ? [`- [${marker}] ${content}`] : [];
  });
  if (lines.length > 0) {
    turnState.pendingPlanMarkdown = lines.join("\n");
  }
}

function cursorAcpPlanMarkdown(update: Record<string, unknown>): string | undefined {
  const entries = update.entries;
  if (!Array.isArray(entries)) {
    return undefined;
  }
  const lines = entries.flatMap((entry) => {
    const record = toRecord(entry);
    const content = record ? stringField(record, "content") : undefined;
    if (!content) {
      return [];
    }
    const status = typeof record?.status === "string" ? record.status : "pending";
    const marker = status === "completed" ? "x" : " ";
    return [`- [${marker}] ${content}`];
  });
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function appendPendingPlanIfNeeded(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  turnState: CursorAcpTurnState,
): void {
  if (!turnState.pendingPlanMarkdown || hasTextContent(message)) {
    return;
  }
  appendTextDelta(stream, message, turnState.pendingPlanMarkdown);
}

function isSyntheticCursorToolContent(content: AssistantContent): boolean {
  return content.type === "toolCall" && content.arguments[CURSOR_SYNTHETIC_TOOL_EVENT_ARG] === true;
}

function stripSyntheticCursorToolContent(message: AssistantMessage): void {
  message.content = message.content.filter((content) => !isSyntheticCursorToolContent(content));
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  return toRecord(record[key]) ?? undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown> | null, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function jsonRpcIdField(record: Record<string, unknown>, key: string): JsonRpcId | undefined {
  const value = record[key];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function appendTextDelta(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  delta: string,
): void {
  if (!delta) {
    return;
  }
  const contentIndex = ensureTextContent(stream, message);
  const content = requireTextContent(message, contentIndex);
  content.text += delta;
  stream.push({ type: "text_delta", contentIndex, delta, partial: message });
}

function ensureTextContent(stream: AssistantMessageEventStream, message: AssistantMessage): number {
  const existingIndex = message.content.findIndex((item) => item.type === "text");
  if (existingIndex !== -1) {
    return existingIndex;
  }
  const contentIndex = message.content.length;
  message.content.push({ type: "text", text: "" });
  stream.push({ type: "text_start", contentIndex, partial: message });
  return contentIndex;
}

function requireTextContent(message: AssistantMessage, contentIndex: number): TextContent {
  const content = message.content[contentIndex];
  if (!content || content.type !== "text") {
    throw new Error("Cursor Composer stream attempted to update a non-text content block.");
  }
  return content;
}

function hasTextContent(message: AssistantMessage): boolean {
  return message.content.some((item) => item.type === "text" && item.text.trim().length > 0);
}

function endOpenContent(stream: AssistantMessageEventStream, message: AssistantMessage): void {
  for (const [contentIndex, content] of message.content.entries()) {
    if (content.type === "text") {
      stream.push({
        type: "text_end",
        contentIndex,
        content: content.text,
        partial: message,
      });
    }
    if (content.type === "thinking") {
      stream.push({
        type: "thinking_end",
        contentIndex,
        content: content.thinking,
        partial: message,
      });
    }
  }
}

function pushError(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  errorMessage: string,
  reason: "error" | "aborted",
): void {
  endOpenContent(stream, message);
  stripSyntheticCursorToolContent(message);
  message.stopReason = reason;
  message.errorMessage = errorMessage;
  stream.push({ type: "error", reason, error: message });
}

function throwIfAborted(options: SimpleStreamOptions | undefined): void {
  if (options?.signal?.aborted) {
    throw new CursorComposerAbortError();
  }
}

function jsonRpcError(rawError: unknown, method: string): Error {
  const record = toRecord(rawError);
  const message =
    (record && stringField(record, "message")) ||
    (typeof rawError === "string" ? rawError : stringifyUsageValue(rawError));
  return new Error(`Cursor ACP ${method} failed: ${message}`);
}

function formatCursorAcpError(
  error: unknown,
  apiKey: string | undefined,
  stderr: string | undefined,
): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = stderr ? `${rawMessage}\n${stderr}` : rawMessage;
  const scrubbed = scrubSensitiveText(message, apiKey);
  if (/ENOENT|not found|spawn .*agent/i.test(scrubbed)) {
    return `Cursor Composer requires the Cursor Agent CLI. Install Cursor Agent, ensure \`agent\` is on PATH, or set ${CURSOR_AGENT_BIN_ENV_VAR}.`;
  }
  if (/not logged in|login required|authentication required|unauthenticated/i.test(scrubbed)) {
    return "Cursor Agent is not authenticated. Run `agent login` in a terminal or set CURSOR_API_KEY, then try again.";
  }
  return scrubbed;
}

function scrubSensitiveText(message: string, apiKey: string | undefined): string {
  return apiKey ? message.split(apiKey).join("[redacted]") : message;
}
