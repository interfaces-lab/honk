import {
  openCodeSessionKey,
  openCodeSessionRef,
  type OpenCodeClient,
  type OpenCodeEvent,
  type OpenCodeServerDescriptor,
  type OpenCodeServerKey,
  type OpenCodeSessionInfo,
  type OpenCodeSessionRef,
} from "@honk/opencode";

import {
  appSessionStatusFromActivity,
  appSessionSummary,
  projectSessionSummaries,
  type AppChildSessionSummary,
  type AppSessionSummary,
} from "./open-code-view";
import {
  createSessionWatchController,
  INITIAL_SESSION_SNAPSHOT,
  type AdapterWatchStatus,
  type SessionActivity,
  type SessionEntry,
  type SessionWatchSnapshot,
} from "./session-watch";
import { loadAttentionRequests, loadSessionActivity } from "./workspace-reconciliation";
import { createWatchNotificationBatcher } from "./watch-notifications";

export type {
  AdapterWatchStatus,
  SessionActivity,
  SessionWatchSnapshot,
  SessionWatchState,
  WatchStatus,
} from "./session-watch";

export type WorkspaceWatchState = {
  readonly sessions: readonly AppSessionSummary[];
  readonly rootSessions: readonly AppSessionSummary[];
  readonly childSessions: readonly AppChildSessionSummary[];
  readonly recentDirectories: readonly string[];
};

export type WorkspaceWatchSnapshot = {
  readonly state: WorkspaceWatchState | null;
  readonly status: AdapterWatchStatus;
};

export type OpenCodeServerWatchState = {
  readonly server: OpenCodeServerDescriptor;
  readonly status: AdapterWatchStatus;
  readonly selected: boolean;
};

export type OpenCodeServerWatchSnapshot = {
  readonly servers: readonly OpenCodeServerWatchState[];
};

const WORKSPACE_LIST_LIMIT = 5_000;
const RECENT_DIRECTORY_LIMIT = 8;
const WORKSPACE_REFETCH_DEBOUNCE_MS = 200;
const PUMP_FLUSH_FRAME_MS = 16;
const PUMP_YIELD_MS = 8;
const PUMP_RECONNECT_BASE_MS = 250;
const PUMP_RECONNECT_CEILING_MS = 10_000;
const PUMP_HEARTBEAT_TIMEOUT_MS = 15_000;
const STRICT_MODE_GRACE_MS = 0;

const INITIAL_WORKSPACE_SNAPSHOT: WorkspaceWatchSnapshot = Object.freeze({
  state: null,
  status: "connecting",
});

const INITIAL_SERVER_SNAPSHOT: OpenCodeServerWatchSnapshot = Object.freeze({
  servers: Object.freeze([]),
});

type ServerContext = {
  readonly client: OpenCodeClient;
  readonly server: OpenCodeServerKey;
  status: AdapterWatchStatus;
  eventStatus: AdapterWatchStatus;
  loaded: boolean;
  workspaceFetchSeq: number;
  workspaceFetchPromise: Promise<void> | null;
  workspaceRefetchAfterFetch: boolean;
  workspaceRefetchTimer: ReturnType<typeof setTimeout> | null;
  workspaceFetchEventSequence: number | null;
  workspaceEventSequence: number;
  workspaceEvents: Array<{
    readonly sequence: number;
    readonly mutation: SessionInventoryMutation;
  }>;
  readonly workspaceSessionEventSequence: Map<string, number>;
  sessionInfos: Map<string, OpenCodeSessionInfo>;
  projectDirectories: Map<string, string>;
  readonly activityBySession: Map<string, SessionActivity>;
  readonly attentionBySession: Map<string, Set<string>>;
  signalSeq: number;
  readonly signalSeqBySession: Map<string, number>;
  pumpGeneration: number;
  pumpController: AbortController | null;
};

type SessionInventoryEvent = Extract<
  OpenCodeEvent,
  { readonly type: "session.created" | "session.updated" | "session.deleted" }
>;

type SessionInventoryMutation =
  | {
      readonly type: "upsert";
      readonly sessionID: string;
      readonly info: OpenCodeSessionInfo;
    }
  | {
      readonly type: "delete";
      readonly sessionID: string;
    };

export type SessionActivitySignal = {
  readonly sessionID: string;
  readonly activity: SessionActivity;
};

