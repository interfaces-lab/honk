import {
  createOpencodeClient,
  type AgentPartInput as OpenCodeAgentPartInput,
  type AgentV2Info as OpenCodeAgentInfo,
  type CommandV2Info as OpenCodeCommandInfo,
  type Config as OpenCodeConfigInfo,
  type FilePartInput as OpenCodeFilePartInput,
  type FileSystemEntry as OpenCodeFileSystemEntry,
  type LocationInfo as OpenCodeLocationInfo,
  type McpLocalConfig,
  type McpRemoteConfig,
  type McpStatus as OpenCodeMcpStatus,
  type ModelRef as OpenCodeModelRef,
  type ModelV2Info as OpenCodeModelInfo,
  type Path as OpenCodePathInfo,
  type PermissionSavedInfo as OpenCodeSavedPermission,
  type PermissionV2Reply as OpenCodePermissionReply,
  type PermissionV2Request as OpenCodePermissionRequest,
  type ProjectCopyCopy as OpenCodeProjectCopy,
  type PromptAgentAttachment as OpenCodePromptAgentAttachment,
  type PromptInputFileAttachment as OpenCodePromptFileAttachment,
  type QuestionRequest as OpenCodeQuestionRequest,
  type QuestionV2Reply as OpenCodeQuestionReply,
  type SessionMessage as OpenCodeSessionMessage,
  type SessionMessagesResponse as OpenCodeSessionMessages,
  type SessionV2Info as OpenCodeSessionInfo,
  type SkillV2Info as OpenCodeSkillInfo,
  type SessionsResponse as OpenCodeSessions,
  type TextPartInput as OpenCodeTextPartInput,
  type V2Event,
  type V2SessionActiveResponse as OpenCodeSessionActiveResponse,
  type VcsFileDiff as OpenCodeVcsFileDiff,
  type VcsFileStatus as OpenCodeVcsFileStatus,
  type VcsInfo as OpenCodeVcsInfo,
} from "@opencode-ai/sdk/v2/client";

import { openCodeAuthorizationHeader } from "./connection";
import type { OpenCodeEventSourceFactory } from "./event-stream";
import {
  openCodeMessageID,
  type OpenCodeLocationRef,
  type OpenCodeMessageID,
  type OpenCodeServerDescriptor,
  type OpenCodeSessionRef,
} from "./identity";
import type { OpenCodeProviderApi } from "./provider-auth";
import {
  projectOpenCodeTranscript,
  type OpenCodePersistedMessage,
  type OpenCodeSessionTranscript,
} from "./transcript";

type OpenCodeLocationQuery = {
  readonly directory?: string;
  readonly workspaceID?: string;
};

type OpenCodeListSessionsInput = {
  readonly workspaceID?: string;
  readonly limit?: number;
  readonly order?: "asc" | "desc";
  readonly search?: string;
  readonly directory?: string;
  readonly projectID?: string;
  readonly subpath?: string;
  readonly cursor?: string;
};

type OpenCodeCreateSessionInput = {
  readonly id?: string;
  readonly parentID?: string;
  readonly title?: string;
  readonly agent?: string;
  readonly model?: OpenCodeModelRef;
  readonly location?: OpenCodeLocationRef;
};

type OpenCodeCreateProjectCopyInput = {
  readonly projectID: string;
  readonly location?: OpenCodeLocationQuery;
  readonly strategy: string;
  readonly directory: string;
  readonly name?: string;
};

type OpenCodeRemoveProjectCopyInput = {
  readonly projectID: string;
  readonly location?: OpenCodeLocationQuery;
  readonly directory: string;
  readonly force: boolean;
};

type OpenCodeUpdateSessionInput = {
  readonly title?: string;
};

