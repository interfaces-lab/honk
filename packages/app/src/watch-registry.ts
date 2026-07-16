import {
  openCodeSessionKey,
  openCodeSessionRef,
  resolveOpenCodeProjectDirectories,
  type OpenCodeClient,
  type OpenCodeEvent,
  type OpenCodeLocationQuery,
  type OpenCodeServerDescriptor,
  type OpenCodeServerKey,
  type OpenCodeSessionInfo,
  type OpenCodeSessionRef,
} from "@honk/opencode";

import {
  appSessionState,
  appSessionStatusFromActivity,
  appSessionSummary,
  projectSessionSummaries,
  type AppChildSessionSummary,
  type AppSessionState,
  type AppSessionSummary,
} from "./open-code-view";

export type WatchStatus = "live" | "reconnecting" | "closed" | "unauthorized";
export type AdapterWatchStatus = "connecting" | WatchStatus;
export type SessionActivity = "busy" | "retry" | "idle";

export type WorkspaceWatchState = {
  readonly sessions: readonly AppSessionSummary[];
  readonly rootSessions: readonly AppSessionSummary[];
  readonly childSessions: readonly AppChildSessionSummary[];
  readonly recentDirectories: readonly string[];
};

export type SessionWatchState = {
  readonly app: AppSessionState;
  readonly attachedDirectories: readonly string[];
  readonly activity: SessionActivity;
  readonly needsAttention: boolean;
};