const contexts = new Map<OpenCodeServerKey, ServerContext>();
const sessionEntries = new Map<string, SessionEntry>();
const workspaceListeners = new Set<() => void>();
const serverListeners = new Set<() => void>();
const catalogListeners = new Set<() => void>();
let workspaceRefCount = 0;
let workspaceSnapshot = INITIAL_WORKSPACE_SNAPSHOT;
let serverSnapshot = INITIAL_SERVER_SNAPSHOT;
let catalogRevision = 0;
let primaryServer: OpenCodeServerKey | null = null;
let boundServer: OpenCodeServerKey | null = null;
const notifications = createWatchNotificationBatcher(PUMP_FLUSH_FRAME_MS);

function sessionEntryKey(ref: OpenCodeSessionRef): string {
  return openCodeSessionKey(ref);
}

function eventSessionID(event: OpenCodeEvent): string | null {
  const data = (event as { readonly data?: { readonly sessionID?: unknown } }).data;
  return typeof data?.sessionID === "string" ? data.sessionID : null;
}

function eventRequestID(event: OpenCodeEvent): string | null {
  const data = (
    event as { readonly data?: { readonly id?: unknown; readonly requestID?: unknown } }
  ).data;
  const id = data?.requestID ?? data?.id;
  return typeof id === "string" ? id : null;
}

export function sessionActivitySignal(event: OpenCodeEvent): SessionActivitySignal | null {
  if (event.type === "session.status") {
    const status = event.data.status.type;
    return Object.freeze({
      sessionID: event.data.sessionID,
      activity: status === "busy" ? "busy" : status === "retry" ? "retry" : "idle",
    });
  }
  if (event.type !== "session.idle") return null;
  const sessionID = eventSessionID(event);
  return sessionID === null ? null : Object.freeze({ sessionID, activity: "idle" });
}

function isUnauthorized(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = Reflect.get(error, "status") ?? Reflect.get(error, "statusCode");
  return status === 401 || status === 403;
}

function activityOf(context: ServerContext, sessionID: string): SessionActivity {
  return context.activityBySession.get(sessionID) ?? "idle";
}

function attentionOf(context: ServerContext, sessionID: string): boolean {
  return (context.attentionBySession.get(sessionID)?.size ?? 0) > 0;
}

function markAttention(context: ServerContext, sessionID: string, requestID: string): void {
  const requests = context.attentionBySession.get(sessionID) ?? new Set<string>();
  requests.add(requestID);
  context.attentionBySession.set(sessionID, requests);
}

function replaceAttention(
  context: ServerContext,
  sessionID: string,
  requestIDs: readonly string[],
): void {
  if (requestIDs.length === 0) {
    context.attentionBySession.delete(sessionID);
    return;
  }
  context.attentionBySession.set(sessionID, new Set(requestIDs));
}

function clearAttention(context: ServerContext, sessionID: string, requestID: string | null): void {
  const requests = context.attentionBySession.get(sessionID);
  if (requests === undefined) return;
  if (requestID === null) {
    context.attentionBySession.delete(sessionID);
    return;
  }
  requests.delete(requestID);
  if (requests.size === 0) context.attentionBySession.delete(sessionID);
}

// Activity is asserted far more often than it changes: every provider step re-declares the session
// busy. Republishing there would hand every subscriber a freshly projected inventory, and each one
// re-renders an open thread and its transcript, so only a real transition publishes.
function setActivity(context: ServerContext, sessionID: string, activity: SessionActivity): void {
  if (activityOf(context, sessionID) === activity) return;
  context.activityBySession.set(sessionID, activity);
  publishDerived(context);
}

function noteSignal(context: ServerContext, sessionID: string): void {
  context.signalSeq += 1;
  context.signalSeqBySession.set(sessionID, context.signalSeq);
}

const sessionWatch = createSessionWatchController<ServerContext>({
  getContext: (server) => contexts.get(server),
  getEntry: (ref) => sessionEntries.get(sessionEntryKey(ref)),
  getEntryBySession: (context, sessionID) =>
    sessionEntries.get(sessionEntryKey(openCodeSessionRef(context.server, sessionID))),
  activityOf,
  attentionOf,
  replaceAttention,
  noteActivity: (context, sessionID, activity) => {
    noteSignal(context, sessionID);
    setActivity(context, sessionID, activity);
  },
  notify: notifications.notify,
  publishDerived,
});

