// Shared OpenCode data layer. This is the seam between Honk clients and the
// `opencode serve` process: it owns the @opencode-ai/sdk client, the single
// global SSE event pump, and the reducers that project opencode sessions +
// messages onto the domain shapes the UI already consumes.
//
// Why a wrapper instead of exposing the raw sdk: the workspace/tab/command-menu
// plane was written against a small, stable "thread summary" vocabulary
// (WorkspaceState / ThreadSummary / ThreadState / WatchStatus / watch handlers).
// Keeping those names and shapes here means home + command-menu + tab-store keep
// compiling unchanged — only the import source moves from @honk/sdk to ./sidecar.
//
// Altitude: opencode is a LOCAL sidecar. There is one HTTP origin and one event
// stream; every session op rides the same client. We never speak the old honk
// Core wire (/core/v1/*) — that surface is gone.

import {
  createOpencodeClient,
  type Event,
  type Message,
  type OpencodeClient,
  type Part,
  type Session,
  type SessionStatus,
} from "@opencode-ai/sdk/v2/client";

import { openCodeAuthorizationHeader } from "./connection";

// ── Stable domain vocabulary (kept identical to the old @honk/sdk surface) ────────────────────

/** Watch lifecycle word the UI switches on. Mirrors the old SDK exactly. */
export type WatchStatus = "live" | "reconnecting" | "closed" | "unauthorized";

/**
 * The thread-row shape the workspace plane reads. Field-for-field compatible
 * with the old honk ThreadSummary subset that command-menu / tab-store / thread
 * notifications touch: id, title, status, needsAttention, archivedAt, updatedAt,
 * worktree.path. Timestamps are ISO strings so `localeCompare` sorts them
 * chronologically (opencode stores epoch millis, converted on projection).
 */
export type ThreadSummary = {
  readonly id: string;
  readonly title: string;
  readonly status: "running" | "failed" | "idle";
  readonly needsAttention: boolean;
  readonly archivedAt: string | null;
  readonly updatedAt: string;
  /** opencode project id (its `projectID`); null when the session is projectless. */
  readonly projectId: string | null;
  /** opencode has no git-worktree branch on a session, so `branch` is always null. */
  readonly worktree: { readonly path: string | null; readonly branch: string | null } | null;
};

export type SideChatInfo = {
  readonly parentThreadId: string;
  readonly seedMessageCount: number;
};

export type SideChatSummary = ThreadSummary & SideChatInfo;

export type WorkspaceState = {
  readonly threads: readonly ThreadSummary[];
  readonly sideChats: readonly SideChatSummary[];
  readonly seq: number;
};

/**
 * Thread-detail projection. opencode's Message/Part model is native here — this
 * is NOT the old honk Part shape, so the current thread.tsx transcript renderer
 * will need reworking against these types (see the impl report punch list).
 */
export type ThreadState = {
  readonly summary: ThreadSummary;
  readonly sideChat: SideChatInfo | null;
  readonly cwd: string;
  readonly messages: readonly Message[];
  readonly parts: readonly Part[];
  readonly queue: readonly never[];
  readonly seq: number;
};

export type ThreadWatchHandlers = {
  readonly onChange: (state: ThreadState) => void;
  readonly onStatus?: (status: WatchStatus) => void;
};

export type WorkspaceWatchHandlers = {
  readonly onChange: (state: WorkspaceState) => void;
  readonly onStatus?: (status: WatchStatus) => void;
};

export type ThreadWatch = { readonly close: () => void };
export type WorkspaceWatch = { readonly close: () => void };

/** Preset dial + optional explicit model, pinned at thread birth. */
export type ThreadPreset = {
  readonly agent?: string;
  readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string };
  readonly variant?: string;
};

export type CreateThreadInput = {
  /** Working directory for the new session (opencode `directory`). */
  readonly cwd?: string;
  readonly title?: string;
} & ThreadPreset;

// ── Project / provider / composer vocabulary (settings + composer seams) ───────────────────────

/** Narrowed opencode Project (client.project.list()). `worktree` is the project root path. */
export type SidecarProject = {
  readonly id: string;
  readonly worktree: string;
  readonly name: string | null;
  readonly vcs: string | null;
};

export type SidecarProviderAuthPrompt =
  | {
      readonly type: "text";
      readonly key: string;
      readonly message: string;
      readonly placeholder?: string;
      readonly when?: {
        readonly key: string;
        readonly op: "eq" | "neq";
        readonly value: string;
      };
    }
  | {
      readonly type: "select";
      readonly key: string;
      readonly message: string;
      readonly options: readonly {
        readonly label: string;
        readonly value: string;
        readonly hint?: string;
      }[];
      readonly when?: {
        readonly key: string;
        readonly op: "eq" | "neq";
        readonly value: string;
      };
    };

/** One indexed authentication method a provider advertises (client.provider.auth()). */
export type SidecarProviderAuthMethod = {
  readonly index: number;
  readonly type: "oauth" | "api";
  readonly label: string;
  readonly prompts: readonly SidecarProviderAuthPrompt[];
};

/** A provider row for the settings UI: identity, whether it is connected, and its auth methods. */
export type SidecarProvider = {
  readonly id: string;
  readonly name: string;
  readonly source: "env" | "config" | "custom" | "api";
  readonly connected: boolean;
  readonly authMethods: readonly SidecarProviderAuthMethod[];
};

/** The provider inventory: every provider plus the connected id set and per-provider default model. */
export type ProviderInventory = {
  readonly providers: readonly SidecarProvider[];
  readonly connected: readonly string[];
  readonly defaults: Readonly<Record<string, string>>;
};

/**
 * OAuth authorization handoff (client.provider.oauth.authorize()). `method` selects the follow-up:
 * "auto" runs its callback immediately (which may poll); "code" needs the user to paste a code
 * before the callback runs.
 */
export type ProviderOauthAuthorization = {
  readonly url: string;
  readonly method: "auto" | "code";
  readonly instructions: string;
};

// ── Workbench vocabulary (files + changes panels) ──────────────────────────────────────────────

/** One working-tree change (client.file.status()): path + line counts + change kind. */
export type SidecarChange = {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly status: "added" | "deleted" | "modified";
};

/** One entry of a directory listing (client.file.list()). */
export type SidecarFileNode = {
  readonly name: string;
  readonly path: string;
  readonly type: "file" | "directory";
  readonly ignored: boolean;
};