type OpenCodePrompt = {
  readonly text: string;
  readonly files?: readonly OpenCodePromptFileAttachment[];
  readonly agents?: readonly OpenCodePromptAgentAttachment[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly synthetic?: boolean;
};

type OpenCodePromptInput = {
  readonly id?: OpenCodeMessageID;
  readonly prompt: OpenCodePrompt;
};

type OpenCodeMessagesInput =
  | {
      readonly limit?: number;
      readonly order?: "asc" | "desc";
      readonly cursor?: never;
    }
  | {
      readonly limit?: number;
      readonly order?: never;
      readonly cursor: string;
    };

type OpenCodeRevertInput = {
  readonly messageID: string;
};

type OpenCodeClientOptions = {
  readonly password?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
  readonly eventSource?: OpenCodeEventSourceFactory;
};

type OpenCodeSessionApi = {
  readonly list: (input?: OpenCodeListSessionsInput) => Promise<OpenCodeSessions>;
  readonly create: (input?: OpenCodeCreateSessionInput) => Promise<OpenCodeSessionInfo>;
  readonly active: (
    location?: OpenCodeLocationQuery,
  ) => Promise<OpenCodeSessionActiveResponse["data"]>;
  readonly get: (ref: OpenCodeSessionRef) => Promise<OpenCodeSessionInfo>;
  readonly update: (ref: OpenCodeSessionRef, input: OpenCodeUpdateSessionInput) => Promise<void>;
  readonly switchAgent: (ref: OpenCodeSessionRef, agent: string) => Promise<void>;
  readonly switchModel: (ref: OpenCodeSessionRef, model: OpenCodeModelRef) => Promise<void>;
  readonly prompt: (ref: OpenCodeSessionRef, input: OpenCodePromptInput) => Promise<void>;
  readonly compact: (ref: OpenCodeSessionRef) => Promise<void>;
  readonly wait: (ref: OpenCodeSessionRef) => Promise<void>;
  readonly context: (ref: OpenCodeSessionRef) => Promise<readonly OpenCodeSessionMessage[]>;
  readonly interrupt: (ref: OpenCodeSessionRef) => Promise<void>;
  readonly messages: (
    ref: OpenCodeSessionRef,
    input?: OpenCodeMessagesInput,
  ) => Promise<OpenCodeSessionMessages>;
  readonly transcript: (ref: OpenCodeSessionRef) => Promise<OpenCodeSessionTranscript>;
  /** File changes recorded for the session's newest user turn; empty when none were snapshotted. */
  readonly lastTurnDiff: (ref: OpenCodeSessionRef) => Promise<readonly OpenCodeVcsFileDiff[]>;
  readonly revert: (ref: OpenCodeSessionRef, input: OpenCodeRevertInput) => Promise<void>;
  readonly unrevert: (ref: OpenCodeSessionRef) => Promise<void>;
  readonly permissions: (ref: OpenCodeSessionRef) => Promise<readonly OpenCodePermissionRequest[]>;
  readonly replyPermission: (
    ref: OpenCodeSessionRef,
    requestID: string,
    reply: OpenCodePermissionReply,
    message?: string,
  ) => Promise<void>;
  readonly questions: (ref: OpenCodeSessionRef) => Promise<readonly OpenCodeQuestionRequest[]>;
  readonly replyQuestion: (
    ref: OpenCodeSessionRef,
    requestID: string,
    reply: OpenCodeQuestionReply,
  ) => Promise<void>;
  readonly rejectQuestion: (ref: OpenCodeSessionRef, requestID: string) => Promise<void>;
};

type OpenCodeLocatedResult<T> = {
  readonly location: OpenCodeLocationInfo;
  readonly data: readonly T[];
};

type OpenCodeEventWithOptionalID<Event> = Event extends { readonly id: string }
  ? Omit<Event, "id"> & { readonly id?: string }
  : Event;

type OpenCodeEvent =
  | OpenCodeEventWithOptionalID<V2Event>
  | {
      readonly id?: string;
      readonly type: "server.heartbeat";
      readonly data: Readonly<Record<string, unknown>>;
    };

type OpenCodeRequestApi = {
  readonly permissions: (
    location: OpenCodeLocationQuery,
  ) => Promise<OpenCodeLocatedResult<OpenCodePermissionRequest>>;
  readonly questions: (
    location: OpenCodeLocationQuery,
  ) => Promise<{ readonly data: readonly OpenCodeQuestionRequest[] }>;
};

type OpenCodeAgentApi = {
  readonly list: (
    location?: OpenCodeLocationQuery,
  ) => Promise<OpenCodeLocatedResult<OpenCodeAgentInfo>>;
};

type OpenCodeModelApi = {
  readonly list: (
    location?: OpenCodeLocationQuery,
  ) => Promise<OpenCodeLocatedResult<OpenCodeModelInfo>>;
};

// `/file/content` collapses "missing", "unreadable", and "empty" into an empty
// text body, and trims text content — never treat this as the file's bytes.
type OpenCodeFileContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "binary"; readonly base64: string; readonly mimeType?: string };