function applySessionInventoryMutation(
  context: ServerContext,
  mutation: SessionInventoryMutation,
): void {
  if (mutation.type === "delete") {
    context.sessionInfos.delete(mutation.sessionID);
    context.activityBySession.delete(mutation.sessionID);
    context.attentionBySession.delete(mutation.sessionID);
    context.signalSeqBySession.delete(mutation.sessionID);
    const entry = sessionEntries.get(
      sessionEntryKey(openCodeSessionRef(context.server, mutation.sessionID)),
    );
    if (entry !== undefined) sessionWatch.close(entry);
    return;
  }
  context.sessionInfos.set(mutation.info.id, mutation.info);
}

function recordSessionInventoryMutation(
  context: ServerContext,
  sequence: number,
  mutation: SessionInventoryMutation,
): void {
  if (context.workspaceFetchEventSequence !== null) {
    context.workspaceEvents.push({ sequence, mutation });
  }
  applySessionInventoryMutation(context, mutation);
  publishDerived(context);
}

function handleSessionInventoryEvent(context: ServerContext, event: SessionInventoryEvent): void {
  const sequence = ++context.workspaceEventSequence;
  const sessionID = event.data.sessionID;
  context.workspaceSessionEventSequence.set(sessionID, sequence);
  if (event.type === "session.deleted") {
    recordSessionInventoryMutation(context, sequence, { type: "delete", sessionID });
    return;
  }
  void context.client.sessions.get(openCodeSessionRef(context.server, sessionID)).then(
    (info) => {
      if (
        contexts.get(context.server) !== context ||
        context.workspaceSessionEventSequence.get(sessionID) !== sequence
      ) {
        return;
      }
      if (info.id !== sessionID) {
        scheduleWorkspaceRefetch(context);
        return;
      }
      notifications.batch(() => {
        recordSessionInventoryMutation(context, ++context.workspaceEventSequence, {
          type: "upsert",
          sessionID,
          info,
        });
      });
      // `session.updated` only refreshes the tab inventory; push the fresh metadata
      // (e.g. a rename) into the open transcript so its header title updates too.
      sessionWatch.applySessionInfo(context, info);
    },
    () => {
      if (
        contexts.get(context.server) === context &&
        context.workspaceSessionEventSequence.get(sessionID) === sequence
      ) {
        scheduleWorkspaceRefetch(context);
      }
    },
  );
}

function contextStatus(): AdapterWatchStatus {
  if (contexts.size === 0) return "connecting";
  const statuses = [...contexts.values()].map((context) => context.status);
  if (statuses.includes("unauthorized")) return "unauthorized";
  if (statuses.includes("reconnecting") || statuses.includes("closed")) return "reconnecting";
  if (statuses.every((status) => status === "live")) return "live";
  return "connecting";
}

function orderedContexts(): readonly ServerContext[] {
  const primary = primaryServer === null ? undefined : contexts.get(primaryServer);
  return [
    ...(primary === undefined ? [] : [primary]),
    ...[...contexts.values()].filter((context) => context !== primary),
  ];
}

function contextSessionSummaries(context: ServerContext): readonly AppSessionSummary[] {
  return [...context.sessionInfos.values()].map((info) =>
    appSessionSummary(
      info,
      context.server,
      appSessionStatusFromActivity(activityOf(context, info.id)),
      attentionOf(context, info.id),
      context.projectDirectories.get(info.projectID) ?? info.location.directory,
    ),
  );
}

function buildWorkspaceState(): WorkspaceWatchState {
  const projection = projectSessionSummaries(
    [...contexts.values()].flatMap((context) => contextSessionSummaries(context)),
  );
  const recentDirectories: string[] = [];
  const recentDirectorySet = new Set<string>();
  for (const context of orderedContexts()) {
    const infos = [...context.sessionInfos.values()].sort(
      (left, right) => right.time.updated - left.time.updated,
    );
    for (const info of infos) {
      const directory = context.projectDirectories.get(info.projectID) ?? info.location.directory;
      if (directory.length > 0 && !recentDirectorySet.has(directory)) {
        recentDirectorySet.add(directory);
        recentDirectories.push(directory);
        if (recentDirectories.length >= RECENT_DIRECTORY_LIMIT) break;
      }
    }
    if (recentDirectories.length >= RECENT_DIRECTORY_LIMIT) break;
  }
  return Object.freeze({
    sessions: projection.sessions,
    rootSessions: projection.rootSessions,
    childSessions: projection.childSessions,
    recentDirectories: Object.freeze(recentDirectories),
  });
}