export type SessionWatchSnapshot = {
  readonly state: SessionWatchState | null;
  readonly status: AdapterWatchStatus;
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
const SESSION_REFETCH_DEBOUNCE_MS = 120;
const PUMP_RECONNECT_BASE_MS = 250;
const PUMP_RECONNECT_CEILING_MS = 10_000;
const STRICT_MODE_GRACE_MS = 0;

const INITIAL_SESSION_SNAPSHOT: SessionWatchSnapshot = Object.freeze({
  state: null,
  status: "connecting",
});

const INITIAL_WORKSPACE_SNAPSHOT: WorkspaceWatchSnapshot = Object.freeze({
  state: null,
  status: "connecting",
});

const INITIAL_SERVER_SNAPSHOT: OpenCodeServerWatchSnapshot = Object.freeze({
  servers: Object.freeze([]),
});

type SessionEntry = {
  readonly ref: OpenCodeSessionRef;
  refCount: number;
  fetchSeq: number;
  fetchPromise: Promise<void> | null;
  refetchAfterFetch: boolean;
  refetchTimer: ReturnType<typeof setTimeout> | null;
  teardownTimer: ReturnType<typeof setTimeout> | null;
  snapshot: SessionWatchSnapshot;
  readonly listeners: Set<() => void>;
};

type ServerContext = {
  readonly client: OpenCodeClient;
  readonly server: OpenCodeServerKey;
  status: AdapterWatchStatus;
  loaded: boolean;
  workspaceFetchSeq: number;
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
let workspaceRefCount = 0;
let workspaceSnapshot = INITIAL_WORKSPACE_SNAPSHOT;
let serverSnapshot = INITIAL_SERVER_SNAPSHOT;
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

function publishSession(entry: SessionEntry, next: SessionWatchSnapshot): void {
  if (entry.snapshot.state === next.state && entry.snapshot.status === next.status) return;
  entry.snapshot = Object.freeze(next);
  notify(entry.listeners);
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
    publishSession(entry, {
      state: Object.freeze({
        ...state,
        app: Object.freeze({
          ...state.app,
          summary: Object.freeze({ ...state.app.summary, status, needsAttention, updatedAt }),
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
  for (const entry of entriesForServer(context.server)) {
    publishSession(entry, { state: entry.snapshot.state, status });
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

async function fetchWorkspace(context: ServerContext): Promise<void> {
  const seq = ++context.workspaceFetchSeq;
  const signalSeq = context.signalSeq;
  try {
    const [list, active] = await Promise.all([
      listAllSessions(context.client),
      context.client.sessions.active(),
    ]);
    const [attention, projectDirectories] = await Promise.all([
      loadAttentionRequests(context, list, active),
      resolveOpenCodeProjectDirectories(context.client, list),
    ]);
    if (seq !== context.workspaceFetchSeq || contexts.get(context.server) !== context) return;
    context.sessionInfos = new Map(list.map((info) => [info.id, info]));
    context.projectDirectories = new Map(projectDirectories);
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
      if ((context.signalSeqBySession.get(id) ?? 0) <= signalSeq) {
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

function fetchSession(
  entry: SessionEntry,
  options?: { readonly queueIfFetching?: boolean },
): Promise<void> {
  if (entry.fetchPromise !== null) {
    if (options?.queueIfFetching === true) entry.refetchAfterFetch = true;
    return entry.fetchPromise;
  }

  const promise = performSessionFetch(entry).finally(() => {
    if (entry.fetchPromise !== promise) return;
    entry.fetchPromise = null;
    const shouldRefetch = entry.refetchAfterFetch;
    entry.refetchAfterFetch = false;
    if (
      shouldRefetch &&
      entry.refCount > 0 &&
      sessionEntries.get(sessionEntryKey(entry.ref)) === entry
    ) {
      void fetchSession(entry);
    }
  });
  entry.fetchPromise = promise;
  return promise;
}

async function performSessionFetch(entry: SessionEntry): Promise<void> {
  const context = contexts.get(entry.ref.server);
  if (context === undefined) return;
  const seq = ++entry.fetchSeq;
  const signalSeq = context.signalSeq;
  try {
    const [transcript, permissions, questions] = await Promise.all([
      context.client.sessions.transcript(entry.ref),
      context.client.sessions.permissions(entry.ref).catch(() => []),
      context.client.sessions.questions(entry.ref).catch(() => []),
    ]);
    const info = transcript.info;
    const projectDirectory =
      context.projectDirectories.get(info.projectID) ??
      (await resolveOpenCodeProjectDirectories(context.client, [info])).get(info.projectID) ??
      info.location.directory;
    if (
      seq !== entry.fetchSeq ||
      contexts.get(entry.ref.server) !== context ||
      sessionEntries.get(sessionEntryKey(entry.ref)) !== entry
    ) {
      return;
    }
    context.projectDirectories.set(info.projectID, projectDirectory);
    context.sessionInfos.set(info.id, info);
    if ((context.signalSeqBySession.get(info.id) ?? 0) <= signalSeq) {
      replaceAttention(context, info.id, [
        ...permissions.map((request) => request.id),
        ...questions.map((request) => request.id),
      ]);
    }
    const activity = activityOf(context, entry.ref.sessionID);
    const needsAttention = attentionOf(context, entry.ref.sessionID);
    publishSession(entry, {
      state: Object.freeze({
        app: appSessionState({
          transcript,
          server: context.server,
          status: appSessionStatusFromActivity(activity),
          permissions,
          questions,
          projectDirectory,
        }),
        attachedDirectories: Object.freeze([]),
        activity,
        needsAttention,
      }),
      status: "live",
    });
    publishDerived(context);
  } catch (error) {
    if (
      seq !== entry.fetchSeq ||
      contexts.get(entry.ref.server) !== context ||
      sessionEntries.get(sessionEntryKey(entry.ref)) !== entry
    ) {
      return;
    }
    publishSession(entry, {
      state: entry.snapshot.state,
      status: isUnauthorized(error) ? "unauthorized" : "reconnecting",
    });
  }
}

function scheduleWorkspaceRefetch(context: ServerContext): void {
  if (context.workspaceRefetchTimer !== null) return;
  context.workspaceRefetchTimer = setTimeout(() => {
    context.workspaceRefetchTimer = null;
    void fetchWorkspace(context);
  }, WORKSPACE_REFETCH_DEBOUNCE_MS);
}

function scheduleSessionRefetch(
  context: ServerContext,
  sessionID: string,
  mode: "debounced" | "trailing" = "debounced",
): void {
  const entry = sessionEntries.get(sessionEntryKey(openCodeSessionRef(context.server, sessionID)));
  if (entry === undefined) return;
  if (entry.refetchTimer !== null) {
    if (mode === "debounced") return;
    clearTimeout(entry.refetchTimer);
  }
  entry.refetchTimer = setTimeout(() => {
    entry.refetchTimer = null;
    void fetchSession(entry, { queueIfFetching: true });
  }, SESSION_REFETCH_DEBOUNCE_MS);
}

function handleEvent(context: ServerContext, event: OpenCodeEvent): void {
  const sessionID = eventSessionID(event);
  switch (event.type) {
    case "session.created":
    case "session.updated":
    case "session.deleted":
    case "session.compacted":
      scheduleWorkspaceRefetch(context);
      if (sessionID !== null) scheduleSessionRefetch(context, sessionID);
      return;
    case "session.status": {
      const status = event.data.status.type;
      const activity = status === "busy" ? "busy" : status === "retry" ? "retry" : "idle";
      noteSignal(context, event.data.sessionID);
      context.activityBySession.set(event.data.sessionID, activity);
      publishDerived(context);
      if (activity === "idle") {
        scheduleWorkspaceRefetch(context);
        scheduleSessionRefetch(context, event.data.sessionID, "trailing");
      }
      return;
    }
    case "session.idle":
      if (sessionID !== null) {
        noteSignal(context, sessionID);
        context.activityBySession.set(sessionID, "idle");
        publishDerived(context);
        scheduleWorkspaceRefetch(context);
        scheduleSessionRefetch(context, sessionID, "trailing");
      }
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
        scheduleSessionRefetch(context, sessionID);
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
        scheduleSessionRefetch(context, sessionID);
      }
      return;
    default:
      if (sessionID !== null) scheduleSessionRefetch(context, sessionID);
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
    try {
      for await (const event of context.client.events(controller.signal)) {
        if (generation !== context.pumpGeneration) return;
        receivedEvent = true;
        attempt = 0;
        handleEvent(context, event);
      }
    } catch (error) {
      if (generation !== context.pumpGeneration || contexts.get(context.server) !== context) return;
      if (isUnauthorized(error)) {
        setContextStatus(context, "unauthorized");
        return;
      }
    }
    if (generation !== context.pumpGeneration || contexts.get(context.server) !== context) return;
    setContextStatus(context, "reconnecting");
    await wait(reconnectDelay(receivedEvent ? 0 : attempt));
    attempt += 1;
    if (generation !== context.pumpGeneration || contexts.get(context.server) !== context) return;
    if (workspaceRefCount > 0) void fetchWorkspace(context);
    for (const entry of entriesForServer(context.server)) {
      if (entry.refCount > 0) void fetchSession(entry, { queueIfFetching: true });
    }
  }
}

function hasContextConsumers(context: ServerContext): boolean {
  return (
    workspaceRefCount > 0 || entriesForServer(context.server).some((entry) => entry.refCount > 0)
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
  if (entry.refetchTimer !== null) {
    clearTimeout(entry.refetchTimer);
    entry.refetchTimer = null;
  }
  if (entry.teardownTimer !== null) {
    clearTimeout(entry.teardownTimer);
    entry.teardownTimer = null;
  }
}

function disposeContext(context: ServerContext): void {
  stopPump(context);
  context.workspaceFetchSeq += 1;
  if (context.workspaceRefetchTimer !== null) {
    clearTimeout(context.workspaceRefetchTimer);
    context.workspaceRefetchTimer = null;
  }
  for (const entry of entriesForServer(context.server)) {
    clearSessionTimers(entry);
    entry.fetchSeq += 1;
    entry.fetchPromise = null;
    entry.refetchAfterFetch = false;
    if (entry.refCount === 0) {
      sessionEntries.delete(sessionEntryKey(entry.ref));
      continue;
    }
    publishSession(entry, { state: entry.snapshot.state, status: "closed" });
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
    if (entry.refCount > 0) void fetchSession(entry, { queueIfFetching: true });
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

function createSessionEntry(ref: OpenCodeSessionRef): SessionEntry {
  return {
    ref,
    refCount: 0,
    fetchSeq: 0,
    fetchPromise: null,
    refetchAfterFetch: false,
    refetchTimer: null,
    teardownTimer: null,
    snapshot: INITIAL_SESSION_SNAPSHOT,
    listeners: new Set(),
  };
}

function teardownSessionEntry(key: string): void {
  const entry = sessionEntries.get(key);
  if (entry === undefined || entry.refCount > 0) return;
  clearSessionTimers(entry);
  entry.fetchSeq += 1;
  entry.fetchPromise = null;
  entry.refetchAfterFetch = false;
  sessionEntries.delete(key);
  const context = contexts.get(entry.ref.server);
  if (context !== undefined && !hasContextConsumers(context)) stopPump(context);
}

export function subscribeSessionWatch(ref: OpenCodeSessionRef, listener: () => void): () => void {
  const key = sessionEntryKey(ref);
  let entry = sessionEntries.get(key);
  if (entry === undefined) {
    entry = createSessionEntry(ref);
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
    if (entry.snapshot.state === null && entry.refetchTimer === null) void fetchSession(entry);
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
  workspaceRefCount += 1;
  for (const context of contexts.values()) {
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