type OpenCodeFileApi = {
  readonly find: (
    query: string,
    location?: OpenCodeLocationQuery,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<OpenCodeLocatedResult<OpenCodeFileSystemEntry>>;
  // Direct children only. `path` is relative to the location directory; omit it for the root.
  // Returned paths are also location-relative, and directories carry a trailing path separator.
  readonly list: (
    path?: string,
    location?: OpenCodeLocationQuery,
  ) => Promise<OpenCodeLocatedResult<OpenCodeFileSystemEntry>>;
  // Viewer source, not an editor source: text is trimmed, so it is not byte-accurate,
  // and a missing or unreadable path is indistinguishable from an empty file. Callers
  // that need existence must `list` the parent directory first. `path` is
  // location-relative or absolute inside the location; a directory path (including a
  // `list` entry with its trailing separator) fails with an OpenCodeRequestError.
  readonly read: (path: string, location?: OpenCodeLocationQuery) => Promise<OpenCodeFileContent>;
};

type OpenCodeCommandApi = {
  readonly list: (
    location?: OpenCodeLocationQuery,
  ) => Promise<OpenCodeLocatedResult<OpenCodeCommandInfo>>;
};

type OpenCodeSkillApi = {
  readonly list: (
    location?: OpenCodeLocationQuery,
  ) => Promise<OpenCodeLocatedResult<OpenCodeSkillInfo>>;
};

type OpenCodeProjectCopyApi = {
  readonly create: (input: OpenCodeCreateProjectCopyInput) => Promise<OpenCodeProjectCopy>;
  readonly remove: (input: OpenCodeRemoveProjectCopyInput) => Promise<void>;
};

type OpenCodeVcsApi = {
  readonly info: (location?: OpenCodeLocationQuery) => Promise<OpenCodeVcsInfo>;
  readonly status: (location?: OpenCodeLocationQuery) => Promise<readonly OpenCodeVcsFileStatus[]>;
  readonly diff: (
    input: OpenCodeLocationQuery & { readonly mode: "git" | "branch"; readonly context?: number },
  ) => Promise<readonly OpenCodeVcsFileDiff[]>;
};

// The value shape of `OpenCodeConfigInfo["mcp"]`: a full server definition, or the
// enable/disable-only override the sidecar accepts for a server defined elsewhere.
type OpenCodeMcpServerConfig = McpLocalConfig | McpRemoteConfig | { enabled: boolean };

type OpenCodeMcpApi = {
  readonly status: (
    location?: OpenCodeLocationQuery,
  ) => Promise<Readonly<Record<string, OpenCodeMcpStatus>>>;
  readonly add: (
    name: string,
    config: McpLocalConfig | McpRemoteConfig,
    location?: OpenCodeLocationQuery,
  ) => Promise<Readonly<Record<string, OpenCodeMcpStatus>>>;
  readonly connect: (name: string, location?: OpenCodeLocationQuery) => Promise<boolean>;
  readonly disconnect: (name: string, location?: OpenCodeLocationQuery) => Promise<boolean>;
  // Runs the whole OAuth flow server-side: the sidecar opens a browser and waits for
  // the callback. Rejects when the server declares no OAuth support or is unknown.
  readonly authenticate: (
    name: string,
    location?: OpenCodeLocationQuery,
  ) => Promise<OpenCodeMcpStatus>;
  readonly removeAuth: (name: string, location?: OpenCodeLocationQuery) => Promise<void>;
};

// Read-only on purpose: Honk owns the config the sidecar reads (a generated overlay
// handed over as OPENCODE_CONFIG / OPENCODE_CONFIG_DIR), so a write through this
// route would be overwritten on the next regeneration.
type OpenCodeConfigApi = {
  readonly get: (location?: OpenCodeLocationQuery) => Promise<OpenCodeConfigInfo>;
};

type OpenCodeSavedPermissionApi = {
  readonly list: () => Promise<readonly OpenCodeSavedPermission[]>;
  readonly remove: (id: string) => Promise<void>;
};

type OpenCodeClient = {
  readonly server: OpenCodeServerDescriptor;
  readonly health: () => Promise<void>;
  readonly resolveLocation: (location?: OpenCodeLocationQuery) => Promise<OpenCodeLocationInfo>;
  readonly resolvePath: (location?: OpenCodeLocationQuery) => Promise<OpenCodePathInfo>;
  readonly sessions: OpenCodeSessionApi;
  readonly requests: OpenCodeRequestApi;
  readonly agents: OpenCodeAgentApi;
  readonly models: OpenCodeModelApi;
  readonly files: OpenCodeFileApi;
  readonly commands: OpenCodeCommandApi;
  readonly skills: OpenCodeSkillApi;
  readonly projectCopies: OpenCodeProjectCopyApi;
  readonly providers: OpenCodeProviderApi;
  readonly vcs: OpenCodeVcsApi;
  readonly mcp: OpenCodeMcpApi;
  readonly config: OpenCodeConfigApi;
  readonly savedPermissions: OpenCodeSavedPermissionApi;
  readonly events: (signal?: AbortSignal) => AsyncIterable<OpenCodeEvent>;
  readonly close: () => void;
};

const OPEN_CODE_SESSION_CAPABILITIES = Object.freeze({
  list: true,
  create: true,
  active: true,
  get: true,
  switchAgent: true,
  switchModel: true,
  prompt: true,
  compact: true,
  wait: true,
  context: true,
  interrupt: true,
  messages: true,
  transcript: true,
  revert: true,
  permissions: true,
  questions: true,
  rename: true,
  archive: false,
  remove: false,
  fork: false,
  commandExecution: false,
} as const);

const OPEN_CODE_CAPABILITIES = Object.freeze({
  sessions: OPEN_CODE_SESSION_CAPABILITIES,
  agents: true,
  models: true,
  // There is no file write route on the sidecar; the only working-tree mutation
  // is a whole-patch `vcs.apply`, which trimmed read output cannot drive.
  files: Object.freeze({ find: true, list: true, read: true, write: false }),
  commands: true,
  skills: true,
  vcs: true,
  providers: true,
  mcp: Object.freeze({
    status: true,
    connect: true,
    disconnect: true,
    authenticate: true,
    removeAuth: true,
    add: true,
  }),
  // Config reads only: the sidecar's config is Honk's generated overlay, so a write
  // here loses to the next regeneration.
  config: Object.freeze({ read: true, write: false }),
  savedPermissions: Object.freeze({ list: true, remove: true }),
  projects: false,
  projectCopies: Object.freeze({ create: true, remove: true, list: false }),
  remoteEvents: true,
} as const);

class OpenCodeRequestError extends Error {
  readonly operation: string;
  readonly status: number | null;
  override readonly cause: unknown;

  constructor(operation: string, error: unknown, response?: Response) {
    super(errorMessage(error, `OpenCode ${operation} failed.`));
    this.name = "OpenCodeRequestError";
    this.operation = operation;
    this.status = response?.status ?? null;
    this.cause = error;
  }
}

type RequestResult<T> = {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly response: Response;
};

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (typeof error !== "object" || error === null) {
    return fallback;
  }
  const direct = Reflect.get(error, "message");
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct;
  }
  const data = Reflect.get(error, "data");
  if (typeof data === "object" && data !== null) {
    const nested = Reflect.get(data, "message");
    if (typeof nested === "string" && nested.trim().length > 0) {
      return nested;
    }
  }
  return fallback;
}

function requireData<T>(result: RequestResult<T>, operation: string): T {
  if (result.error !== undefined || result.data === undefined) {
    throw new OpenCodeRequestError(operation, result.error, result.response);
  }
  return result.data;
}