function publishWorkspace(): void {
  const hasLoadedContext = [...contexts.values()].some((context) => context.loaded);
  workspaceSnapshot = Object.freeze({
    state: hasLoadedContext ? buildWorkspaceState() : null,
    status: contextStatus(),
  });
  notifications.notify(workspaceListeners);
}

function publishServers(): void {
  serverSnapshot = Object.freeze({
    servers: Object.freeze(
      [...contexts.values()].map((context) =>
        Object.freeze({
          server: context.client.server,
          status: context.status,
          selected: context.server === primaryServer,
        }),
      ),
    ),
  });
  notifications.notify(serverListeners);
}

function publishCatalog(): void {
  catalogRevision += 1;
  notifications.notify(catalogListeners);
}

function entriesForServer(server: OpenCodeServerKey): readonly SessionEntry[] {
  return [...sessionEntries.values()].filter((entry) => entry.ref.server === server);
}

function publishDerived(context: ServerContext): void {
  if (context.loaded) publishWorkspace();
  const summaries = new Map(
    projectSessionSummaries(contextSessionSummaries(context)).sessions.map((summary) => [
      summary.id,
      summary,
    ]),
  );
  for (const entry of entriesForServer(context.server)) {
    const state = entry.snapshot.state;
    if (state === null) continue;
    const ownActivity = activityOf(context, entry.ref.sessionID);
    const projected = summaries.get(entry.ref.sessionID);
    const status = projected?.status ?? appSessionStatusFromActivity(ownActivity);
    const needsAttention = projected?.needsAttention ?? attentionOf(context, entry.ref.sessionID);
    const updatedAt =
      projected !== undefined && projected.updatedAt > state.app.summary.updatedAt
        ? projected.updatedAt
        : state.app.summary.updatedAt;
    if (
      state.activity === ownActivity &&
      state.needsAttention === needsAttention &&
      state.app.summary.status === status &&
      state.app.summary.needsAttention === needsAttention &&
      state.app.summary.updatedAt === updatedAt
    ) {
      continue;
    }
    sessionWatch.publish(entry, {
      state: Object.freeze({
        ...state,
        app: Object.freeze({
          ...state.app,
          summary: Object.freeze({
            ...state.app.summary,
            ...projected,
            status,
            needsAttention,
            updatedAt,
          }),
        }),
        activity: ownActivity,
        needsAttention,
      }),
      status: entry.snapshot.status,
    });
  }
}

function setContextStatus(context: ServerContext, status: AdapterWatchStatus): void {
  if (context.status === status) return;
  context.status = status;
  publishWorkspace();
  publishServers();
}

function setEventStatus(
  context: ServerContext,
  status: "live" | "reconnecting" | "unauthorized",
): void {
  context.eventStatus = status;
  if (status === "reconnecting" || status === "unauthorized") {
    context.workspaceFetchSeq += 1;
    context.workspaceRefetchAfterFetch = false;
    context.workspaceFetchEventSequence = null;
    context.workspaceEvents = [];
    for (const entry of entriesForServer(context.server)) {
      if (entry.refCount > 0) sessionWatch.markUnavailable(entry, status);
    }
  }
  setContextStatus(context, status);
}