/** A diff hunk from FileContent.patch — the changes panel renders these verbatim. */
export type SidecarDiffHunk = {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  /** Unified-diff lines, each prefixed with " ", "+" or "-". */
  readonly lines: readonly string[];
};

/** File content (client.file.read()): raw text plus the working-tree patch when one exists. */
export type SidecarFileContent = {
  readonly type: "text" | "binary";
  readonly content: string;
  readonly hunks: readonly SidecarDiffHunk[] | null;
  readonly mimeType: string | null;
};

/** Narrowed opencode Command (client.command.list()) for the composer's slash-command menu. */
export type SidecarCommand = {
  readonly name: string;
  readonly description: string | null;
  readonly agent: string | null;
  readonly model: string | null;
  readonly template: string;
  readonly subtask: boolean;
};

/** A file attachment from the composer, appended to a prompt as an opencode FilePartInput. */
export type SendMessageFile = {
  /**
   * A path (absolutized against the session directory and wrapped as `file://<abs>` — the
   * server hands the url to fileURLToPath, which rejects relative forms) or a full
   * `data:`/`file://` url — pasted/dropped images arrive as data: urls with bytes inline.
   */
  readonly path: string;
  readonly mime?: string;
  /** Display name for the part; required for data: urls (no basename to derive). */
  readonly filename?: string;
};

/** Slash-command invocation (client.session.command). */
export type RunCommandInput = {
  readonly command: string;
  readonly arguments: string;
  readonly agent?: string;
  readonly model?: string;
  readonly directory?: string;
};

export type SendMessageInput = {
  readonly messageId: string;
  readonly text: string;
  // Per-prompt MODE agent override (`honk-<mode>` — modes.ts). Mode is soft state; the
  // model/variant stay hard-pinned. Omitted → the agent pinned at birth.
  readonly agent?: string;
  // File mentions to attach after the text part (opencode FilePartInput, url = `file://<path>`).
  readonly files?: readonly SendMessageFile[];
  // Durable side chats @-mentioned by the parent composer. Their visible transcripts become
  // reference-only system context for this prompt and stay out of the rendered user bubble.
  readonly sideChatIds?: readonly string[];
};

export type ThreadDetail = {
  readonly summary: ThreadSummary;
  readonly cwd: string;
};

/**
 * The action + watch surface the stores call. Aliased below as `HonkClient` so
 * existing `Parameters<HonkClient["threads"]["send"]>` type plumbing in
 * tab-store keeps resolving without edits beyond the import path.
 */
export interface SidecarClient {
  readonly threads: {
    readonly create: (payload: CreateThreadInput) => Promise<ThreadSummary>;
    readonly createSideChat: (parentThreadId: string) => Promise<SideChatSummary>;
    readonly get: (threadId: string) => Promise<ThreadDetail>;
    readonly send: (threadId: string, payload: SendMessageInput) => Promise<void>;
    readonly interrupt: (threadId: string) => Promise<void>;
    readonly watch: (threadId: string, handlers: ThreadWatchHandlers) => ThreadWatch;
    /** Run a slash command in a thread (client.session.command). */
    readonly runCommand: (threadId: string, input: RunCommandInput) => Promise<void>;
    /**
     * Rename a session (client.session.update). The v2 core never generates titles
     * (runner/llm.ts TODO) — honk titles threads itself from the first prompt line.
     */
    readonly setTitle: (threadId: string, title: string) => Promise<void>;
  };
  readonly workspace: {
    readonly snapshot: () => Promise<WorkspaceState>;
    readonly watch: (handlers: WorkspaceWatchHandlers) => WorkspaceWatch;
  };
  // ── Project / directory seams ────────────────────────────────────────────────────────────────
  /** Projects opencode has opened (client.project.list()). */
  readonly listProjects: () => Promise<readonly SidecarProject[]>;
  /** The sidecar's default working directory (client.path.get().directory). */
  readonly defaultDirectory: () => Promise<string>;
  // ── Provider / auth seams (settings) ─────────────────────────────────────────────────────────
  /** Every provider with its connected flag + auth methods (client.provider.list() + .auth()). */
  readonly listProviders: () => Promise<ProviderInventory>;
  /** Store an API-key credential for a provider (client.auth.set, {type:"api"}). */
  readonly setProviderApiKey: (providerID: string, key: string) => Promise<void>;
  /** Begin one advertised OAuth method for a provider (client.provider.oauth.authorize()). */
  readonly authorizeProviderOauth: (
    providerID: string,
    method: number,
    inputs?: Readonly<Record<string, string>>,
  ) => Promise<ProviderOauthAuthorization>;
  /** Finish an OAuth method, with a code only when its authorization requests one. */
  readonly completeProviderOauth: (
    providerID: string,
    method: number,
    code?: string,
  ) => Promise<void>;
  /** Remove a provider's stored credentials (client.auth.remove()). */
  readonly removeProviderAuth: (providerID: string) => Promise<void>;
  // ── Composer data seams ──────────────────────────────────────────────────────────────────────
  /** Fuzzy file search for @-mentions (client.find.files()). */
  readonly findFiles: (query: string, directory?: string) => Promise<readonly string[]>;
  /** Available slash commands (client.command.list()). */
  readonly listCommands: (directory?: string) => Promise<readonly SidecarCommand[]>;
  // ── Workbench seams (files + changes panels) ────────────────────────────────────────────────
  /** Working-tree changes for a project instance (client.file.status()). */
  readonly fileStatus: (directory: string) => Promise<readonly SidecarChange[]>;
  /** Directory listing (client.file.list()); path "" or "." lists the project root. */
  readonly listFiles: (path: string, directory: string) => Promise<readonly SidecarFileNode[]>;
  /** File content + working-tree patch (client.file.read()). */
  readonly readFile: (path: string, directory: string) => Promise<SidecarFileContent>;
  /** The project's VCS branch, or null outside a repo (client.vcs.get()). */
  readonly vcsBranch: (directory: string) => Promise<string | null>;
  readonly close: () => Promise<void>;
}

/** Back-compat alias so consumers that referenced `HonkClient` keep compiling. */
export type HonkClient = SidecarClient;

export type SidecarClientOptions = {
  /**
   * Opencode server basic-auth password, if the sidecar was started with one.
   * The desktop sidecar supervisor hands this over via the bridge; a bare
   * loopback server needs none.
   */
  readonly password?: string;
  /** Native clients inject an XMLHttpRequest-backed SSE transport. */
  readonly eventStreamFactory?: OpenCodeEventStreamFactory;
};

