import {
  createOpencodeClient,
  type AgentPartInput as OpenCodeAgentPartInput,
  type AgentV2Info as OpenCodeAgentInfo,
  type FilePartInput as OpenCodeFilePartInput,
  type LocationInfo as OpenCodeLocationInfo,
  type ModelRef as OpenCodeModelRef,
  type ModelV2Info as OpenCodeModelInfo,
  type PermissionV2Reply as OpenCodePermissionReply,
  type PermissionV2Request as OpenCodePermissionRequest,
  type ProjectCopyCopy as OpenCodeProjectCopy,
  type PromptInput as OpenCodePrompt,
  type PromptInputFileAttachment as OpenCodePromptFileAttachment,
  type QuestionV2Reply as OpenCodeQuestionReply,
  type QuestionV2Request as OpenCodeQuestionRequest,
  type SessionHistory as OpenCodeSessionHistory,
  type SessionDurableEvent as OpenCodeDurableSessionEvent,
  type SessionMessage as OpenCodeSessionMessage,
  type SessionMessagesResponse as OpenCodeSessionMessages,
  type SessionV2Info as OpenCodeSessionInfo,
  type SessionsResponse as OpenCodeSessions,
  type TextPartInput as OpenCodeTextPartInput,
  type V2Event as OpenCodeEvent,
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
import {
  createManagedAnthropicImport,
  type ManagedAnthropicDependencies,
  type OpenCodeProviderApi,
} from "./provider-auth";
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

type OpenCodePromptInput = {
  readonly id?: OpenCodeMessageID;
  readonly prompt: OpenCodePrompt;
  readonly delivery?: "steer" | "queue";
  readonly resume?: boolean;
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

type OpenCodeHistoryInput = {
  readonly limit?: number;
  readonly after?: number;
};

type OpenCodeSessionEventsInput = {
  readonly after?: string;
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
  readonly active: () => Promise<OpenCodeSessionActiveResponse["data"]>;
  readonly get: (ref: OpenCodeSessionRef) => Promise<OpenCodeSessionInfo>;
  readonly switchAgent: (ref: OpenCodeSessionRef, agent: string) => Promise<void>;
  readonly switchModel: (ref: OpenCodeSessionRef, model: OpenCodeModelRef) => Promise<void>;
  readonly prompt: (ref: OpenCodeSessionRef, input: OpenCodePromptInput) => Promise<void>;
  readonly compact: (ref: OpenCodeSessionRef) => Promise<void>;
  readonly wait: (ref: OpenCodeSessionRef) => Promise<void>;
  readonly context: (ref: OpenCodeSessionRef) => Promise<readonly OpenCodeSessionMessage[]>;
  readonly history: (
    ref: OpenCodeSessionRef,
    input?: OpenCodeHistoryInput,
  ) => Promise<OpenCodeSessionHistory>;
  readonly events: (
    ref: OpenCodeSessionRef,
    input?: OpenCodeSessionEventsInput,
    signal?: AbortSignal,
  ) => AsyncIterable<OpenCodeDurableSessionEvent>;
  readonly interrupt: (ref: OpenCodeSessionRef) => Promise<void>;
  readonly message: (ref: OpenCodeSessionRef, messageID: string) => Promise<OpenCodeSessionMessage>;
  readonly messages: (
    ref: OpenCodeSessionRef,
    input?: OpenCodeMessagesInput,
  ) => Promise<OpenCodeSessionMessages>;
  readonly transcript: (ref: OpenCodeSessionRef) => Promise<OpenCodeSessionTranscript>;
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

type OpenCodeRequestApi = {
  readonly permissions: (
    location: OpenCodeLocationQuery,
  ) => Promise<OpenCodeLocatedResult<OpenCodePermissionRequest>>;
  readonly questions: (
    location: OpenCodeLocationQuery,
  ) => Promise<OpenCodeLocatedResult<OpenCodeQuestionRequest>>;
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

type OpenCodeClient = {
  readonly server: OpenCodeServerDescriptor;
  readonly health: () => Promise<void>;
  readonly resolveLocation: (location?: OpenCodeLocationQuery) => Promise<OpenCodeLocationInfo>;
  readonly sessions: OpenCodeSessionApi;
  readonly requests: OpenCodeRequestApi;
  readonly agents: OpenCodeAgentApi;
  readonly models: OpenCodeModelApi;
  readonly projectCopies: OpenCodeProjectCopyApi;
  readonly providers: OpenCodeProviderApi;
  readonly vcs: OpenCodeVcsApi;
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
  history: true,
  events: true,
  interrupt: true,
  messages: true,
  transcript: true,
  revert: true,
  permissions: true,
  questions: true,
  rename: false,
  archive: false,
  remove: false,
  fork: false,
  commandExecution: false,
} as const);

const OPEN_CODE_CAPABILITIES = Object.freeze({
  sessions: OPEN_CODE_SESSION_CAPABILITIES,
  agents: true,
  models: true,
  vcs: true,
  providers: true,
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

function requireStreamEvent<T>(value: unknown, operation: string): T {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new OpenCodeRequestError(operation, "OpenCode sent an invalid event payload.");
  }
  return value as T;
}

function eventUrl(origin: string, path: string, query?: URLSearchParams): string {
  const suffix = query === undefined || query.size === 0 ? "" : `?${query.toString()}`;
  return `${origin.replace(/\/+$/, "")}${path}${suffix}`;
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
    ...(prompt.text.length > 0 ? [{ type: "text" as const, text: prompt.text }] : []),
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
      const result = await sdk.v2.question.request.list(
        query === undefined ? {} : { location: query },
      );
      return requireData(result, "question.request.list");
    },
  };

  // OpenCode 1.18's V2 runner does not load OPENCODE_CONFIG, while the stable
  // runner does. Keep execution, status, and abort on the generated stable
  // session methods so Honk's agents and provider models resolve; V2 owns projection.
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

    async active() {
      const result = await sdk.session.status();
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
      const result = await sdk.v2.session.compact({ sessionID: sessionID(ref) });
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

    async history(ref, input) {
      const result = await sdk.v2.session.history({
        sessionID: sessionID(ref),
        ...(input?.limit !== undefined ? { limit: input.limit } : {}),
        ...(input?.after !== undefined ? { after: input.after } : {}),
      });
      return requireData(result, "session.history");
    },

    events(ref, input, signal) {
      const id = sessionID(ref);
      return (async function* sessionEventIterator(): AsyncGenerator<OpenCodeDurableSessionEvent> {
        const tracked = trackEventController(signal);
        try {
          if (options?.eventSource !== undefined) {
            const query = new URLSearchParams();
            if (input?.after !== undefined) query.set("after", input.after);
            const stream = await options.eventSource({
              url: eventUrl(server.origin, `/api/session/${encodeURIComponent(id)}/event`, query),
              headers,
              signal: tracked.controller.signal,
            });
            for await (const event of stream) {
              yield requireStreamEvent<OpenCodeDurableSessionEvent>(event, "session.events");
            }
            return;
          }
          const result = await sdk.v2.session.events(
            {
              sessionID: id,
              ...(input?.after !== undefined ? { after: input.after } : {}),
            },
            { signal: tracked.controller.signal },
          );
          for await (const event of result.stream) {
            yield requireStreamEvent<OpenCodeDurableSessionEvent>(event, "session.events");
          }
        } finally {
          tracked.release();
        }
      })();
    },

    async interrupt(ref) {
      const location = await resolveSessionLocation(ref);
      const result = await sdk.session.abort({
        sessionID: sessionID(ref),
        ...sessionLocationQuery(location),
      });
      requireSuccess(result, "session.interrupt");
    },

    async message(ref, messageID) {
      const result = await sdk.v2.session.message({
        sessionID: sessionID(ref),
        messageID,
      });
      return requireData(result, "session.message").data;
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
      return projectOpenCodeTranscript(
        info,
        persisted.status === "fulfilled" ? persisted.value : [],
        projected.status === "fulfilled" ? projected.value : [],
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
      const result = await sdk.v2.session.question.reply({
        sessionID: sessionID(ref),
        requestID,
        questionV2Reply: reply,
      });
      requireSuccess(result, "session.question.reply");
    },

    async rejectQuestion(ref, requestID) {
      const result = await sdk.v2.session.question.reject({
        sessionID: sessionID(ref),
        requestID,
      });
      requireSuccess(result, "session.question.reject");
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

  const providerCore: ManagedAnthropicDependencies = {
    async list() {
      const result = await sdk.provider.list();
      const inventory = requireData(result, "provider.list");
      const connected = new Set(inventory.connected);
      return Object.freeze({
        providers: Object.freeze(
          inventory.all.map((provider) =>
            Object.freeze({
              id: provider.id,
              name: provider.name,
              connected: connected.has(provider.id),
            }),
          ),
        ),
      });
    },
    async authMethods(providerID) {
      const result = await sdk.provider.auth();
      const methods = requireData(result, "provider.auth")[providerID] ?? [];
      return Object.freeze(
        methods.map((method, index) =>
          Object.freeze({
            ...method,
            index,
            prompts: Object.freeze([...(method.prompts ?? [])]),
          }),
        ),
      );
    },
    async authorizeOauth(providerID, methodIndex, inputs) {
      const result = await sdk.provider.oauth.authorize({
        providerID,
        method: methodIndex,
        inputs: { ...inputs },
      });
      return requireData(result, "provider.oauth.authorize");
    },
    async completeOauth(providerID, methodIndex, code) {
      const result = await sdk.provider.oauth.callback({
        providerID,
        method: methodIndex,
        ...(code === undefined ? {} : { code }),
      });
      requireSuccess(result, "provider.oauth.callback");
    },
  };
  const ensureManagedAnthropicImport = createManagedAnthropicImport(providerCore);
  const providers: OpenCodeProviderApi = {
    ...providerCore,
    async setApiKey(providerID, value) {
      const result = await sdk.auth.set({ providerID, auth: { type: "api", key: value } });
      requireSuccess(result, "auth.set");
    },
    async removeAuth(providerID) {
      const result = await sdk.auth.remove({ providerID });
      requireSuccess(result, "auth.remove");
    },
    ensureManagedAnthropicImport,
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
    sessions,
    requests,
    agents,
    models,
    projectCopies,
    providers,
    vcs,
    events(signal) {
      return (async function* eventIterator(): AsyncGenerator<OpenCodeEvent> {
        const tracked = trackEventController(signal);
        try {
          if (options?.eventSource !== undefined) {
            const stream = await options.eventSource({
              url: eventUrl(server.origin, "/api/event"),
              headers,
              signal: tracked.controller.signal,
            });
            for await (const event of stream) {
              yield requireStreamEvent<OpenCodeEvent>(event, "event.subscribe");
            }
            return;
          }
          const result = await sdk.v2.event.subscribe({ signal: tracked.controller.signal });
          for await (const event of result.stream) {
            yield requireStreamEvent<OpenCodeEvent>(event, "event.subscribe");
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
  OpenCodeClient,
  OpenCodeClientOptions,
  OpenCodeCreateProjectCopyInput,
  OpenCodeCreateSessionInput,
  OpenCodeHistoryInput,
  OpenCodeListSessionsInput,
  OpenCodeLocatedResult,
  OpenCodeLocationQuery,
  OpenCodeMessagesInput,
  OpenCodeModelApi,
  OpenCodeProjectCopyApi,
  OpenCodePromptInput,
  OpenCodeRequestApi,
  OpenCodeRevertInput,
  OpenCodeSessionEventsInput,
  OpenCodeSessionApi,
  OpenCodeRemoveProjectCopyInput,
  OpenCodeVcsApi,
};