async function listAllSessions(client: OpenCodeClient): Promise<readonly OpenCodeSessionInfo[]> {
  const sessions: OpenCodeSessionInfo[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let hasNextPage = true;
  do {
    const page = await client.sessions.list({
      limit: WORKSPACE_LIST_LIMIT,
      order: "desc",
      ...(cursor === undefined ? {} : { cursor }),
    });
    sessions.push(...page.data);
    const next = page.cursor.next;
    if (next === undefined || seenCursors.has(next)) {
      hasNextPage = false;
      continue;
    }
    seenCursors.add(next);
    cursor = next;
  } while (hasNextPage);
  return sessions;
}

function fetchWorkspace(
  context: ServerContext,
  options?: { readonly queueIfFetching?: boolean },
): Promise<void> {
  if (context.workspaceFetchPromise !== null) {
    if (options?.queueIfFetching === true) context.workspaceRefetchAfterFetch = true;
    return context.workspaceFetchPromise;
  }

  const promise = performWorkspaceFetch(context).finally(() => {
    if (context.workspaceFetchPromise !== promise) return;
    context.workspaceFetchPromise = null;
    const shouldRefetch = context.workspaceRefetchAfterFetch;
    context.workspaceRefetchAfterFetch = false;
    if (!shouldRefetch || contexts.get(context.server) !== context) return;
    if (workspaceRefCount === 0) {
      context.workspaceRefetchAfterFetch = true;
      return;
    }
    void fetchWorkspace(context);
  });
  context.workspaceFetchPromise = promise;
  return promise;
}

async function performWorkspaceFetch(context: ServerContext): Promise<void> {
  const seq = ++context.workspaceFetchSeq;
  const signalSeq = context.signalSeq;
  const eventSequence = context.workspaceEventSequence;
  context.workspaceFetchEventSequence = eventSequence;
  context.workspaceEvents = [];
  try {
    const list = await listAllSessions(context.client);
    if (seq !== context.workspaceFetchSeq || contexts.get(context.server) !== context) return;
    context.sessionInfos = new Map(list.map((info) => [info.id, info]));
    for (const entry of context.workspaceEvents) {
      if (entry.sequence > eventSequence) {
        applySessionInventoryMutation(context, entry.mutation);
      }
    }
    context.workspaceFetchEventSequence = null;
    context.workspaceEvents = [];
    const currentProjectIDs = new Set(
      [...context.sessionInfos.values()].map((info) => info.projectID),
    );
    context.projectDirectories = new Map(
      [...context.projectDirectories].filter(([projectID]) => currentProjectIDs.has(projectID)),
    );
    const currentIDs = new Set(context.sessionInfos.keys());
    for (const id of context.activityBySession.keys()) {
      if (!currentIDs.has(id)) context.activityBySession.delete(id);
    }
    for (const id of context.attentionBySession.keys()) {
      if (!currentIDs.has(id)) context.attentionBySession.delete(id);
    }
    for (const id of context.signalSeqBySession.keys()) {
      if (!currentIDs.has(id)) context.signalSeqBySession.delete(id);
    }
    context.loaded = true;
    const status =
      context.eventStatus === "reconnecting" || context.eventStatus === "unauthorized"
        ? context.eventStatus
        : "live";
    const statusChanged = context.status !== status;
    context.status = status;
    publishDerived(context);
    if (statusChanged) publishServers();

    const sessions = [...context.sessionInfos.values()];
    const activity = await loadSessionActivity(context.client, sessions);
    const attention = await loadAttentionRequests(context.client, sessions, activity, (sessionID) =>
      activityOf(context, sessionID),
    );
    if (seq !== context.workspaceFetchSeq || contexts.get(context.server) !== context) return;
    for (const id of context.sessionInfos.keys()) {
      if ((context.signalSeqBySession.get(id) ?? -1) >= signalSeq) continue;
      const resolved = activity.get(id);
      if (resolved !== undefined) context.activityBySession.set(id, resolved);
      const requestIDs = attention.get(id);
      if (requestIDs !== undefined) replaceAttention(context, id, requestIDs);
    }
    publishDerived(context);
  } catch (error) {
    context.workspaceFetchEventSequence = null;
    context.workspaceEvents = [];
    if (seq !== context.workspaceFetchSeq || contexts.get(context.server) !== context) return;
    setContextStatus(context, isUnauthorized(error) ? "unauthorized" : "reconnecting");
  }
}

function scheduleWorkspaceRefetch(context: ServerContext): void {
  if (context.workspaceRefetchTimer !== null) return;
  context.workspaceRefetchTimer = setTimeout(() => {
    context.workspaceRefetchTimer = null;
    void fetchWorkspace(context, { queueIfFetching: true });
  }, WORKSPACE_REFETCH_DEBOUNCE_MS);
}

function handleEvent(context: ServerContext, event: OpenCodeEvent): void {
  const activitySignal = sessionActivitySignal(event);
  if (activitySignal !== null) {
    void sessionWatch.applyActivity(context, activitySignal.sessionID, activitySignal.activity);
    return;
  }
  const sessionID = eventSessionID(event);
  switch (event.type) {
    case "server.connected": {
      setEventStatus(context, "live");
      if (workspaceRefCount > 0) void fetchWorkspace(context, { queueIfFetching: true });
      for (const entry of entriesForServer(context.server)) {
        if (entry.refCount === 0) continue;
        void sessionWatch.refresh(entry);
      }
      return;
    }
    case "server.heartbeat":
      return;
    case "global.disposed":
      void fetchWorkspace(context, { queueIfFetching: true });
      return;
    case "session.next.moved":
    case "session.next.agent.switched":
    case "session.next.model.switched":
    case "session.next.revert.staged":
    case "session.next.revert.cleared":
    case "session.next.revert.committed": {
      // Native V2 mutations do not emit the stable transcript events consumed below.
      // Reconcile open and unopened sessions through finite authoritative snapshots.
      void fetchWorkspace(context, { queueIfFetching: true });
      if (sessionID === null) return;
      const entry = sessionEntries.get(
        sessionEntryKey(openCodeSessionRef(context.server, sessionID)),
      );
      if (entry !== undefined) void sessionWatch.refresh(entry);
      return;
    }
    case "catalog.updated":
      publishCatalog();
      return;
    case "session.created":
    case "session.updated":
    case "session.deleted":
      handleSessionInventoryEvent(context, event);
      return;
    case "session.compacted":
      scheduleWorkspaceRefetch(context);
      return;
    case "question.asked":
    case "question.v2.asked":
    case "permission.asked":
    case "permission.v2.asked": {
      const requestID = eventRequestID(event);
      if (sessionID !== null && requestID !== null) {
        noteSignal(context, sessionID);
        markAttention(context, sessionID, requestID);
        publishDerived(context);
        const entry = sessionEntries.get(
          sessionEntryKey(openCodeSessionRef(context.server, sessionID)),
        );
        if (entry !== undefined) void sessionWatch.refreshRequests(entry);
      }
      return;
    }
    case "question.replied":
    case "question.rejected":
    case "question.v2.replied":
    case "question.v2.rejected":
    case "permission.replied":
    case "permission.v2.replied":
      if (sessionID !== null) {
        noteSignal(context, sessionID);
        clearAttention(context, sessionID, eventRequestID(event));
        publishDerived(context);
        const entry = sessionEntries.get(
          sessionEntryKey(openCodeSessionRef(context.server, sessionID)),
        );
        if (entry !== undefined) void sessionWatch.refreshRequests(entry);
      }
      return;
    default:
      sessionWatch.recordPersistedTranscriptEvent(context, event);
      return;
  }
}

function reconnectDelay(attempt: number): number {
  return Math.min(PUMP_RECONNECT_BASE_MS * 2 ** Math.min(attempt, 6), PUMP_RECONNECT_CEILING_MS);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPump(context: ServerContext, generation: number): Promise<void> {
  let attempt = 0;
  while (generation === context.pumpGeneration && contexts.get(context.server) === context) {
    const controller = new AbortController();
    context.pumpController = controller;
    let receivedEvent = false;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const armWatchdog = (): void => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => controller.abort(), PUMP_HEARTBEAT_TIMEOUT_MS);
    };
    armWatchdog();
    try {
      let yieldedAt = Date.now();
      for await (const event of context.client.events(controller.signal)) {
        if (generation !== context.pumpGeneration) return;
        receivedEvent = true;
        attempt = 0;
        armWatchdog();
        try {
          notifications.batch(() => handleEvent(context, event));
        } catch (error) {
          console.warn(`Skipping OpenCode event ${event.type} after handler failure.`, error);
        }
        if (Date.now() - yieldedAt < PUMP_YIELD_MS) continue;
        yieldedAt = Date.now();
        await wait(0);
      }
    } catch (error) {
      if (generation !== context.pumpGeneration || contexts.get(context.server) !== context) return;
      if (isUnauthorized(error)) {
        setEventStatus(context, "unauthorized");
        return;
      }
    } finally {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer);
      notifications.flush();
    }
    if (generation !== context.pumpGeneration || contexts.get(context.server) !== context) return;
    setEventStatus(context, "reconnecting");
    await wait(reconnectDelay(receivedEvent ? 0 : attempt));
    attempt += 1;
    if (generation !== context.pumpGeneration || contexts.get(context.server) !== context) return;
  }
}