function requireSuccess(result: RequestResult<unknown>, operation: string): void {
  if (result.error !== undefined) {
    throw new OpenCodeRequestError(operation, result.error, result.response);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function globalStreamEvent(value: unknown): OpenCodeEvent | null {
  if (!isRecord(value) || !isRecord(value.payload)) return null;
  const payload = value.payload;
  if (typeof payload.type !== "string" || payload.type === "sync") return null;
  const control = payload.type === "server.connected" || payload.type === "server.heartbeat";
  if (!control && !isRecord(payload.properties)) return null;
  return {
    ...(typeof payload.id === "string" ? { id: payload.id } : {}),
    type: payload.type,
    data: isRecord(payload.properties) ? payload.properties : {},
  } as OpenCodeEvent;
}

function locationQuery(
  location: OpenCodeLocationQuery | undefined,
): { readonly directory?: string; readonly workspace?: string } | undefined {
  if (location === undefined) {
    return undefined;
  }
  return {
    ...(location.directory !== undefined ? { directory: location.directory } : {}),
    ...(location.workspaceID !== undefined ? { workspace: location.workspaceID } : {}),
  };
}

function sessionLocationQuery(location: OpenCodeLocationRef): {
  readonly directory: string;
  readonly workspace?: string;
} {
  return {
    directory: location.directory,
    ...(location.workspaceID !== undefined ? { workspace: location.workspaceID } : {}),
  };
}

function dataUrlMime(uri: string): string | undefined {
  if (!uri.startsWith("data:")) return undefined;
  const match = /^data:([^;,]+)/.exec(uri);
  return match?.[1] !== undefined && match[1].length > 0 ? match[1] : undefined;
}

function attachmentMime(file: OpenCodePromptFileAttachment): string {
  const declared = file.description?.trim();
  return (
    dataUrlMime(file.uri) ??
    (declared !== undefined && /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/i.test(declared)
      ? declared
      : "text/plain")
  );
}

function absoluteAttachmentPath(uri: string, directory: string): string {
  if (uri.startsWith("/") || /^[A-Za-z]:[\\/]/.test(uri) || uri.startsWith("\\\\")) {
    return uri;
  }
  const base = directory.replace(/[\\/]+$/, "");
  if (base.length === 0) {
    throw new Error(`Cannot attach "${uri}": the session has no directory.`);
  }
  return `${base}/${uri}`;
}

function fileUrlFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("//")) {
    const [host = "", ...segments] = normalized.slice(2).split("/");
    return `file://${encodeURIComponent(host)}/${segments.map(encodeURIComponent).join("/")}`;
  }
  const rooted = /^[A-Za-z]:\//.test(normalized) ? `/${normalized}` : normalized;
  const encoded = rooted
    .split("/")
    .map((segment, index) =>
      index === 1 && /^[A-Za-z]:$/.test(segment)
        ? `${segment.slice(0, 1)}:`
        : encodeURIComponent(segment),
    )
    .join("/");
  return `file://${encoded}`;
}

function attachmentUrl(uri: string, directory: string): string {
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(uri)) return uri;
  return fileUrlFromPath(absoluteAttachmentPath(uri, directory));
}