export interface OpenCodeEventEnvelope {
  readonly payload: unknown;
}

export interface OpenCodeEventStreamInput {
  readonly origin: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export type OpenCodeEventStreamFactory = (
  input: OpenCodeEventStreamInput,
) => Promise<AsyncIterable<OpenCodeEventEnvelope>>;

// Presets are server state, not device state. Storing the immutable birth pin in
// session metadata means desktop, web, and mobile all resend the same model bundle.
const PRESET_METADATA_KEY = "honkPreset";

function hasPreset(preset: ThreadPreset): boolean {
  return preset.agent !== undefined || preset.model !== undefined || preset.variant !== undefined;
}

function presetFromSession(session: Session): ThreadPreset | undefined {
  const raw = session.metadata?.[PRESET_METADATA_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const agent = Reflect.get(raw, "agent");
  const variant = Reflect.get(raw, "variant");
  const rawModel = Reflect.get(raw, "model");
  const model =
    typeof rawModel === "object" && rawModel !== null && !Array.isArray(rawModel)
      ? (() => {
          const id = Reflect.get(rawModel, "id");
          const providerID = Reflect.get(rawModel, "providerID");
          const modelVariant = Reflect.get(rawModel, "variant");
          if (typeof id !== "string" || typeof providerID !== "string") return undefined;
          return {
            id,
            providerID,
            ...(typeof modelVariant === "string" ? { variant: modelVariant } : {}),
          };
        })()
      : undefined;
  const preset: ThreadPreset = {
    ...(typeof agent === "string" ? { agent } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(typeof variant === "string" ? { variant } : {}),
  };
  return hasPreset(preset) ? preset : undefined;
}

// ── Projection helpers ────────────────────────────────────────────────────────────────────────

function isoFromMillis(millis: number | undefined): string {
  return new Date(typeof millis === "number" ? millis : 0).toISOString();
}

function summaryFromSession(
  session: Session,
  derived: {
    readonly running: boolean;
    readonly failed: boolean;
    readonly needsAttention: boolean;
  },
): ThreadSummary {
  const status: ThreadSummary["status"] = derived.failed
    ? "failed"
    : derived.running
      ? "running"
      : "idle";
  return {
    id: session.id,
    title: session.title.length > 0 ? session.title : "Untitled",
    status,
    needsAttention: derived.needsAttention,
    archivedAt: session.time.archived !== undefined ? isoFromMillis(session.time.archived) : null,
    updatedAt: isoFromMillis(session.time.updated),
    projectId: session.projectID.length > 0 ? session.projectID : null,
    worktree: {
      path: session.directory.length > 0 ? session.directory : null,
      branch: null,
    },
  };
}

const SIDE_CHAT_METADATA_KEY = "honkSideChat";

const SIDE_CHAT_GUARDRAIL = `<side_chat_guardrail>
This is a side chat forked from a parent conversation. The preceding conversation is the parent thread, provided as reference-only context.
Do not simply continue the parent's task or act on its behalf; answer the side question that follows.
You have full tool access. Default to investigating and answering: read files, search, and run read-only commands freely. Do not make code edits or other workspace mutations (writing or deleting files, git commits, or destructive commands) unless the user explicitly asks you to in this side chat.
</side_chat_guardrail>`;

function sideChatInfoFromSession(session: Session): SideChatInfo | null {
  const raw = session.metadata?.[SIDE_CHAT_METADATA_KEY];
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const parentThreadId = Reflect.get(raw, "parentThreadId");
  const seedMessageCount = Reflect.get(raw, "seedMessageCount");
  if (
    typeof parentThreadId !== "string" ||
    parentThreadId.length === 0 ||
    typeof seedMessageCount !== "number" ||
    !Number.isInteger(seedMessageCount) ||
    seedMessageCount < 0
  ) {
    return null;
  }
  return { parentThreadId, seedMessageCount };
}

function sideChatSummaryFromSession(
  session: Session,
  derived: {
    readonly running: boolean;
    readonly failed: boolean;
    readonly needsAttention: boolean;
  },
): SideChatSummary | null {
  const sideChat = sideChatInfoFromSession(session);
  if (sideChat === null) {
    return null;
  }
  return { ...summaryFromSession(session, derived), ...sideChat };
}

// ── The client + event pump ────────────────────────────────────────────────────────────────────

const RECONNECT_DELAY_MS = 250;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isUnauthorized(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const status = Reflect.get(error, "status") ?? Reflect.get(error, "statusCode");
  return status === 401 || status === 403;
}

type ThreadCache = {
  readonly messages: Message[];
  readonly partsByMessage: Map<string, Part[]>;
};

/**
 * Build the opencode client, the single global event pump, and the reducer
 * caches. The pump starts lazily on the first watcher and stops when the last
 * one leaves. All watchers share one SSE connection (opencode exposes exactly
 * one global stream), fanned out to the workspace and per-thread reducers.
 */
export function createSidecarClient(origin: string, options?: SidecarClientOptions): SidecarClient {
  const headers: Record<string, string> = {};
  if (options?.password !== undefined && options.password.length > 0) {
    // opencode uses HTTP Basic with a fixed "opencode" username (see the sdk's
    // utils/server authTokenFromCredentials). Honk-generated passwords are ASCII.
    headers.Authorization = openCodeAuthorizationHeader(options.password);
  }

  const client: OpencodeClient = createOpencodeClient({
    baseUrl: origin,
    headers,
  });

  // Provider state is cached inside opencode project instances. Auth writes are
  // global, but an already-created instance keeps its old connected/provider
  // projection until disposed; opencode's own clients perform this same global
  // disposal after connect/disconnect so the next request rebuilds every scope.
  async function reloadProviderState(): Promise<void> {
    const res = await client.global.dispose();
    if (res.error !== undefined) {
      throw new Error(
        sidecarErrorMessage(
          res.error,
          "Credentials changed, but the engine failed to reload providers.",
        ),
      );
    }
  }

  // Reducer caches keyed by opencode session id.
  const sessions = new Map<string, Session>();
  // sessionId → its opencode `directory` (project instance scope). Fed from session.create
  // responses AND session.list / detail seeds; per-thread ops carry it so every request lands on
  // the right project instance even before the workspace list has cached the full Session.
  const directories = new Map<string, string>();
  const statusById = new Map<string, SessionStatus["type"]>();
  const failed = new Set<string>();
  const pending = new Map<string, Set<string>>();
  const threadCaches = new Map<string, ThreadCache>();

  const workspaceListeners = new Set<WorkspaceWatchHandlers>();
  const threadListeners = new Map<string, Set<ThreadWatchHandlers>>();

  let workspaceSeq = 0;
  const threadSeq = new Map<string, number>();

  let pumpAbort: AbortController | null = null;
  let pumpRunning = false;
  let closed = false;
  let lastStatus: WatchStatus | null = null;

  // ── status fan-out ───────────────────────────────────────────────────────────────────────
  function broadcastStatus(status: WatchStatus): void {
    lastStatus = status;
    for (const handlers of workspaceListeners) {
      handlers.onStatus?.(status);
    }
    for (const set of threadListeners.values()) {
      for (const handlers of set) {
        handlers.onStatus?.(status);
      }
    }
  }

  // ── workspace projection ─────────────────────────────────────────────────────────────────
  function buildWorkspace(): WorkspaceState {
    const threads: ThreadSummary[] = [];
    const sideChats: SideChatSummary[] = [];
    for (const session of sessions.values()) {
      // Subagent/child sessions are not top-level threads in the workspace list.
      if (session.parentID !== undefined) {
        continue;
      }
      const type = statusById.get(session.id);
      const derived = {
        running: type === "busy" || type === "retry",
        failed: failed.has(session.id),
        needsAttention: (pending.get(session.id)?.size ?? 0) > 0,
      };
      const sideChat = sideChatSummaryFromSession(session, derived);
      if (sideChat === null) {
        threads.push(summaryFromSession(session, derived));
      } else {
        sideChats.push(sideChat);
      }
    }
    return { threads, sideChats, seq: (workspaceSeq += 1) };
  }

  function notifyWorkspace(): void {
    if (workspaceListeners.size === 0) {
      return;
    }
    const state = buildWorkspace();
    for (const handlers of workspaceListeners) {
      handlers.onChange(state);
    }
  }

  // ── thread projection ────────────────────────────────────────────────────────────────────
  function buildThread(sessionId: string): ThreadState | null {
    const session = sessions.get(sessionId);
    const cache = threadCaches.get(sessionId);
    if (session === undefined || cache === undefined) {
      return null;
    }
    const sideChat = sideChatInfoFromSession(session);
    const messages =
      sideChat === null ? cache.messages : cache.messages.slice(sideChat.seedMessageCount);
    const parts: Part[] = [];
    for (const message of messages) {
      const messageParts = cache.partsByMessage.get(message.id);
      if (messageParts !== undefined) {
        parts.push(...messageParts);
      }
    }
    const type = statusById.get(sessionId);
    const summary = summaryFromSession(session, {
      running: type === "busy" || type === "retry",
      failed: failed.has(sessionId),
      needsAttention: (pending.get(sessionId)?.size ?? 0) > 0,
    });
    return {
      summary,
      sideChat,
      cwd: session.directory,
      messages: [...messages],
      parts,
      queue: [],
      seq: (threadSeq.get(sessionId) ?? 0) + 1,
    };
  }

  function notifyThread(sessionId: string): void {
    const set = threadListeners.get(sessionId);
    if (set === undefined || set.size === 0) {
      return;
    }
    const state = buildThread(sessionId);
    if (state === null) {
      return;
    }
    threadSeq.set(sessionId, state.seq);
    for (const handlers of set) {
      handlers.onChange(state);
    }
  }

  // ── directory scope ──────────────────────────────────────────────────────────────────────
  function rememberDirectory(session: Session): void {
    if (session.directory.length > 0) {
      directories.set(session.id, session.directory);
    }
  }

  /** The `directory` a per-thread request should carry, or undefined for the sidecar default. */
  function directoryFor(sessionId: string): string | undefined {
    const explicit = directories.get(sessionId);
    if (explicit !== undefined && explicit.length > 0) {
      return explicit;
    }
    const dir = sessions.get(sessionId)?.directory;
    return dir !== undefined && dir.length > 0 ? dir : undefined;
  }

  async function sideChatReferenceSystem(
    parentThreadId: string,
    sideChatIds: readonly string[] | undefined,
  ): Promise<string | null> {
    if (sideChatIds === undefined || sideChatIds.length === 0) {
      return null;
    }
    const uniqueIds = [...new Set(sideChatIds)];
    const references = await Promise.all(
      uniqueIds.map(async (sideChatId): Promise<string> => {
        const directory = directoryFor(sideChatId) ?? directoryFor(parentThreadId);
        const scope = directory !== undefined ? { directory } : {};
        const [detailResult, messagesResult] = await Promise.all([
          client.session.get({ sessionID: sideChatId, ...scope }),
          client.session.messages({ sessionID: sideChatId, ...scope }),
        ]);
        if (detailResult.error !== undefined || detailResult.data === undefined) {
          throw new Error(
            sidecarErrorMessage(detailResult.error, "Failed to load referenced side chat."),
          );
        }
        if (messagesResult.error !== undefined || messagesResult.data === undefined) {
          throw new Error(
            sidecarErrorMessage(messagesResult.error, "Failed to read referenced side chat."),
          );
        }
        const sideChat = sideChatInfoFromSession(detailResult.data);
        if (sideChat === null || sideChat.parentThreadId !== parentThreadId) {
          throw new Error("The referenced side chat does not belong to this parent thread.");
        }

        const transcript = messagesResult.data
          .slice(sideChat.seedMessageCount)
          .map((group) => {
            const text = group.parts
              .filter(
                (part): part is Extract<Part, { readonly type: "text" }> =>
                  part.type === "text" && part.text.trim().length > 0,
              )
              .map((part) => part.text.trim())
              .join("\n");
            return text.length > 0 ? `${group.info.role}: ${text}` : null;
          })
          .filter((message): message is string => message !== null)
          .join("\n\n");
        const limit = 24_000;
        const visibleTranscript =
          transcript.length <= limit ? transcript : `…\n${transcript.slice(-(limit - 2))}`;
        return `<side_chat_reference>
side_chat_id: ${sideChatId}
title: ${detailResult.data.title}
${visibleTranscript}
</side_chat_reference>`;
      }),
    );
    return references.join("\n\n");
  }

  // ── seeding (list / detail) ──────────────────────────────────────────────────────────────
  async function refreshSessions(strict = false): Promise<void> {
    // No `directory`: the workspace list is deliberately global (every project's sessions).
    const res = await client.session.list();
    if (res.error !== undefined || res.data === undefined) {
      if (strict) {
        throw new Error(sidecarErrorMessage(res.error, "Failed to list OpenCode sessions."));
      }
      return;
    }
    sessions.clear();
    for (const session of res.data) {
      sessions.set(session.id, session);
      rememberDirectory(session);
    }
    notifyWorkspace();
  }

  async function refreshThread(sessionId: string): Promise<void> {
    const directory = directoryFor(sessionId);
    const scope = directory !== undefined ? { directory } : {};
    const [detail, messages] = await Promise.all([
      client.session.get({ sessionID: sessionId, ...scope }),
      client.session.messages({ sessionID: sessionId, ...scope }),
    ]);
    if (detail.data !== undefined) {
      sessions.set(sessionId, detail.data);
      rememberDirectory(detail.data);
    }
    const cache: ThreadCache = { messages: [], partsByMessage: new Map() };
    if (messages.data !== undefined) {
      for (const group of messages.data) {
        cache.messages.push(group.info);
        cache.partsByMessage.set(group.info.id, [...group.parts]);
      }
    }
    threadCaches.set(sessionId, cache);
    notifyThread(sessionId);
    notifyWorkspace();
  }

  // ── event handling ───────────────────────────────────────────────────────────────────────
  function upsertPart(sessionId: string, part: Part): void {
    const cache = threadCaches.get(sessionId);
    if (cache === undefined) {
      return;
    }
    const messageId = part.messageID;
    const list = cache.partsByMessage.get(messageId) ?? [];
    const index = list.findIndex((existing) => existing.id === part.id);
    if (index === -1) {
      list.push(part);
    } else {
      list[index] = part;
    }
    cache.partsByMessage.set(messageId, list);
  }

  function markPending(sessionId: string, requestId: string): void {
    const set = pending.get(sessionId) ?? new Set<string>();
    set.add(requestId);
    pending.set(sessionId, set);
  }

  function clearPending(sessionId: string, requestId: string): void {
    const set = pending.get(sessionId);
    if (set === undefined) {
      return;
    }
    set.delete(requestId);
    if (set.size === 0) {
      pending.delete(sessionId);
    }
  }

  function handleEvent(event: Event): void {
    switch (event.type) {
      case "session.created":
      case "session.updated": {
        const info = event.properties.info;
        sessions.set(info.id, info);
        rememberDirectory(info);
        failed.delete(info.id);
        notifyWorkspace();
        notifyThread(info.id);
        return;
      }
      case "session.deleted": {
        const id = event.properties.sessionID;
        sessions.delete(id);
        directories.delete(id);
        statusById.delete(id);
        failed.delete(id);
        pending.delete(id);
        threadCaches.delete(id);
        notifyWorkspace();
        return;
      }
      case "session.status": {
        const id = event.properties.sessionID;
        statusById.set(id, event.properties.status.type);
        if (event.properties.status.type !== "retry") {
          failed.delete(id);
        }
        notifyWorkspace();
        notifyThread(id);
        return;
      }
      case "session.idle": {
        const id = event.properties.sessionID;
        statusById.set(id, "idle");
        failed.delete(id);
        notifyWorkspace();
        notifyThread(id);
        return;
      }
      case "session.error": {
        const id = event.properties.sessionID;
        if (id !== undefined) {
          failed.add(id);
          statusById.set(id, "idle");
          notifyWorkspace();
          notifyThread(id);
        }
        return;
      }
      case "message.updated": {
        const info = event.properties.info;
        const cache = threadCaches.get(info.sessionID);
        if (cache !== undefined) {
          const index = cache.messages.findIndex((existing) => existing.id === info.id);
          if (index === -1) {
            cache.messages.push(info);
          } else {
            cache.messages[index] = info;
          }
          notifyThread(info.sessionID);
        }
        return;
      }
      case "message.removed": {
        const cache = threadCaches.get(event.properties.sessionID);
        if (cache !== undefined) {
          const messageId = event.properties.messageID;
          const index = cache.messages.findIndex((existing) => existing.id === messageId);
          if (index !== -1) {
            cache.messages.splice(index, 1);
          }
          cache.partsByMessage.delete(messageId);
          notifyThread(event.properties.sessionID);
        }
        return;
      }
      case "message.part.updated": {
        const part = event.properties.part;
        upsertPart(event.properties.sessionID, part);
        notifyThread(event.properties.sessionID);
        return;
      }
      case "message.part.removed": {
        const cache = threadCaches.get(event.properties.sessionID);
        if (cache !== undefined) {
          const list = cache.partsByMessage.get(event.properties.messageID);
          if (list !== undefined) {
            const index = list.findIndex((existing) => existing.id === event.properties.partID);
            if (index !== -1) {
              list.splice(index, 1);
            }
          }
          notifyThread(event.properties.sessionID);
        }
        return;
      }
      case "permission.asked":
      case "question.asked": {
        markPending(event.properties.sessionID, event.properties.id);
        notifyWorkspace();
        notifyThread(event.properties.sessionID);
        return;
      }
      case "permission.replied":
      case "question.replied":
      case "question.rejected": {
        clearPending(event.properties.sessionID, event.properties.requestID);
        notifyWorkspace();
        notifyThread(event.properties.sessionID);
        return;
      }
      default:
        return;
    }
  }

  // ── pump lifecycle ───────────────────────────────────────────────────────────────────────
  async function runPump(): Promise<void> {
    while (!closed) {
      const attempt = new AbortController();
      pumpAbort = attempt;
      try {
        const stream =
          options?.eventStreamFactory === undefined
            ? (await client.global.event({ signal: attempt.signal })).stream
            : await options.eventStreamFactory({
                origin,
                headers: { ...headers },
                signal: attempt.signal,
              });
        broadcastStatus("live");
        // Reseed after every (re)connect so we cannot miss changes made while
        // the stream was down.
        await refreshSessions();
        for (const sessionId of threadListeners.keys()) {
          await refreshThread(sessionId);
        }
        for await (const envelope of stream) {
          if (attempt.signal.aborted || closed) {
            break;
          }
          if (
            typeof envelope.payload === "object" &&
            envelope.payload !== null &&
            Reflect.get(envelope.payload, "type") === "sync"
          ) {
            continue;
          }
          handleEvent(envelope.payload as Event);
        }
      } catch (error) {
        if (isUnauthorized(error)) {
          broadcastStatus("unauthorized");
          pumpRunning = false;
          pumpAbort = null;
          return;
        }
        // Fall through to reconnect.
      } finally {
        pumpAbort = null;
      }

      if (closed || !hasWatchers()) {
        break;
      }
      broadcastStatus("reconnecting");
      await wait(RECONNECT_DELAY_MS);
    }
    pumpRunning = false;
  }

  function hasWatchers(): boolean {
    if (workspaceListeners.size > 0) {
      return true;
    }
    for (const set of threadListeners.values()) {
      if (set.size > 0) {
        return true;
      }
    }
    return false;
  }

  function ensurePump(): void {
    if (pumpRunning || closed) {
      return;
    }
    pumpRunning = true;
    void runPump();
  }

  function maybeStopPump(): void {
    if (hasWatchers()) {
      return;
    }
    pumpAbort?.abort();
    pumpAbort = null;
    if (lastStatus !== null) {
      lastStatus = null;
    }
  }

  // ── public surface ───────────────────────────────────────────────────────────────────────
  return {
    threads: {
      async create(payload) {
        // exactOptionalPropertyTypes: only carry keys that are actually set so
        // we never hand the sdk an explicit `undefined`.
        const preset: ThreadPreset = {
          ...(payload.agent !== undefined ? { agent: payload.agent } : {}),
          ...(payload.model !== undefined ? { model: payload.model } : {}),
          ...(payload.variant !== undefined ? { variant: payload.variant } : {}),
        };
        const res = await client.session.create({
          ...(payload.cwd !== undefined ? { directory: payload.cwd } : {}),
          ...(payload.title !== undefined ? { title: payload.title } : {}),
          ...(payload.agent !== undefined ? { agent: payload.agent } : {}),
          // v2 session.create's model key is {id, providerID} — only promptAsync wants
          // the {providerID, modelID} spelling (mapped in send below).
          ...(payload.model !== undefined ? { model: payload.model } : {}),
          ...(hasPreset(preset) ? { metadata: { [PRESET_METADATA_KEY]: preset } } : {}),
        });
        if (res.error !== undefined || res.data === undefined) {
          throw new Error(sidecarErrorMessage(res.error, "Failed to create session."));
        }
        const session = res.data;
        sessions.set(session.id, session);
        rememberDirectory(session);
        notifyWorkspace();
        return summaryFromSession(session, {
          running: false,
          failed: false,
          needsAttention: false,
        });
      },

      async createSideChat(parentThreadId) {
        let parent = sessions.get(parentThreadId);
        if (parent === undefined) {
          const parentDirectory = directoryFor(parentThreadId);
          const parentResult = await client.session.get({
            sessionID: parentThreadId,
            ...(parentDirectory !== undefined ? { directory: parentDirectory } : {}),
          });
          if (parentResult.error !== undefined || parentResult.data === undefined) {
            throw new Error(sidecarErrorMessage(parentResult.error, "Failed to load session."));
          }
          parent = parentResult.data;
          sessions.set(parent.id, parent);
          rememberDirectory(parent);
        }
        if (sideChatInfoFromSession(parent) !== null) {
          throw new Error(
            "Cannot create a side chat inside a side chat. Return to the main thread first.",
          );
        }

        const directory = parent.directory.length > 0 ? parent.directory : undefined;
        const forkResult = await client.session.fork({
          sessionID: parentThreadId,
          ...(directory !== undefined ? { directory } : {}),
        });
        if (forkResult.error !== undefined || forkResult.data === undefined) {
          throw new Error(sidecarErrorMessage(forkResult.error, "Failed to create side chat."));
        }

        const forked = forkResult.data;
        const messagesResult = await client.session.messages({
          sessionID: forked.id,
          ...(directory !== undefined ? { directory } : {}),
        });
        if (messagesResult.error !== undefined || messagesResult.data === undefined) {
          throw new Error(
            sidecarErrorMessage(messagesResult.error, "Failed to seed side chat context."),
          );
        }

        const sideChat: SideChatInfo = {
          parentThreadId,
          seedMessageCount: messagesResult.data.length,
        };
        const parentPreset = presetFromSession(parent);
        const updateResult = await client.session.update({
          sessionID: forked.id,
          title: "Side Chat",
          metadata: {
            ...forked.metadata,
            [SIDE_CHAT_METADATA_KEY]: sideChat,
            ...(parentPreset !== undefined ? { [PRESET_METADATA_KEY]: parentPreset } : {}),
          },
          ...(directory !== undefined ? { directory } : {}),
        });
        if (updateResult.error !== undefined || updateResult.data === undefined) {
          throw new Error(
            sidecarErrorMessage(updateResult.error, "Failed to finish creating side chat."),
          );
        }

        const session = updateResult.data;
        sessions.set(session.id, session);
        rememberDirectory(session);
        notifyWorkspace();
        return {
          ...summaryFromSession(session, {
            running: false,
            failed: false,
            needsAttention: false,
          }),
          ...sideChat,
        };
      },

      async get(threadId) {
        const directory = directoryFor(threadId);
        const res = await client.session.get({
          sessionID: threadId,
          ...(directory !== undefined ? { directory } : {}),
        });
        if (res.error !== undefined || res.data === undefined) {
          throw new Error(sidecarErrorMessage(res.error, "Failed to load session."));
        }
        const session = res.data;
        sessions.set(session.id, session);
        rememberDirectory(session);
        return {
          summary: summaryFromSession(session, {
            running: statusById.get(session.id) === "busy",
            failed: failed.has(session.id),
            needsAttention: (pending.get(session.id)?.size ?? 0) > 0,
          }),
          cwd: session.directory,
        };
      },

      async send(threadId, payload) {
        // Resend the pinned preset on every prompt (opencode expects agent/model
        // per prompt; the pin is our hard preset memory). messageID is deliberately
        // omitted — opencode requires its own `msg…` identifier format (live serve
        // rejects foreign ids with a schema error), so the server mints it.
        const session = sessions.get(threadId);
        const pin = session === undefined ? undefined : presetFromSession(session);
        const variant = pin?.variant ?? pin?.model?.variant;
        const agent = payload.agent ?? pin?.agent;
        const directory = directoryFor(threadId);
        const referenceSystem = await sideChatReferenceSystem(threadId, payload.sideChatIds);
        const sideChatSystem =
          session !== undefined && sideChatInfoFromSession(session) !== null
            ? SIDE_CHAT_GUARDRAIL
            : null;
        const system = [sideChatSystem, referenceSystem]
          .filter((entry): entry is string => entry !== null)
          .join("\n\n");
        void payload.messageId;
        const res = await client.session.promptAsync({
          sessionID: threadId,
          ...(directory !== undefined ? { directory } : {}),
          ...(agent !== undefined ? { agent } : {}),
          ...(pin?.model !== undefined
            ? { model: { providerID: pin.model.providerID, modelID: pin.model.id } }
            : {}),
          ...(variant !== undefined ? { variant } : {}),
          ...(system.length > 0 ? { system } : {}),
          // Attachment-only prompts are legal — never send an empty text part around a photo.
          parts: [
            ...(payload.text.length > 0 ? [{ type: "text" as const, text: payload.text }] : []),
            ...filePartsFrom(payload.files, directory),
          ],
        });
        if (res.error !== undefined) {
          throw new Error(sidecarErrorMessage(res.error, "Failed to send message."));
        }
      },

      async interrupt(threadId) {
        const directory = directoryFor(threadId);
        const res = await client.session.abort({
          sessionID: threadId,
          ...(directory !== undefined ? { directory } : {}),
        });
        if (res.error !== undefined) {
          throw new Error(sidecarErrorMessage(res.error, "Failed to interrupt session."));
        }
      },

      async setTitle(threadId, title) {
        const directory = directoryFor(threadId);
        const res = await client.session.update({
          sessionID: threadId,
          title,
          ...(directory !== undefined ? { directory } : {}),
        });
        if (res.error !== undefined) {
          throw new Error(sidecarErrorMessage(res.error, "Failed to rename session."));
        }
        // Reflect immediately; the event pump confirms with session.updated.
        const session = sessions.get(threadId);
        if (session !== undefined) {
          sessions.set(threadId, { ...session, title });
          notifyThread(threadId);
          notifyWorkspace();
        }
      },

      async runCommand(threadId, input) {
        const directory = input.directory ?? directoryFor(threadId);
        const res = await client.session.command({
          sessionID: threadId,
          command: input.command,
          arguments: input.arguments,
          ...(directory !== undefined ? { directory } : {}),
          ...(input.agent !== undefined ? { agent: input.agent } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
        });
        if (res.error !== undefined) {
          throw new Error(sidecarErrorMessage(res.error, "Failed to run command."));
        }
      },

      watch(threadId, handlers) {
        const set = threadListeners.get(threadId) ?? new Set<ThreadWatchHandlers>();
        set.add(handlers);
        threadListeners.set(threadId, set);
        ensurePump();
        if (lastStatus !== null) {
          handlers.onStatus?.(lastStatus);
        }
        // Seed immediately from cache, then (re)fetch detail for freshness.
        const cached = buildThread(threadId);
        if (cached !== null) {
          handlers.onChange(cached);
        }
        void refreshThread(threadId).catch(() => {
          // A failed seed leaves the watcher on its last status; the pump retries.
        });
        return {
          close: () => {
            const current = threadListeners.get(threadId);
            current?.delete(handlers);
            if (current !== undefined && current.size === 0) {
              threadListeners.delete(threadId);
              threadCaches.delete(threadId);
              threadSeq.delete(threadId);
            }
            maybeStopPump();
          },
        };
      },
    },

    workspace: {
      async snapshot() {
        await refreshSessions(true);
        return buildWorkspace();
      },

      watch(handlers) {
        workspaceListeners.add(handlers);
        ensurePump();
        if (lastStatus !== null) {
          handlers.onStatus?.(lastStatus);
        }
        if (sessions.size > 0) {
          handlers.onChange(buildWorkspace());
        }
        return {
          close: () => {
            workspaceListeners.delete(handlers);
            maybeStopPump();
          },
        };
      },
    },

    async listProjects() {
      const res = await client.project.list();
      if (res.error !== undefined || res.data === undefined) {
        throw new Error(sidecarErrorMessage(res.error, "Failed to list projects."));
      }
      return res.data.map((project) => ({
        id: project.id,
        worktree: project.worktree,
        name: project.name !== undefined && project.name.length > 0 ? project.name : null,
        vcs: project.vcs ?? null,
      }));
    },

    async defaultDirectory() {
      const res = await client.path.get();
      if (res.error !== undefined || res.data === undefined) {
        throw new Error(sidecarErrorMessage(res.error, "Failed to resolve the default directory."));
      }
      return res.data.directory;
    },

    async listProviders() {
      const [list, auth] = await Promise.all([client.provider.list(), client.provider.auth()]);
      if (list.error !== undefined || list.data === undefined) {
        throw new Error(sidecarErrorMessage(list.error, "Failed to list providers."));
      }
      if (auth.error !== undefined || auth.data === undefined) {
        throw new Error(
          sidecarErrorMessage(auth.error, "Failed to list provider authentication methods."),
        );
      }
      const authByProvider = auth.data;
      const connected = list.data.connected;
      const providers: SidecarProvider[] = list.data.all.map((provider) => ({
        id: provider.id,
        name: provider.name,
        source: provider.source,
        connected: connected.includes(provider.id),
        authMethods: (authByProvider[provider.id] ?? []).map((method, index) => ({
          index,
          type: method.type,
          label: method.label,
          prompts: (method.prompts ?? []).map(
            (prompt): SidecarProviderAuthPrompt =>
              prompt.type === "select"
                ? {
                    type: "select",
                    key: prompt.key,
                    message: prompt.message,
                    options: prompt.options.map((option) => ({ ...option })),
                    ...(prompt.when !== undefined ? { when: { ...prompt.when } } : {}),
                  }
                : {
                    type: "text",
                    key: prompt.key,
                    message: prompt.message,
                    ...(prompt.placeholder !== undefined
                      ? { placeholder: prompt.placeholder }
                      : {}),
                    ...(prompt.when !== undefined ? { when: { ...prompt.when } } : {}),
                  },
          ),
        })),
      }));
      return { providers, connected: [...connected], defaults: { ...list.data.default } };
    },

    async setProviderApiKey(providerID, key) {
      const res = await client.auth.set({ providerID, auth: { type: "api", key } });
      if (res.error !== undefined) {
        throw new Error(sidecarErrorMessage(res.error, "Failed to save the API key."));
      }
      await reloadProviderState();
    },

    async authorizeProviderOauth(providerID, method, inputs) {
      const res = await client.provider.oauth.authorize({
        providerID,
        method,
        ...(inputs !== undefined ? { inputs: { ...inputs } } : {}),
      });
      if (res.error !== undefined || res.data === undefined) {
        throw new Error(sidecarErrorMessage(res.error, "Failed to start the OAuth flow."));
      }
      return { url: res.data.url, method: res.data.method, instructions: res.data.instructions };
    },

    async completeProviderOauth(providerID, method, code) {
      const res = await client.provider.oauth.callback({
        providerID,
        method,
        ...(code !== undefined ? { code } : {}),
      });
      if (res.error !== undefined) {
        throw new Error(sidecarErrorMessage(res.error, "Failed to complete the OAuth flow."));
      }
      await reloadProviderState();
    },

    async removeProviderAuth(providerID) {
      const res = await client.auth.remove({ providerID });
      if (res.error !== undefined) {
        throw new Error(sidecarErrorMessage(res.error, "Failed to remove the credentials."));
      }
      await reloadProviderState();
    },

    async findFiles(query, directory) {
      const res = await client.find.files({
        query,
        ...(directory !== undefined ? { directory } : {}),
      });
      if (res.error !== undefined || res.data === undefined) {
        throw new Error(sidecarErrorMessage(res.error, "Failed to search files."));
      }
      return res.data;
    },

    async fileStatus(directory) {
      const res = await client.file.status({ directory });
      if (res.error !== undefined || res.data === undefined) {
        throw new Error(sidecarErrorMessage(res.error, "Failed to read the change list."));
      }
      return res.data.map((file) => ({
        path: file.path,
        added: file.added,
        removed: file.removed,
        status: file.status,
      }));
    },

    async listFiles(path, directory) {
      const res = await client.file.list({ path, directory });
      if (res.error !== undefined || res.data === undefined) {
        throw new Error(sidecarErrorMessage(res.error, "Failed to list files."));
      }
      return res.data.map((node) => ({
        name: node.name,
        path: node.path,
        type: node.type,
        ignored: node.ignored,
      }));
    },

    async readFile(path, directory) {
      const res = await client.file.read({ path, directory });
      if (res.error !== undefined || res.data === undefined) {
        throw new Error(sidecarErrorMessage(res.error, "Failed to read the file."));
      }
      return {
        type: res.data.type,
        content: res.data.content,
        hunks: res.data.patch?.hunks ?? null,
        mimeType: res.data.mimeType ?? null,
      };
    },

    async vcsBranch(directory) {
      const res = await client.vcs.get({ directory });
      if (res.error !== undefined || res.data === undefined) {
        return null; // outside a repo (or an old server) — the panel just omits the label
      }
      return res.data.branch ?? null;
    },

    async listCommands(directory) {
      const res = await client.command.list(directory !== undefined ? { directory } : {});
      if (res.error !== undefined || res.data === undefined) {
        throw new Error(sidecarErrorMessage(res.error, "Failed to list commands."));
      }
      return res.data.map((command) => ({
        name: command.name,
        description:
          command.description !== undefined && command.description.length > 0
            ? command.description
            : null,
        agent: command.agent !== undefined && command.agent.length > 0 ? command.agent : null,
        model: command.model !== undefined && command.model.length > 0 ? command.model : null,
        template: command.template,
        subtask: command.subtask ?? false,
      }));
    },

    async close() {
      closed = true;
      pumpAbort?.abort();
      pumpAbort = null;
      workspaceListeners.clear();
      threadListeners.clear();
    },
  };
}

/**
 * Build opencode FilePartInput parts from composer attachments. Two url forms:
 *   • mentions — `file://<ABSOLUTE path>`: the server resolves file parts through
 *     fileURLToPath (SessionPrompt.resolveUserPart), which rejects relative urls (the first
 *     segment parses as a host), so a relative mention is resolved against the session
 *     directory first — exactly the reference app's absolute(sessionDirectory, path).
 *   • pasted/dropped bytes — a `data:` url carrying the file inline; its mime is authoritative
 *     (parsed from the url when the caller didn't set one), NEVER the text/plain default —
 *     the server uses mime verbatim, and a photo labelled text/plain routes down the text
 *     Read path and never arrives as an image.
 */
function filePartsFrom(
  files: readonly SendMessageFile[] | undefined,
  directory: string | undefined,
): Array<{
  readonly type: "file";
  readonly mime: string;
  readonly filename: string;
  readonly url: string;
}> {
  if (files === undefined || files.length === 0) {
    return [];
  }
  return files.map((file) => {
    const url =
      file.path.startsWith("file://") || file.path.startsWith("data:")
        ? file.path
        : fileUrlFrom(absolutePath(file.path, directory));
    return {
      type: "file" as const,
      mime: file.mime ?? dataUrlMime(file.path) ?? "text/plain",
      filename: file.filename ?? fileBasename(file.path),
      url,
    };
  });
}

/** Resolve a composer mention against the session directory (the server needs absolute paths). */
function absolutePath(path: string, directory: string | undefined): string {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
    return path;
  }
  const base =
    directory !== undefined && directory.length > 0 ? directory.replace(/[\\/]+$/, "") : "";
  if (base.length === 0) {
    // A relative mention with no directory scope can only produce a broken file:// url
    // (fileURLToPath reads the first segment as a host) — fail loudly at the send site.
    throw new Error(`Cannot attach "${path}": no session directory to resolve it against.`);
  }
  return `${base}/${path}`;
}

/** Serialize an absolute path as a file:// url, percent-encoding each segment ("#?%" in names). */
function fileUrlFrom(absolute: string): string {
  const encoded = absolute
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `file://${encoded}`;
}

/** The mime a data: url declares (`data:image/png;base64,…`), or undefined for other urls. */
function dataUrlMime(path: string): string | undefined {
  if (!path.startsWith("data:")) {
    return undefined;
  }
  const match = /^data:([^;,]+)/.exec(path);
  return match?.[1] !== undefined && match[1].length > 0 ? match[1] : undefined;
}

function fileBasename(path: string): string {
  if (path.startsWith("data:")) {
    return "attachment";
  }
  const trimmed = path.replace(/^file:\/\//, "").replace(/[\\/]+$/, "");
  const [last = trimmed] = trimmed.split(/[\\/]/).slice(-1);
  return last.length > 0 ? last : path;
}

function sidecarErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message") ?? Reflect.get(error, "data");
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallback;
}