function hasContextConsumers(context: ServerContext): boolean {
  return (
    workspaceRefCount > 0 ||
    catalogListeners.size > 0 ||
    entriesForServer(context.server).some((entry) => entry.refCount > 0)
  );
}

function ensurePump(context: ServerContext): void {
  if (context.pumpController !== null || !hasContextConsumers(context)) return;
  const generation = ++context.pumpGeneration;
  void runPump(context, generation).finally(() => {
    if (generation === context.pumpGeneration) context.pumpController = null;
  });
}

function stopPump(context: ServerContext): void {
  context.pumpGeneration += 1;
  context.pumpController?.abort();
  context.pumpController = null;
}

function createContext(client: OpenCodeClient): ServerContext {
  return {
    client,
    server: client.server.key,
    status: "connecting",
    eventStatus: "connecting",
    loaded: false,
    workspaceFetchSeq: 0,
    workspaceFetchPromise: null,
    workspaceRefetchAfterFetch: false,
    workspaceRefetchTimer: null,
    workspaceFetchEventSequence: null,
    workspaceEventSequence: 0,
    workspaceEvents: [],
    workspaceSessionEventSequence: new Map(),
    sessionInfos: new Map(),
    projectDirectories: new Map(),
    activityBySession: new Map(),
    attentionBySession: new Map(),
    signalSeq: 0,
    signalSeqBySession: new Map(),
    pumpGeneration: 0,
    pumpController: null,
  };
}