function attachmentFilename(file: OpenCodePromptFileAttachment): string {
  if (file.name !== undefined && file.name.length > 0) return file.name;
  if (file.uri.startsWith("data:")) return "attachment";
  const trimmed = file.uri.replace(/^file:\/\//, "").replace(/[\\/]+$/, "");
  const filename = trimmed.split(/[\\/]/).at(-1) ?? "attachment";
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

function promptFilePart(
  file: OpenCodePromptFileAttachment,
  directory: string,
): OpenCodeFilePartInput {
  return {
    type: "file",
    mime: attachmentMime(file),
    filename: attachmentFilename(file),
    url: attachmentUrl(file.uri, directory),
    ...(file.source !== undefined
      ? {
          source: {
            type: "file" as const,
            path: file.uri,
            text: {
              value: file.source.text,
              start: file.source.start,
              end: file.source.end,
            },
          },
        }
      : {}),
  };
}

function promptParts(
  prompt: OpenCodePrompt,
  directory: string,
): Array<OpenCodeTextPartInput | OpenCodeFilePartInput | OpenCodeAgentPartInput> {
  return [
    ...(prompt.text.length > 0
      ? [
          {
            type: "text" as const,
            text: prompt.text,
            ...(prompt.metadata !== undefined ? { metadata: { ...prompt.metadata } } : {}),
            ...(prompt.synthetic === true ? { synthetic: true } : {}),
          },
        ]
      : []),
    ...(prompt.files ?? []).map((file) => promptFilePart(file, directory)),
    ...(prompt.agents ?? []).map(
      (agent): OpenCodeAgentPartInput => ({
        type: "agent",
        name: agent.name,
        ...(agent.source !== undefined
          ? {
              source: {
                value: agent.source.text,
                start: agent.source.start,
                end: agent.source.end,
              },
            }
          : {}),
      }),
    ),
  ];
}

function createOpenCodeClient(
  server: OpenCodeServerDescriptor,
  options?: OpenCodeClientOptions,
): OpenCodeClient {
  const headers: Record<string, string> = { ...options?.headers };
  if (options?.password !== undefined && options.password.length > 0) {
    headers.Authorization = openCodeAuthorizationHeader(options.password);
  }

  // Boundary check requires the name `sdk`. Call only the current generated namespace.
  const sdk = createOpencodeClient({
    baseUrl: server.origin,
    headers,
    ...(options?.fetch !== undefined ? { fetch: options.fetch } : {}),
  });
  const eventControllers = new Set<AbortController>();
  const sessionLocations = new Map<string, OpenCodeLocationRef>();
  const sessionLocationLoads = new Map<string, Promise<OpenCodeLocationRef>>();

  function trackEventController(signal?: AbortSignal): {
    readonly controller: AbortController;
    readonly release: () => void;
  } {
    const controller = new AbortController();
    const abort = (): void => {
      controller.abort(signal?.reason);
    };
    if (signal?.aborted === true) {
      abort();
    } else {
      signal?.addEventListener("abort", abort, { once: true });
    }
    eventControllers.add(controller);
    return {
      controller,
      release() {
        signal?.removeEventListener("abort", abort);
        eventControllers.delete(controller);
        controller.abort();
      },
    };
  }

  function sessionID(ref: OpenCodeSessionRef): string {
    if (ref.server !== server.key) {
      throw new Error(
        `Session ${ref.sessionID} belongs to ${ref.server}, not the connected server ${server.key}.`,
      );
    }
    return ref.sessionID;
  }

  function rememberSessionLocation(info: OpenCodeSessionInfo): OpenCodeSessionInfo {
    sessionLocations.set(info.id, info.location);
    return info;
  }

  function resolveSessionLocation(ref: OpenCodeSessionRef): Promise<OpenCodeLocationRef> {
    const id = sessionID(ref);
    const known = sessionLocations.get(id);
    if (known !== undefined) return Promise.resolve(known);
    const active = sessionLocationLoads.get(id);
    if (active !== undefined) return active;

    const pending = (async (): Promise<OpenCodeLocationRef> => {
      try {
        const result = await sdk.v2.session.get({ sessionID: id });
        return rememberSessionLocation(requireData(result, "session.get").data).location;
      } finally {
        sessionLocationLoads.delete(id);
      }
    })();
    sessionLocationLoads.set(id, pending);
    return pending;
  }

  async function listAllProjectedMessages(
    ref: OpenCodeSessionRef,
  ): Promise<readonly OpenCodeSessionMessage[]> {
    const messages: OpenCodeSessionMessage[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let hasNextPage = true;
    do {
      const result = await sdk.v2.session.messages({
        sessionID: sessionID(ref),
        limit: 200,
        ...(cursor === undefined ? { order: "asc" as const } : { cursor }),
      });
      const page = requireData(result, "session.transcript.projected");
      messages.push(...page.data);
      const next = page.cursor.next;
      if (next === undefined || seenCursors.has(next)) {
        hasNextPage = false;
        continue;
      }
      seenCursors.add(next);
      cursor = next;
    } while (hasNextPage);
    return messages;
  }

  async function listAllPersistedMessages(
    info: OpenCodeSessionInfo,
  ): Promise<readonly OpenCodePersistedMessage[]> {
    const pages: OpenCodePersistedMessage[][] = [];
    const seenCursors = new Set<string>();
    let before: string | undefined;
    let hasNextPage = true;
    do {
      const result = await sdk.session.messages({
        sessionID: info.id,
        limit: 200,
        ...(before === undefined ? {} : { before }),
      });
      pages.unshift(requireData(result, "session.transcript.persisted"));
      const next = result.response.headers.get("X-Next-Cursor") ?? undefined;
      if (next === undefined || seenCursors.has(next)) {
        hasNextPage = false;
        continue;
      }
      seenCursors.add(next);
      before = next;
    } while (hasNextPage);
    return pages.flat();
  }

  const requests: OpenCodeRequestApi = {
    async permissions(location) {
      const query = locationQuery(location);
      const result = await sdk.v2.permission.request.list(
        query === undefined ? {} : { location: query },
      );
      return requireData(result, "permission.request.list");
    },

    async questions(location) {
      const query = locationQuery(location);
      // Questions are owned by the same stable runner as promptAsync. The V2
      // queue belongs to the separate V2 runner and cannot see these requests.
      const result = await sdk.question.list(query);
      return { data: requireData(result, "question.list") };
    },
  };

  // Execution stays on the stable runner, mirroring upstream's own frontends at
  // 1.18: the V2 runner resolves models from its catalog/credential plane, which
  // has no OAuth request signing and does not load OPENCODE_CONFIG, so prompts
  // pinned to Honk's agents/models are admitted but never drain. V2 owns
  // projection, events, and everything else here.
  const sessions: OpenCodeSessionApi = {
    async list(input) {
      const result = await sdk.v2.session.list({
        ...(input?.workspaceID !== undefined ? { workspace: input.workspaceID } : {}),
        ...(input?.limit !== undefined ? { limit: input.limit } : {}),
        ...(input?.order !== undefined ? { order: input.order } : {}),
        ...(input?.search !== undefined ? { search: input.search } : {}),
        ...(input?.directory !== undefined ? { directory: input.directory } : {}),
        ...(input?.projectID !== undefined ? { project: input.projectID } : {}),
        ...(input?.subpath !== undefined ? { subpath: input.subpath } : {}),
        ...(input?.cursor !== undefined ? { cursor: input.cursor } : {}),
      });
      const page = requireData(result, "session.list");
      for (const info of page.data) rememberSessionLocation(info);
      return page;
    },

    async create(input) {
      if (input?.parentID !== undefined) {
        const created = requireData(
          await sdk.session.create({
            parentID: input.parentID,
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.location !== undefined ? sessionLocationQuery(input.location) : {}),
          }),
          "session.create",
        );
        if (input.agent !== undefined) {
          requireSuccess(
            await sdk.v2.session.switchAgent({ sessionID: created.id, agent: input.agent }),
            "session.switchAgent",
          );
        }
        if (input.model !== undefined) {
          requireSuccess(
            await sdk.v2.session.switchModel({ sessionID: created.id, model: input.model }),
            "session.switchModel",
          );
        }
        const projected = await sdk.v2.session.get({ sessionID: created.id });
        return rememberSessionLocation(requireData(projected, "session.get").data);
      }
      const result = await sdk.v2.session.create({
        ...(input?.id !== undefined ? { id: input.id } : {}),
        ...(input?.title !== undefined ? { title: input.title } : {}),
        ...(input?.agent !== undefined ? { agent: input.agent } : {}),
        ...(input?.model !== undefined ? { model: input.model } : {}),
        ...(input?.location !== undefined ? { location: { ...input.location } } : {}),
      });
      return rememberSessionLocation(requireData(result, "session.create").data);
    },

    async active(location) {
      // Session status lives in per-directory instance state on the sidecar, so
      // an unscoped call only reports sessions from the default instance.
      const result = await sdk.session.status(locationQuery(location));
      const statuses = requireData(result, "session.active");
      const active: OpenCodeSessionActiveResponse["data"] = {};
      for (const [id, status] of Object.entries(statuses)) {
        if (status.type !== "idle") active[id] = { type: "running" };
      }
      return active;
    },

    async get(ref) {
      const result = await sdk.v2.session.get({ sessionID: sessionID(ref) });
      return rememberSessionLocation(requireData(result, "session.get").data);
    },

    async update(ref, input) {
      // Title mutation lives on the stable session group; V2 has no update method.
      const location = await resolveSessionLocation(ref);
      const result = await sdk.session.update({
        sessionID: sessionID(ref),
        ...sessionLocationQuery(location),
        ...(input.title !== undefined ? { title: input.title } : {}),
      });
      requireSuccess(result, "session.update");
    },

    async switchAgent(ref, agent) {
      const result = await sdk.v2.session.switchAgent({ sessionID: sessionID(ref), agent });
      requireSuccess(result, "session.switchAgent");
    },

    async switchModel(ref, model) {
      const result = await sdk.v2.session.switchModel({ sessionID: sessionID(ref), model });
      requireSuccess(result, "session.switchModel");
    },

    async prompt(ref, input) {
      const info = await sessions.get(ref);
      const result = await sdk.session.promptAsync({
        sessionID: sessionID(ref),
        ...sessionLocationQuery(info.location),
        ...(input.id !== undefined ? { messageID: openCodeMessageID(input.id) } : {}),
        ...(info.agent !== undefined ? { agent: info.agent } : {}),
        ...(info.model !== undefined
          ? { model: { providerID: info.model.providerID, modelID: info.model.id } }
          : {}),
        ...(info.model?.variant !== undefined ? { variant: info.model.variant } : {}),
        parts: promptParts(input.prompt, info.location.directory),
      });
      requireSuccess(result, "session.prompt");
    },

    async compact(ref) {
      // Prompt execution and compaction share the stable runner. The generated
      // V2 compact operation is present in the schema but always returns
      // OperationUnavailableError at 1.18.10.
      const info = await sessions.get(ref);
      if (info.model === undefined) {
        throw new Error(`Cannot compact session ${info.id} before selecting a model.`);
      }
      const result = await sdk.session.summarize({
        sessionID: sessionID(ref),
        ...sessionLocationQuery(info.location),
        providerID: info.model.providerID,
        modelID: info.model.id,
        auto: false,
      });
      requireSuccess(result, "session.compact");
    },

    async wait(ref) {
      const result = await sdk.v2.session.wait({ sessionID: sessionID(ref) });
      requireSuccess(result, "session.wait");
    },

    async context(ref) {
      const result = await sdk.v2.session.context({ sessionID: sessionID(ref) });
      return requireData(result, "session.context").data;
    },

    async interrupt(ref) {
      const location = await resolveSessionLocation(ref);
      const result = await sdk.session.abort({
        sessionID: sessionID(ref),
        ...sessionLocationQuery(location),
      });
      requireSuccess(result, "session.interrupt");
    },

    async messages(ref, input) {
      const result = await sdk.v2.session.messages({
        sessionID: sessionID(ref),
        ...(input?.limit !== undefined ? { limit: input.limit } : {}),
        ...(input?.cursor !== undefined
          ? { cursor: input.cursor }
          : input?.order !== undefined
            ? { order: input.order }
            : {}),
      });
      return requireData(result, "session.messages");
    },

    async transcript(ref) {
      const info = await sessions.get(ref);
      const [persisted, projected] = await Promise.allSettled([
        listAllPersistedMessages(info),
        listAllProjectedMessages(ref),
      ]);
      if (persisted.status === "rejected" && projected.status === "rejected") {
        throw persisted.reason;
      }
      // A single failed plane still renders, but the failure stays visible in
      // sources so session debug info can tell "empty" from "fetch failed".
      return projectOpenCodeTranscript(
        info,
        persisted.status === "fulfilled" ? persisted.value : [],
        projected.status === "fulfilled" ? projected.value : [],
        {
          ...(persisted.status === "rejected"
            ? { persisted: errorMessage(persisted.reason, "persisted transcript fetch failed") }
            : {}),
          ...(projected.status === "rejected"
            ? { projected: errorMessage(projected.reason, "projected transcript fetch failed") }
            : {}),
        },
      );
    },

    async lastTurnDiff(ref) {
      const location = await resolveSessionLocation(ref);
      const id = sessionID(ref);
      // Server-side `session.diff` is SessionSummary.diff: it returns [] unless
      // messageID names a persisted *user* message, whose turn summary it reads.
      // Resolve that ID from the same stable-plane store, newest page first.
      const recent = requireData(
        await sdk.session.messages({
          sessionID: id,
          ...sessionLocationQuery(location),
          limit: 200,
        }),
        "session.lastTurnDiff.messages",
      );
      const messageID = recent.findLast((entry) => entry.info.role === "user")?.info.id;
      if (messageID === undefined) return [];
      const result = await sdk.session.diff({
        sessionID: id,
        ...sessionLocationQuery(location),
        messageID,
      });
      // Snapshot rows leave `file` and `status` optional; upstream's own TUI drops
      // fileless rows and defaults the status, which is what the diff views expect.
      return requireData(result, "session.diff").flatMap((diff) =>
        diff.file === undefined
          ? []
          : [{ ...diff, file: diff.file, status: diff.status ?? ("modified" as const) }],
      );
    },

    async revert(ref, input) {
      const location = await resolveSessionLocation(ref);
      const result = await sdk.session.revert({
        sessionID: sessionID(ref),
        ...sessionLocationQuery(location),
        messageID: input.messageID,
      });
      requireSuccess(result, "session.revert");
    },

    async unrevert(ref) {
      const location = await resolveSessionLocation(ref);
      const result = await sdk.session.unrevert({
        sessionID: sessionID(ref),
        ...sessionLocationQuery(location),
      });
      requireSuccess(result, "session.unrevert");
    },

    async permissions(ref) {
      const id = sessionID(ref);
      const result = await requests.permissions(await resolveSessionLocation(ref));
      return result.data.filter((request) => request.sessionID === id);
    },

    async replyPermission(ref, requestID, reply, message) {
      const result = await sdk.v2.session.permission.reply({
        sessionID: sessionID(ref),
        requestID,
        reply,
        ...(message !== undefined ? { message } : {}),
      });
      requireSuccess(result, "session.permission.reply");
    },

    async questions(ref) {
      const id = sessionID(ref);
      const result = await requests.questions(await resolveSessionLocation(ref));
      return result.data.filter((request) => request.sessionID === id);
    },

    async replyQuestion(ref, requestID, reply) {
      const result = await sdk.question.reply({
        requestID,
        ...sessionLocationQuery(await resolveSessionLocation(ref)),
        answers: reply.answers,
      });
      requireSuccess(result, "question.reply");
    },

    async rejectQuestion(ref, requestID) {
      const result = await sdk.question.reject({
        requestID,
        ...sessionLocationQuery(await resolveSessionLocation(ref)),
      });
      requireSuccess(result, "question.reject");
    },
  };

  const agents: OpenCodeAgentApi = {
    async list(location) {
      const query = locationQuery(location);
      const result = await sdk.v2.agent.list(query === undefined ? {} : { location: query });
      return requireData(result, "agent.list");
    },
  };

  const models: OpenCodeModelApi = {
    async list(location) {
      const query = locationQuery(location);
      const result = await sdk.v2.model.list(query === undefined ? {} : { location: query });
      return requireData(result, "model.list");
    },
  };

  const files: OpenCodeFileApi = {
    async find(query, location, options) {
      const resolved = locationQuery(location);
      const result = await sdk.v2.fs.find(
        {
          query,
          limit: "32",
          ...(resolved === undefined ? {} : { location: resolved }),
        },
        options,
      );
      return requireData(result, "fs.find");
    },
    async list(path, location) {
      const resolved = locationQuery(location);
      const result = await sdk.v2.fs.list({
        ...(path === undefined ? {} : { path }),
        ...(resolved === undefined ? {} : { location: resolved }),
      });
      return requireData(result, "fs.list");
    },
    async read(path, location) {
      // Stable-plane route: the generated sdk.v2.fs.read cannot address a file
      // because it hardcodes the wildcard URL.
      const content = requireData(
        await sdk.file.read({ path, ...locationQuery(location) }),
        "file.read",
      );
      if (content.type === "text") return { kind: "text", text: content.content };
      return {
        kind: "binary",
        base64: content.content,
        ...(content.mimeType === undefined ? {} : { mimeType: content.mimeType }),
      };
    },
  };

  const commands: OpenCodeCommandApi = {
    async list(location) {
      const resolved = locationQuery(location);
      const result = await sdk.v2.command.list(
        resolved === undefined ? {} : { location: resolved },
      );
      return requireData(result, "command.list");
    },
  };

  const skills: OpenCodeSkillApi = {
    async list(location) {
      const resolved = locationQuery(location);
      const result = await sdk.v2.skill.list(resolved === undefined ? {} : { location: resolved });
      return requireData(result, "skill.list");
    },
  };

  const projectCopies: OpenCodeProjectCopyApi = {
    async create(input) {
      const query = locationQuery(input.location);
      const result = await sdk.v2.projectCopy.create({
        projectID: input.projectID,
        ...(query === undefined ? {} : { location: query }),
        strategy: input.strategy,
        directory: input.directory,
        ...(input.name === undefined ? {} : { name: input.name }),
      });
      return requireData(result, "projectCopy.create");
    },
    async remove(input) {
      const query = locationQuery(input.location);
      const result = await sdk.v2.projectCopy.remove({
        projectID: input.projectID,
        ...(query === undefined ? {} : { location: query }),
        directory: input.directory,
        force: input.force,
      });
      requireSuccess(result, "projectCopy.remove");
    },
  };

  const providers: OpenCodeProviderApi = {
    async list() {
      const result = await sdk.v2.integration.list();
      return requireData(result, "integration.list").data;
    },
    async connectOauth(integrationID, methodID, inputs) {
      const result = await sdk.v2.integration.connect.oauth({
        integrationID,
        methodID,
        inputs: { ...inputs },
      });
      return requireData(result, "integration.connect.oauth").data;
    },
    async oauthStatus(attemptID) {
      const result = await sdk.v2.integration.attempt.status({ attemptID });
      return requireData(result, "integration.attempt.status").data;
    },
    async completeOauth(attemptID, code) {
      const result = await sdk.v2.integration.attempt.complete({
        attemptID,
        ...(code === undefined ? {} : { code }),
      });
      requireSuccess(result, "integration.attempt.complete");
    },
    async cancelOauth(attemptID) {
      const result = await sdk.v2.integration.attempt.cancel({ attemptID });
      requireSuccess(result, "integration.attempt.cancel");
    },
    async setApiKey(integrationID, value) {
      const result = await sdk.v2.integration.connect.key({ integrationID, key: value });
      requireSuccess(result, "integration.connect.key");
    },
    async removeCredential(credentialID) {
      const result = await sdk.v2.credential.remove({ credentialID });
      requireSuccess(result, "credential.remove");
    },
  };

  const vcs: OpenCodeVcsApi = {
    async info(location) {
      const result = await sdk.vcs.get(locationQuery(location));
      return requireData(result, "vcs.get");
    },
    async status(location) {
      const result = await sdk.vcs.status(locationQuery(location));
      return requireData(result, "vcs.status");
    },
    async diff(input) {
      const location = locationQuery(input);
      const result = await sdk.vcs.diff({
        ...location,
        mode: input.mode,
        ...(input.context === undefined ? {} : { context: input.context }),
      });
      return requireData(result, "vcs.diff");
    },
  };

  // MCP management and the merged-config read live on the stable plane because
  // the generated V2 class exposes neither at 1.18.10.
  const mcp: OpenCodeMcpApi = {
    async status(location) {
      const result = await sdk.mcp.status(locationQuery(location));
      return requireData(result, "mcp.status");
    },
    async add(name, config, location) {
      const result = await sdk.mcp.add({ name, config, ...locationQuery(location) });
      return requireData(result, "mcp.add");
    },
    async connect(name, location) {
      const result = await sdk.mcp.connect({ name, ...locationQuery(location) });
      return requireData(result, "mcp.connect");
    },
    async disconnect(name, location) {
      const result = await sdk.mcp.disconnect({ name, ...locationQuery(location) });
      return requireData(result, "mcp.disconnect");
    },
    async authenticate(name, location) {
      // The sidecar opens the browser and blocks until the OAuth callback lands, so
      // this request stays open for the whole flow.
      const result = await sdk.mcp.auth.authenticate({ name, ...locationQuery(location) });
      return requireData(result, "mcp.auth.authenticate");
    },
    async removeAuth(name, location) {
      const result = await sdk.mcp.auth.remove({ name, ...locationQuery(location) });
      requireSuccess(result, "mcp.auth.remove");
    },
  };

  const config: OpenCodeConfigApi = {
    async get(location) {
      // Read-only: config writes would fight Honk's generated overlay.
      const result = await sdk.config.get(locationQuery(location));
      return requireData(result, "config.get");
    },
  };

  const savedPermissions: OpenCodeSavedPermissionApi = {
    async list() {
      const result = await sdk.v2.permission.saved.list();
      return requireData(result, "permission.saved.list").data;
    },
    async remove(id) {
      const result = await sdk.v2.permission.saved.remove({ id });
      requireSuccess(result, "permission.saved.remove");
    },
  };

  return {
    server,
    async health() {
      const result = await sdk.v2.health.get();
      requireData(result, "health.get");
    },
    async resolveLocation(location) {
      const query = locationQuery(location);
      const result = await sdk.v2.location.get(query === undefined ? {} : { location: query });
      return requireData(result, "location.get");
    },
    async resolvePath(location) {
      const result = await sdk.path.get(locationQuery(location) ?? {});
      return requireData(result, "path.get");
    },
    sessions,
    requests,
    agents,
    models,
    files,
    commands,
    skills,
    projectCopies,
    providers,
    vcs,
    mcp,
    config,
    savedPermissions,
    events(signal) {
      return (async function* eventIterator(): AsyncGenerator<OpenCodeEvent> {
        const tracked = trackEventController(signal);
        try {
          if (options?.eventSource !== undefined) {
            const stream = await options.eventSource({
              url: `${server.origin.replace(/\/+$/, "")}/global/event`,
              headers,
              signal: tracked.controller.signal,
            });
            for await (const event of stream) {
              const parsed = globalStreamEvent(event);
              if (parsed !== null) yield parsed;
            }
            return;
          }
          const result = await sdk.global.event({ signal: tracked.controller.signal });
          for await (const event of result.stream) {
            const parsed = globalStreamEvent(event);
            if (parsed !== null) yield parsed;
          }
        } finally {
          tracked.release();
        }
      })();
    },
    close() {
      for (const controller of eventControllers) {
        controller.abort();
      }
      eventControllers.clear();
      sessionLocations.clear();
      sessionLocationLoads.clear();
    },
  };
}

export {
  createOpenCodeClient,
  OPEN_CODE_CAPABILITIES,
  OPEN_CODE_SESSION_CAPABILITIES,
  OpenCodeRequestError,
};
export type {
  OpenCodeAgentApi,
  OpenCodeCommandApi,
  OpenCodeClient,
  OpenCodeClientOptions,
  OpenCodeConfigApi,
  OpenCodeCreateProjectCopyInput,
  OpenCodeCreateSessionInput,
  OpenCodeEvent,
  OpenCodeFileApi,
  OpenCodeFileContent,
  OpenCodeFileSystemEntry,
  OpenCodeListSessionsInput,
  OpenCodeLocatedResult,
  OpenCodeLocationQuery,
  OpenCodeMcpApi,
  OpenCodeMcpServerConfig,
  OpenCodeMessagesInput,
  OpenCodeModelApi,
  OpenCodeProjectCopyApi,
  OpenCodePrompt,
  OpenCodePromptInput,
  OpenCodeRequestApi,
  OpenCodeRevertInput,
  OpenCodeSavedPermissionApi,
  OpenCodeSessionApi,
  OpenCodeSkillApi,
  OpenCodePathInfo,
  OpenCodeRemoveProjectCopyInput,
  OpenCodeUpdateSessionInput,
  OpenCodeVcsApi,
};
