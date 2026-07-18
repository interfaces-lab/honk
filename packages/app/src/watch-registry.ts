import {
  openCodeSessionKey,
  openCodeSessionRef,
  type OpenCodeClient,
  type OpenCodeEvent,
  type OpenCodeLocationQuery,
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

const WORKSPACE_LIST_LIMIT = 200;
const ATTENTION_REQUEST_CONCURRENCY = 6;
const RECENT_DIRECTORY_LIMIT = 8;
const WORKSPACE_REFETCH_DEBOUNCE_MS = 200;
const PUMP_RECONNECT_BASE_MS = 250;
const PUMP_RECONNECT_CEILING_MS = 10_000;
const PUMP_HEARTBEAT_TIMEOUT_MS = 45_000;
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
  loaded: boolean;
  workspaceFetchSeq: number;
  workspaceFetchPromise: Promise<void> | null;
  workspaceRefetchAfterFetch: boolean;
  workspaceRefetchTimer: ReturnType<typeof setTimeout> | null;
  sessionInfos: Map<string, OpenCodeSessionInfo>;
  projectDirectories: Map<string, string>;
  readonly activityBySession: Map<string, SessionActivity>;
  readonly attentionBySession: Map<string, Set<string>>;
  signalSeq: number;
  readonly signalSeqBySession: Map<string, number>;
  pumpGeneration: number;
  pumpController: AbortController | null;
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

function notify(listeners: ReadonlySet<() => void>): void {
  for (const listener of listeners) listener();
}

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
  noteBusy: (context, sessionID) => {
    noteSignal(context, sessionID);
    context.activityBySession.set(sessionID, "busy");
    publishDerived(context);
  },
  publishDerived,
});

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
  notify(workspaceListeners);
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
  notify(serverListeners);
}

function publishCatalog(): void {
  catalogRevision += 1;
  notify(catalogListeners);
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
    const activity = status === "running" ? (ownActivity === "retry" ? "retry" : "busy") : "idle";
    if (
      state.activity === activity &&
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
        activity,
        needsAttention,
      }),
      status: entry.snapshot.status,
    });
  }
}