function clearSessionTimers(entry: SessionEntry): void {
  if (entry.teardownTimer !== null) {
    clearTimeout(entry.teardownTimer);
    entry.teardownTimer = null;
  }
}

function disposeContext(context: ServerContext): void {
  stopPump(context);
  context.workspaceFetchSeq += 1;
  context.workspaceFetchPromise = null;
  context.workspaceRefetchAfterFetch = false;
  context.workspaceFetchEventSequence = null;
  context.workspaceEvents = [];
  context.workspaceSessionEventSequence.clear();
  if (context.workspaceRefetchTimer !== null) {
    clearTimeout(context.workspaceRefetchTimer);
    context.workspaceRefetchTimer = null;
  }
  for (const entry of entriesForServer(context.server)) {
    sessionWatch.dispose(entry);
    clearSessionTimers(entry);
    if (entry.refCount === 0) {
      sessionEntries.delete(sessionEntryKey(entry.ref));
      continue;
    }
    sessionWatch.publish(entry, { state: entry.snapshot.state, status: "closed" });
  }
}

export function registerOpenCodeClient(
  client: OpenCodeClient,
  options?: { readonly primary?: boolean },
): void {
  const existing = contexts.get(client.server.key);
  if (existing?.client === client) {
    if (options?.primary === true && primaryServer !== client.server.key) {
      primaryServer = client.server.key;
      publishWorkspace();
      publishServers();
    }
    return;
  }
  if (existing !== undefined) disposeContext(existing);
  const context = createContext(client);
  contexts.set(context.server, context);
  if (primaryServer === null || options?.primary === true) primaryServer = context.server;
  if (workspaceRefCount > 0) void fetchWorkspace(context);
  for (const entry of entriesForServer(context.server)) {
    if (entry.refCount > 0) void sessionWatch.refresh(entry);
  }
  ensurePump(context);
  publishWorkspace();
  publishServers();
}

export function unregisterOpenCodeClient(server: OpenCodeServerKey): void {
  const context = contexts.get(server);
  if (context === undefined) return;
  contexts.delete(server);
  disposeContext(context);
  if (boundServer === server) boundServer = null;
  if (primaryServer === server) primaryServer = contexts.keys().next().value ?? null;
  publishWorkspace();
  publishServers();
}

export function bindOpenCodeClient(next: OpenCodeClient | null): void {
  const previous = boundServer;
  if (next === null) {
    boundServer = null;
    if (previous !== null) unregisterOpenCodeClient(previous);
    return;
  }
  boundServer = next.server.key;
  if (previous !== null && previous !== next.server.key) unregisterOpenCodeClient(previous);
  registerOpenCodeClient(next, { primary: true });
}

export function selectOpenCodeServer(server: OpenCodeServerKey): boolean {
  if (!contexts.has(server)) return false;
  if (primaryServer === server) return true;
  primaryServer = server;
  publishWorkspace();
  publishServers();
  return true;
}

export function subscribeOpenCodeServers(listener: () => void): () => void {
  serverListeners.add(listener);
  return () => {
    serverListeners.delete(listener);
  };
}

export function getOpenCodeServersSnapshot(): OpenCodeServerWatchSnapshot {
  return serverSnapshot;
}

export function subscribeOpenCodeCatalog(listener: () => void): () => void {
  catalogListeners.add(listener);
  for (const context of contexts.values()) ensurePump(context);
  return () => {
    catalogListeners.delete(listener);
    if (catalogListeners.size > 0) return;
    for (const context of contexts.values()) {
      if (!hasContextConsumers(context)) stopPump(context);
    }
  };
}

export function getOpenCodeCatalogRevision(): number {
  return catalogRevision;
}

export function getOpenCodeCatalogServerRevision(): number {
  return 0;
}

export function getOpenCodeClient(server: OpenCodeServerKey): OpenCodeClient | null {
  return contexts.get(server)?.client ?? null;
}

export function getBoundOpenCodeClient(): OpenCodeClient | null {
  return primaryServer === null ? null : (contexts.get(primaryServer)?.client ?? null);
}

export function requireBoundOpenCodeClient(): OpenCodeClient {
  const client = getBoundOpenCodeClient();
  if (client === null) throw new Error("The OpenCode connection is not ready yet.");
  return client;
}

export function noteOpenCodeSessionPromptAccepted(ref: OpenCodeSessionRef): void {
  const context = contexts.get(ref.server);
  if (context === undefined) return;
  noteSignal(context, ref.sessionID);
  setActivity(context, ref.sessionID, "busy");
  const entry = sessionEntries.get(sessionEntryKey(ref));
  if (entry !== undefined) void sessionWatch.refresh(entry);
}

function teardownSessionEntry(key: string): void {
  const entry = sessionEntries.get(key);
  if (entry === undefined || entry.refCount > 0) return;
  clearSessionTimers(entry);
  sessionWatch.dispose(entry);
  sessionEntries.delete(key);
  const context = contexts.get(entry.ref.server);
  if (context !== undefined && !hasContextConsumers(context)) stopPump(context);
}

export function subscribeSessionWatch(ref: OpenCodeSessionRef, listener: () => void): () => void {
  const key = sessionEntryKey(ref);
  let entry = sessionEntries.get(key);
  if (entry === undefined) {
    entry = sessionWatch.createEntry(ref);
    sessionEntries.set(key, entry);
  }
  if (entry.teardownTimer !== null) {
    clearTimeout(entry.teardownTimer);
    entry.teardownTimer = null;
  }
  entry.listeners.add(listener);
  const activating = entry.refCount === 0;
  entry.refCount += 1;
  const context = contexts.get(ref.server);
  if (context !== undefined) {
    if (activating && entry.snapshot.state === null) void sessionWatch.refresh(entry);
    ensurePump(context);
  }

  const boundEntry = entry;
  return () => {
    boundEntry.listeners.delete(listener);
    boundEntry.refCount -= 1;
    if (boundEntry.refCount > 0) return;
    if (boundEntry.teardownTimer !== null) clearTimeout(boundEntry.teardownTimer);
    boundEntry.teardownTimer = setTimeout(() => {
      boundEntry.teardownTimer = null;
      teardownSessionEntry(key);
    }, STRICT_MODE_GRACE_MS);
  };
}

export function getSessionWatchSnapshot(ref: OpenCodeSessionRef): SessionWatchSnapshot {
  return sessionEntries.get(sessionEntryKey(ref))?.snapshot ?? INITIAL_SESSION_SNAPSHOT;
}

export function getSessionWatchServerSnapshot(): SessionWatchSnapshot {
  return INITIAL_SESSION_SNAPSHOT;
}

export function subscribeWorkspaceWatch(listener: () => void): () => void {
  workspaceListeners.add(listener);
  const activatingWorkspace = workspaceRefCount === 0;
  workspaceRefCount += 1;
  for (const context of contexts.values()) {
    if (
      activatingWorkspace &&
      context.workspaceRefetchAfterFetch &&
      context.workspaceFetchPromise === null
    ) {
      context.workspaceRefetchAfterFetch = false;
      void fetchWorkspace(context);
      ensurePump(context);
      continue;
    }
    if (!context.loaded && context.workspaceRefetchTimer === null) void fetchWorkspace(context);
    ensurePump(context);
  }
  return () => {
    workspaceListeners.delete(listener);
    workspaceRefCount = Math.max(0, workspaceRefCount - 1);
    if (workspaceRefCount === 0) {
      for (const context of contexts.values()) {
        if (!hasContextConsumers(context)) stopPump(context);
      }
    }
  };
}

export function getWorkspaceWatchSnapshot(): WorkspaceWatchSnapshot {
  return workspaceSnapshot;
}

export function getWorkspaceWatchServerSnapshot(): WorkspaceWatchSnapshot {
  return INITIAL_WORKSPACE_SNAPSHOT;
}

export const getSessionInventoryWatchSnapshot = getWorkspaceWatchSnapshot;
export const subscribeSessionInventoryWatch = subscribeWorkspaceWatch;