function setContextStatus(context: ServerContext, status: AdapterWatchStatus): void {
  if (context.status !== status) {
    context.status = status;
    publishWorkspace();
    publishServers();
  }
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

async function loadAttentionRequests(
  context: ServerContext,
  sessions: readonly OpenCodeSessionInfo[],
  activeSessions: Readonly<Record<string, unknown>>,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const requests = new Map<string, readonly string[]>();
  const groups = new Map<
    string,
    { readonly location: OpenCodeLocationQuery; readonly sessionIDs: Set<string> }
  >();
  for (const info of sessions) {
    requests.set(info.id, []);
    if (!(info.id in activeSessions)) continue;
    const key = JSON.stringify([info.location.directory, info.location.workspaceID ?? null]);
    const existing = groups.get(key);
    if (existing !== undefined) {
      existing.sessionIDs.add(info.id);
      continue;
    }
    groups.set(key, {
      location: info.location,
      sessionIDs: new Set([info.id]),
    });
  }
  const locations = [...groups.values()];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < locations.length) {
      const group = locations[index];
      index += 1;
      if (group === undefined) continue;
      try {
        const [permissions, questions] = await Promise.all([
          context.client.requests.permissions(group.location),
          context.client.requests.questions(group.location),
        ]);
        const bySession = new Map<string, string[]>();
        for (const sessionID of group.sessionIDs) bySession.set(sessionID, []);
        for (const request of [...permissions.data, ...questions.data]) {
          if (!group.sessionIDs.has(request.sessionID)) continue;
          bySession.get(request.sessionID)?.push(request.id);
        }
        for (const [sessionID, requestIDs] of bySession) requests.set(sessionID, requestIDs);
      } catch {
        // Request queues are supplementary to session inventory. Preserve the
        // last event-derived attention state when one location cannot load.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ATTENTION_REQUEST_CONCURRENCY, locations.length) }, () =>
      worker(),
    ),
  );
  return requests;
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
  try {
    const [list, active] = await Promise.all([
      listAllSessions(context.client),
      context.client.sessions.active(),
    ]);
    const attention = await loadAttentionRequests(context, list, active);
    if (seq !== context.workspaceFetchSeq || contexts.get(context.server) !== context) return;
    context.sessionInfos = new Map(list.map((info) => [info.id, info]));
    const currentProjectIDs = new Set(list.map((info) => info.projectID));
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
    for (const id of context.sessionInfos.keys()) {
      if ((context.signalSeqBySession.get(id) ?? -1) < signalSeq) {
        context.activityBySession.set(id, id in active ? "busy" : "idle");
        const requestIDs = attention.get(id);
        if (requestIDs !== undefined) replaceAttention(context, id, requestIDs);
      }
    }
    context.loaded = true;
    const statusChanged = context.status !== "live";
    context.status = "live";
    publishDerived(context);
    if (statusChanged) publishServers();
  } catch (error) {
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
  const sessionID = eventSessionID(event);
  switch (event.type) {
    case "server.connected":
      scheduleWorkspaceRefetch(context);
      for (const entry of entriesForServer(context.server)) {
        if (entry.refCount > 0) void sessionWatch.refreshRequests(entry);
      }
      return;
    case "server.heartbeat":
      return;
    case "catalog.updated":
      publishCatalog();
      return;
    case "session.created":
    case "session.updated":
    case "session.compacted":
      scheduleWorkspaceRefetch(context);
      return;
    case "session.deleted":
      scheduleWorkspaceRefetch(context);
      if (sessionID !== null) {
        const entry = sessionEntries.get(
          sessionEntryKey(openCodeSessionRef(context.server, sessionID)),
        );
        if (entry !== undefined) sessionWatch.close(entry);
      }
      return;
    case "session.status": {
      const status = event.data.status.type;
      const activity = status === "busy" ? "busy" : status === "retry" ? "retry" : "idle";
      noteSignal(context, event.data.sessionID);
      context.activityBySession.set(event.data.sessionID, activity);
      publishDerived(context);
      if (activity === "idle") {
        scheduleWorkspaceRefetch(context);
      }
      return;
    }
    case "session.idle":
      if (sessionID !== null) {
        noteSignal(context, sessionID);
        context.activityBySession.set(sessionID, "idle");
        publishDerived(context);
        scheduleWorkspaceRefetch(context);
      }
      return;
    case "session.next.text.delta":
      sessionWatch.recordLiveDelta(context, {
        sessionID: event.data.sessionID,
        partID: event.data.textID,
        kind: "text",
        delta: event.data.delta,
        timestamp: event.data.timestamp,
      });
      return;
    case "session.next.reasoning.delta":
      sessionWatch.recordLiveDelta(context, {
        sessionID: event.data.sessionID,
        partID: event.data.reasoningID,
        kind: "text",
        delta: event.data.delta,
        timestamp: event.data.timestamp,
      });
      return;
    case "session.next.tool.input.delta":
      sessionWatch.recordLiveDelta(context, {
        sessionID: event.data.sessionID,
        partID: event.data.callID,
        kind: "tool-input",
        delta: event.data.delta,
        timestamp: event.data.timestamp,
      });
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
    let lastReceivedEventAt = Date.now();
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const armWatchdog = (): void => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(
        () => {
          if (
            generation !== context.pumpGeneration ||
            contexts.get(context.server) !== context ||
            context.pumpController !== controller ||
            controller.signal.aborted
          ) {
            return;
          }
          if (Date.now() - lastReceivedEventAt < PUMP_HEARTBEAT_TIMEOUT_MS) {
            armWatchdog();
            return;
          }
          const observedAt = lastReceivedEventAt;
          // Some v2 transports send SSE comment heartbeats that the decoded event iterator does
          // not yield. Confirm server health before declaring a quiet stream disconnected.
          void context.client.health().then(
            () => {
              if (
                generation !== context.pumpGeneration ||
                contexts.get(context.server) !== context ||
                context.pumpController !== controller ||
                controller.signal.aborted ||
                lastReceivedEventAt !== observedAt
              ) {
                return;
              }
              lastReceivedEventAt = Date.now();
              armWatchdog();
            },
            () => {
              if (
                generation === context.pumpGeneration &&
                contexts.get(context.server) === context &&
                context.pumpController === controller &&
                !controller.signal.aborted &&
                lastReceivedEventAt === observedAt
              ) {
                controller.abort();
              }
            },
          );
        },
        Math.max(0, PUMP_HEARTBEAT_TIMEOUT_MS - (Date.now() - lastReceivedEventAt)),
      );
    };
    armWatchdog();
    try {
      for await (const event of context.client.events(controller.signal)) {
        if (generation !== context.pumpGeneration) return;
        receivedEvent = true;
        attempt = 0;
        lastReceivedEventAt = Date.now();
        armWatchdog();
        try {
          handleEvent(context, event);
        } catch (error) {
          console.warn(`Skipping OpenCode event ${event.type} after handler failure.`, error);
        }
      }
    } catch (error) {
      if (generation !== context.pumpGeneration || contexts.get(context.server) !== context) return;
      if (isUnauthorized(error)) {
        setContextStatus(context, "unauthorized");
        return;
      }
    } finally {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer);
    }
    if (generation !== context.pumpGeneration || contexts.get(context.server) !== context) return;
    setContextStatus(context, "reconnecting");
    await wait(reconnectDelay(receivedEvent ? 0 : attempt));
    attempt += 1;
    if (generation !== context.pumpGeneration || contexts.get(context.server) !== context) return;
    if (workspaceRefCount > 0) void fetchWorkspace(context, { queueIfFetching: true });
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
    loaded: false,
    workspaceFetchSeq: 0,
    workspaceFetchPromise: null,
    workspaceRefetchAfterFetch: false,
    workspaceRefetchTimer: null,
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
    if (entry.refCount > 0) sessionWatch.ensurePump(entry);
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
  context.activityBySession.set(ref.sessionID, "busy");
  publishDerived(context);
}

function teardownSessionEntry(key: string): void {
  const entry = sessionEntries.get(key);
  if (entry === undefined || entry.refCount > 0) return;
  sessionWatch.stopPump(entry);
  clearSessionTimers(entry);
  entry.fetchSeq += 1;
  entry.fetchPromise = null;
  entry.refetchAfterFetch = false;
  entry.requestSeq += 1;
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
  entry.refCount += 1;
  const context = contexts.get(ref.server);
  if (context !== undefined) {
    sessionWatch.ensurePump(entry);
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
