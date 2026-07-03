import type { EnvironmentId } from "@honk/shared/environment";
import {
  type OrchestrationEvent,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamEvent,
  ORCHESTRATION_REPLAY_EVENTS_DEFAULT_LIMIT,
} from "@honk/shared/orchestration";
import { ThreadId } from "@honk/shared/base-schemas";
import { type QueryClient } from "@tanstack/react-query";
import {
  getKnownEnvironmentWsBaseUrl,
  scopedThreadKey,
  scopeThreadRef,
} from "~/lib/environment-scope";

import {
  markPromotedDraftThreadByRef,
  markPromotedDraftThreadsByRef,
  useComposerDraftStore,
} from "~/stores/chat-drafts";
import { coalesceOrchestrationUiEvents } from "./coalesce-orchestration-events";
import { deriveOrchestrationBatchEffects } from "./orchestration-event-effects";
import { refreshGitStatus } from "~/lib/git-status-state";
import { invalidateGitPatchQueries } from "~/lib/environment-git-react-query";
import { getPrimaryKnownEnvironment } from "../primary";
import { resolveAuthenticatedServerBearerToken } from "../primary/auth";
import { hasActiveOrchestrationTurn } from "~/session-logic";
import { createEnvironmentConnection, type EnvironmentConnection } from "./connection";
import {
  forgetLiveShellSnapshot,
  readCachedShellSnapshot,
  rememberLiveShellEvent,
  rememberLiveShellSnapshot,
} from "./local-shell-snapshot-cache";
import { createFrameBatcher, type FrameBatcher } from "./frame-batcher";
import {
  useStore,
  selectProjectsAcrossEnvironments,
  selectSidebarThreadSummaryByRef,
  selectThreadByRef,
  selectThreadsAcrossEnvironments,
} from "~/stores/thread-store";
import { useUiStateStore } from "~/stores/ui-state-store";
import { WsTransport } from "../../rpc/ws-transport";
import { createWsRpcClient, type WsRpcClient } from "../../rpc/ws-rpc-client";
import { emitWelcome, setServerConfigSnapshot } from "../../rpc/server-state";
import { deriveSidebarProjectStateKey, getProjectOrderKey } from "~/stores/project-identity";
import { findWorkspaceProjectForSource } from "~/lib/workspace-target";

type EnvironmentServiceState = {
  readonly queryClient: QueryClient;
  refCount: number;
  stop: () => void;
};

type ThreadDetailSubscriptionEntry = {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  unsubscribe: () => void;
  unsubscribeConnectionListener: (() => void) | null;
  refCount: number;
  lastAccessedAt: number;
  evictionTimeoutId: ReturnType<typeof setTimeout> | null;
};

const environmentConnections = new Map<EnvironmentId, EnvironmentConnection>();
const environmentConnectionListeners = new Set<() => void>();
const threadDetailSubscriptions = new Map<string, ThreadDetailSubscriptionEntry>();
const pendingThreadDetailEventBatches = new Map<EnvironmentId, FrameBatcher<OrchestrationEvent>>();
const pendingGitStatusActivityRefreshes = new Map<string, ReturnType<typeof setTimeout>>();
const lastAppliedProjectionVersionByEnvironment = new Map<
  EnvironmentId,
  {
    readonly sequence: number;
    readonly updatedAt: string | null;
  }
>();
const pendingShellGapRepairByEnvironment = new Map<EnvironmentId, Promise<void>>();

let activeService: EnvironmentServiceState | null = null;

// Thread detail subscription cache policy:
// - Active consumers retain a subscription through refCount.
// - Released subscriptions stay warm during UI navigation.
// - Threads with active work or pending user action are not evicted.
// - Capacity eviction only removes idle cached subscriptions.
const THREAD_DETAIL_SUBSCRIPTION_IDLE_EVICTION_MS = 15 * 60 * 1000;
const THREAD_DETAIL_EVENT_BATCH_TIMEOUT_MS = 16;
const MAX_CACHED_THREAD_DETAIL_SUBSCRIPTIONS = 32;
const GIT_STATUS_ACTIVITY_REFRESH_DEBOUNCE_MS = 2_500;
const NOOP = () => undefined;

function compareAppliedProjectionVersion(
  left: { readonly sequence: number; readonly updatedAt: string | null },
  right: { readonly sequence: number; readonly updatedAt: string | null },
): number {
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }

  const leftUpdatedAt = left.updatedAt ?? "";
  const rightUpdatedAt = right.updatedAt ?? "";
  if (leftUpdatedAt === rightUpdatedAt) {
    return 0;
  }

  return leftUpdatedAt < rightUpdatedAt ? -1 : 1;
}

function toAppliedProjectionVersion(
  snapshot: Pick<OrchestrationShellSnapshot, "snapshotSequence" | "updatedAt">,
): {
  readonly sequence: number;
  readonly updatedAt: string;
} {
  return {
    sequence: snapshot.snapshotSequence,
    updatedAt: snapshot.updatedAt,
  };
}

export function shouldApplyProjectionSnapshot(input: {
  readonly current: {
    readonly sequence: number;
    readonly updatedAt: string | null;
  } | null;
  readonly next: Pick<OrchestrationShellSnapshot, "snapshotSequence" | "updatedAt">;
}): boolean {
  if (input.current === null) {
    return true;
  }

  return compareAppliedProjectionVersion(input.current, toAppliedProjectionVersion(input.next)) < 0;
}

export function shouldApplyProjectionEvent(input: {
  readonly current: {
    readonly sequence: number;
    readonly updatedAt: string | null;
  } | null;
  readonly sequence: number;
}): boolean {
  if (input.current === null) {
    return true;
  }

  return input.sequence > input.current.sequence;
}

function readLastAppliedProjectionVersion(environmentId: EnvironmentId): {
  readonly sequence: number;
  readonly updatedAt: string | null;
} | null {
  return lastAppliedProjectionVersionByEnvironment.get(environmentId) ?? null;
}

function markAppliedProjectionSnapshot(
  environmentId: EnvironmentId,
  snapshot: Pick<OrchestrationShellSnapshot, "snapshotSequence" | "updatedAt">,
): void {
  const nextVersion = toAppliedProjectionVersion(snapshot);
  const currentVersion = readLastAppliedProjectionVersion(environmentId);
  if (
    currentVersion !== null &&
    compareAppliedProjectionVersion(currentVersion, nextVersion) >= 0
  ) {
    return;
  }

  lastAppliedProjectionVersionByEnvironment.set(environmentId, nextVersion);
}

function markAppliedProjectionEvent(environmentId: EnvironmentId, sequence: number): void {
  const currentVersion = readLastAppliedProjectionVersion(environmentId);
  if (currentVersion !== null && sequence <= currentVersion.sequence) {
    return;
  }

  lastAppliedProjectionVersionByEnvironment.set(environmentId, {
    sequence,
    updatedAt: currentVersion?.updatedAt ?? null,
  });
}

function getThreadDetailSubscriptionKey(environmentId: EnvironmentId, threadId: ThreadId): string {
  return scopedThreadKey(scopeThreadRef(environmentId, threadId));
}

function getThreadDetailEventBatcher(
  environmentId: EnvironmentId,
): FrameBatcher<OrchestrationEvent> {
  let batch = pendingThreadDetailEventBatches.get(environmentId);
  if (!batch) {
    batch = createFrameBatcher({
      timeoutMs: THREAD_DETAIL_EVENT_BATCH_TIMEOUT_MS,
      flush: (events) => {
        pendingThreadDetailEventBatches.delete(environmentId);
        applyRecoveredEventBatch(events, environmentId);
      },
    });
    pendingThreadDetailEventBatches.set(environmentId, batch);
  }
  return batch;
}
function enqueueThreadDetailEvent(event: OrchestrationEvent, environmentId: EnvironmentId): void {
  getThreadDetailEventBatcher(environmentId).enqueue(event);
}
function flushThreadDetailEventBatch(environmentId: EnvironmentId): void {
  const batch = pendingThreadDetailEventBatches.get(environmentId);
  if (!batch) {
    return;
  }

  batch.flush();
}
function cancelThreadDetailEventBatchForEnvironment(environmentId: EnvironmentId): void {
  const batch = pendingThreadDetailEventBatches.get(environmentId);
  if (!batch) {
    return;
  }
  batch.cancel();
  pendingThreadDetailEventBatches.delete(environmentId);
}

function cancelPendingThreadDetailEventBatches(): void {
  for (const batch of pendingThreadDetailEventBatches.values()) {
    batch.cancel();
  }
  pendingThreadDetailEventBatches.clear();
}

function getGitStatusActivityRefreshKey(environmentId: EnvironmentId, cwd: string): string {
  return `${environmentId}:${cwd}`;
}

function cancelPendingGitStatusActivityRefreshes(): void {
  for (const timeoutId of pendingGitStatusActivityRefreshes.values()) {
    clearTimeout(timeoutId);
  }
  pendingGitStatusActivityRefreshes.clear();
}

function clearThreadDetailSubscriptionEviction(
  entry: ThreadDetailSubscriptionEntry,
): ThreadDetailSubscriptionEntry {
  if (entry.evictionTimeoutId !== null) {
    clearTimeout(entry.evictionTimeoutId);
    entry.evictionTimeoutId = null;
  }
  return entry;
}

function isNonIdleThreadDetailSubscription(entry: ThreadDetailSubscriptionEntry): boolean {
  const threadRef = scopeThreadRef(entry.environmentId, entry.threadId);
  const state = useStore.getState();
  const sidebarThread = selectSidebarThreadSummaryByRef(state, threadRef);

  // Prefer shell/sidebar state first because it has the thread readiness flags
  // used by the UI: pending approvals, input, and plans.
  if (sidebarThread) {
    if (
      sidebarThread.hasPendingApprovals ||
      sidebarThread.hasPendingUserInput ||
      sidebarThread.hasActionableProposedPlan
    ) {
      return true;
    }

    if (hasActiveOrchestrationTurn(sidebarThread.latestTurn, sidebarThread.session)) {
      return true;
    }
  }

  const thread = selectThreadByRef(state, threadRef);
  if (!thread) {
    return false;
  }

  return (
    hasActiveOrchestrationTurn(thread.latestTurn, thread.session) ||
    thread.pendingSourceProposedPlan !== undefined
  );
}

function shouldEvictThreadDetailSubscription(entry: ThreadDetailSubscriptionEntry): boolean {
  return entry.refCount === 0 && !isNonIdleThreadDetailSubscription(entry);
}

function attachThreadDetailSubscription(entry: ThreadDetailSubscriptionEntry): boolean {
  if (entry.unsubscribeConnectionListener !== null) {
    entry.unsubscribeConnectionListener();
    entry.unsubscribeConnectionListener = null;
  }
  if (entry.unsubscribe !== NOOP) {
    return true;
  }

  const connection = readEnvironmentConnection(entry.environmentId);
  if (!connection) {
    return false;
  }

  entry.unsubscribe = connection.client.orchestration.subscribeThread(
    { threadId: entry.threadId },
    (item) => {
      if (item.kind === "snapshot") {
        flushThreadDetailEventBatch(entry.environmentId);
        useStore.getState().syncServerThreadDetail(item.snapshot.thread, entry.environmentId);
        return;
      }
      enqueueThreadDetailEvent(item.event, entry.environmentId);
    },
  );
  return true;
}

function watchThreadDetailSubscriptionConnection(entry: ThreadDetailSubscriptionEntry): void {
  if (entry.unsubscribeConnectionListener !== null) {
    return;
  }

  entry.unsubscribeConnectionListener = subscribeEnvironmentConnections(() => {
    if (attachThreadDetailSubscription(entry)) {
      entry.lastAccessedAt = Date.now();
    }
  });
  attachThreadDetailSubscription(entry);
}

function disposeThreadDetailSubscriptionByKey(key: string): boolean {
  const entry = threadDetailSubscriptions.get(key);
  if (!entry) {
    return false;
  }

  clearThreadDetailSubscriptionEviction(entry);
  entry.unsubscribeConnectionListener?.();
  entry.unsubscribeConnectionListener = null;
  threadDetailSubscriptions.delete(key);
  entry.unsubscribe();
  entry.unsubscribe = NOOP;
  return true;
}

function disposeThreadDetailSubscriptionsForEnvironment(environmentId: EnvironmentId): void {
  for (const [key, entry] of threadDetailSubscriptions) {
    if (entry.environmentId === environmentId) {
      disposeThreadDetailSubscriptionByKey(key);
    }
  }
}

function reconcileThreadDetailSubscriptionsForEnvironment(
  environmentId: EnvironmentId,
  threadIds: ReadonlyArray<ThreadId>,
): void {
  const activeThreadIds = new Set(threadIds);
  for (const [key, entry] of threadDetailSubscriptions) {
    if (entry.environmentId === environmentId && !activeThreadIds.has(entry.threadId)) {
      disposeThreadDetailSubscriptionByKey(key);
    }
  }
}

function scheduleThreadDetailSubscriptionEviction(entry: ThreadDetailSubscriptionEntry): void {
  clearThreadDetailSubscriptionEviction(entry);
  if (!shouldEvictThreadDetailSubscription(entry)) {
    return;
  }

  entry.evictionTimeoutId = setTimeout(() => {
    const currentEntry = threadDetailSubscriptions.get(
      getThreadDetailSubscriptionKey(entry.environmentId, entry.threadId),
    );
    if (!currentEntry) {
      return;
    }

    currentEntry.evictionTimeoutId = null;
    if (!shouldEvictThreadDetailSubscription(currentEntry)) {
      return;
    }
    disposeThreadDetailSubscriptionByKey(
      getThreadDetailSubscriptionKey(entry.environmentId, entry.threadId),
    );
  }, THREAD_DETAIL_SUBSCRIPTION_IDLE_EVICTION_MS);
}

function evictIdleThreadDetailSubscriptionsToCapacity(): void {
  if (threadDetailSubscriptions.size <= MAX_CACHED_THREAD_DETAIL_SUBSCRIPTIONS) {
    return;
  }

  const idleEntries = [...threadDetailSubscriptions.entries()]
    .filter(([, entry]) => shouldEvictThreadDetailSubscription(entry))
    .toSorted(([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt);

  for (const [key] of idleEntries) {
    if (threadDetailSubscriptions.size <= MAX_CACHED_THREAD_DETAIL_SUBSCRIPTIONS) {
      return;
    }
    disposeThreadDetailSubscriptionByKey(key);
  }
}

function reconcileThreadDetailSubscriptionEvictionState(
  entry: ThreadDetailSubscriptionEntry,
): void {
  clearThreadDetailSubscriptionEviction(entry);
  if (!shouldEvictThreadDetailSubscription(entry)) {
    return;
  }

  scheduleThreadDetailSubscriptionEviction(entry);
}

function reconcileThreadDetailSubscriptionEvictionForThread(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): void {
  const entry = threadDetailSubscriptions.get(
    getThreadDetailSubscriptionKey(environmentId, threadId),
  );
  if (!entry) {
    return;
  }

  reconcileThreadDetailSubscriptionEvictionState(entry);
}

function reconcileThreadDetailSubscriptionEvictionForEnvironment(
  environmentId: EnvironmentId,
): void {
  for (const entry of threadDetailSubscriptions.values()) {
    if (entry.environmentId === environmentId) {
      reconcileThreadDetailSubscriptionEvictionState(entry);
    }
  }
  evictIdleThreadDetailSubscriptionsToCapacity();
}

export function retainThreadDetailSubscription(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): () => void {
  const key = getThreadDetailSubscriptionKey(environmentId, threadId);
  const existing = threadDetailSubscriptions.get(key);
  if (existing) {
    clearThreadDetailSubscriptionEviction(existing);
    existing.refCount += 1;
    existing.lastAccessedAt = Date.now();
    if (!attachThreadDetailSubscription(existing)) {
      watchThreadDetailSubscriptionConnection(existing);
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      existing.refCount = Math.max(0, existing.refCount - 1);
      existing.lastAccessedAt = Date.now();
      if (existing.refCount === 0) {
        reconcileThreadDetailSubscriptionEvictionState(existing);
        evictIdleThreadDetailSubscriptionsToCapacity();
      }
    };
  }

  const entry: ThreadDetailSubscriptionEntry = {
    environmentId,
    threadId,
    unsubscribe: NOOP,
    unsubscribeConnectionListener: null,
    refCount: 1,
    lastAccessedAt: Date.now(),
    evictionTimeoutId: null,
  };
  threadDetailSubscriptions.set(key, entry);
  if (!attachThreadDetailSubscription(entry)) {
    watchThreadDetailSubscriptionConnection(entry);
  }
  evictIdleThreadDetailSubscriptionsToCapacity();

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    entry.refCount = Math.max(0, entry.refCount - 1);
    entry.lastAccessedAt = Date.now();
    if (entry.refCount === 0) {
      reconcileThreadDetailSubscriptionEvictionState(entry);
      evictIdleThreadDetailSubscriptionsToCapacity();
    }
  };
}

function emitEnvironmentConnectionRegistryChange() {
  for (const listener of environmentConnectionListeners) {
    listener();
  }
}

function syncProjectUiFromStore() {
  const projects = selectProjectsAcrossEnvironments(useStore.getState());
  useUiStateStore.getState().syncProjects(
    projects.map((project) => ({
      key: getProjectOrderKey(project),
      logicalKey: deriveSidebarProjectStateKey(project),
      cwd: project.cwd,
    })),
  );
}

function syncThreadUiFromStore() {
  const threads = selectThreadsAcrossEnvironments(useStore.getState());
  useUiStateStore.getState().syncThreads(
    threads.map((thread) => ({
      key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      seedVisitedAt: thread.updatedAt ?? thread.createdAt,
    })),
  );
  markPromotedDraftThreadsByRef(
    threads.map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
  );
}

function reconcileSnapshotDerivedState() {
  syncProjectUiFromStore();
  syncThreadUiFromStore();
}

function refreshGitStatusForThreadActivityEffects(
  environmentId: EnvironmentId,
  threadIds: readonly ThreadId[],
): void {
  const refreshedCwds = new Set<string>();

  for (const threadId of threadIds) {
    const state = useStore.getState();
    const thread = selectThreadByRef(state, scopeThreadRef(environmentId, threadId));
    if (thread?.projectId == null) {
      continue;
    }

    const project = findWorkspaceProjectForSource(selectProjectsAcrossEnvironments(state), thread);
    const cwd = thread.worktreePath ?? project?.cwd ?? null;
    if (cwd === null || refreshedCwds.has(cwd)) {
      continue;
    }

    refreshedCwds.add(cwd);
    const rpcEnvironmentId = project?.environmentId ?? environmentId;
    const queryClient = activeService?.queryClient ?? null;
    scheduleGitStatusActivityRefresh(rpcEnvironmentId, cwd, queryClient);
  }
}

function scheduleGitStatusActivityRefresh(
  environmentId: EnvironmentId,
  cwd: string,
  queryClient: QueryClient | null,
): void {
  const key = getGitStatusActivityRefreshKey(environmentId, cwd);
  const existing = pendingGitStatusActivityRefreshes.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  const timeoutId = setTimeout(() => {
    const pending = pendingGitStatusActivityRefreshes.get(key);
    if (pending !== timeoutId) {
      return;
    }
    pendingGitStatusActivityRefreshes.delete(key);

    void (async () => {
      try {
        await refreshGitStatus({ environmentId, cwd }, undefined, {
          force: true,
          scope: "local",
        });
      } finally {
        // The service can restart while the git refresh is in flight, so use
        // the QueryClient from the event that scheduled the refresh. Status
        // rows and patch queries must move together; stale patch data can ask
        // Git for a path that no longer has a diff.
        if (queryClient) {
          await invalidateGitPatchQueries(queryClient, { environmentId, cwd });
        }
      }
    })().catch(() => undefined);
  }, GIT_STATUS_ACTIVITY_REFRESH_DEBOUNCE_MS);

  pendingGitStatusActivityRefreshes.set(key, timeoutId);
}

function applyRecoveredEventBatch(
  events: ReadonlyArray<OrchestrationEvent>,
  environmentId: EnvironmentId,
) {
  if (events.length === 0) {
    return;
  }

  const batchEffects = deriveOrchestrationBatchEffects(events);
  const uiEvents = coalesceOrchestrationUiEvents(events);
  const needsProjectUiSync = events.some(
    (event) =>
      event.type === "project.created" ||
      event.type === "project.meta-updated" ||
      event.type === "project.deleted",
  );

  useStore.getState().applyOrchestrationEvents(uiEvents, environmentId);
  refreshGitStatusForThreadActivityEffects(environmentId, batchEffects.gitRefreshThreadIds);
  if (needsProjectUiSync) {
    syncProjectUiFromStore();
  }

  const needsThreadUiSync = events.some(
    (event) => event.type === "thread.created" || event.type === "thread.deleted",
  );
  if (needsThreadUiSync) {
    syncThreadUiFromStore();
  }

  const draftStore = useComposerDraftStore.getState();
  for (const threadId of batchEffects.promoteDraftThreadIds) {
    markPromotedDraftThreadByRef(scopeThreadRef(environmentId, threadId));
  }
  for (const threadId of batchEffects.clearDeletedThreadIds) {
    draftStore.clearDraftThread(scopeThreadRef(environmentId, threadId));
    useUiStateStore
      .getState()
      .clearThreadUi(scopedThreadKey(scopeThreadRef(environmentId, threadId)));
  }
  reconcileThreadDetailSubscriptionEvictionForEnvironment(environmentId);
}

export function applyEnvironmentThreadDetailEvent(
  event: OrchestrationEvent,
  environmentId: EnvironmentId,
) {
  applyRecoveredEventBatch([event], environmentId);
}

async function replayProjectionGap(input: {
  readonly environmentId: EnvironmentId;
  readonly targetSequence: number;
}): Promise<void> {
  const connection = readEnvironmentConnection(input.environmentId);
  if (!connection) {
    return;
  }

  for (;;) {
    const current = readLastAppliedProjectionVersion(input.environmentId);
    if (current === null || current.sequence >= input.targetSequence - 1) {
      return;
    }

    const replay = await connection.client.orchestration.replayEvents({
      fromSequenceExclusive: current.sequence,
      limit: ORCHESTRATION_REPLAY_EVENTS_DEFAULT_LIMIT,
    });
    if (replay.events.length === 0 || replay.nextSequence <= current.sequence) {
      return;
    }

    applyRecoveredEventBatch(replay.events, input.environmentId);
    markAppliedProjectionEvent(input.environmentId, replay.nextSequence);

    if (replay.upToDate || replay.nextSequence >= input.targetSequence - 1) {
      return;
    }
  }
}

function queueShellGapRepair(event: OrchestrationShellStreamEvent, environmentId: EnvironmentId) {
  const previous = pendingShellGapRepairByEnvironment.get(environmentId) ?? Promise.resolve();
  const repair = previous
    .catch(() => undefined)
    .then(async () => {
      await replayProjectionGap({
        environmentId,
        targetSequence: event.sequence,
      });
      applyShellEventDirect(event, environmentId);
    });

  const queued = repair.finally(() => {
    if (pendingShellGapRepairByEnvironment.get(environmentId) === queued) {
      pendingShellGapRepairByEnvironment.delete(environmentId);
    }
  });
  pendingShellGapRepairByEnvironment.set(environmentId, queued);
}

function shouldRepairProjectionGap(
  event: OrchestrationShellStreamEvent,
  environmentId: EnvironmentId,
) {
  const current = readLastAppliedProjectionVersion(environmentId);
  return current !== null && event.sequence > current.sequence + 1;
}

function applyShellEventDirect(event: OrchestrationShellStreamEvent, environmentId: EnvironmentId) {
  if (
    !shouldApplyProjectionEvent({
      current: readLastAppliedProjectionVersion(environmentId),
      sequence: event.sequence,
    })
  ) {
    return;
  }

  const threadId =
    event.kind === "thread-upserted"
      ? event.thread.id
      : event.kind === "thread-removed"
        ? event.threadId
        : null;
  const threadRef = threadId ? scopeThreadRef(environmentId, threadId) : null;
  const previousThread = threadRef ? selectThreadByRef(useStore.getState(), threadRef) : undefined;

  useStore.getState().applyShellEvent(event, environmentId);
  markAppliedProjectionEvent(environmentId, event.sequence);
  rememberLiveShellEvent(environmentId, event);

  switch (event.kind) {
    case "project-upserted":
    case "project-removed":
      syncProjectUiFromStore();
      return;
    case "thread-upserted":
      syncThreadUiFromStore();
      if (!previousThread && threadRef) {
        markPromotedDraftThreadByRef(threadRef);
      }
      reconcileThreadDetailSubscriptionEvictionForThread(environmentId, event.thread.id);
      evictIdleThreadDetailSubscriptionsToCapacity();
      return;
    case "thread-removed":
      if (threadRef) {
        disposeThreadDetailSubscriptionByKey(scopedThreadKey(threadRef));
        useComposerDraftStore.getState().clearDraftThread(threadRef);
        useUiStateStore.getState().clearThreadUi(scopedThreadKey(threadRef));
      }
      syncThreadUiFromStore();
      return;
  }
}

function applyShellEvent(event: OrchestrationShellStreamEvent, environmentId: EnvironmentId) {
  if (shouldRepairProjectionGap(event, environmentId)) {
    queueShellGapRepair(event, environmentId);
    return;
  }

  const pendingRepair = pendingShellGapRepairByEnvironment.get(environmentId);
  if (pendingRepair) {
    const queued = pendingRepair
      .catch(() => undefined)
      .then(() => {
        applyShellEvent(event, environmentId);
      })
      .finally(() => {
        if (pendingShellGapRepairByEnvironment.get(environmentId) === queued) {
          pendingShellGapRepairByEnvironment.delete(environmentId);
        }
      });
    pendingShellGapRepairByEnvironment.set(environmentId, queued);
    return;
  }

  applyShellEventDirect(event, environmentId);
}

function createEnvironmentConnectionHandlers() {
  return {
    applyShellEvent,
    syncShellSnapshot: (snapshot: OrchestrationShellSnapshot, environmentId: EnvironmentId) => {
      if (
        !shouldApplyProjectionSnapshot({
          current: readLastAppliedProjectionVersion(environmentId),
          next: snapshot,
        })
      ) {
        return;
      }

      useStore.getState().syncServerShellSnapshot(snapshot, environmentId);
      rememberLiveShellSnapshot(environmentId, snapshot);
      markAppliedProjectionSnapshot(environmentId, snapshot);
      pendingShellGapRepairByEnvironment.delete(environmentId);
      reconcileThreadDetailSubscriptionsForEnvironment(
        environmentId,
        snapshot.threads.map((thread) => thread.id),
      );
      reconcileThreadDetailSubscriptionEvictionForEnvironment(environmentId);
      reconcileSnapshotDerivedState();
    },
  };
}

function hydrateCachedShellSnapshot(environmentId: EnvironmentId): void {
  const snapshot = readCachedShellSnapshot(environmentId);
  if (!snapshot) {
    return;
  }

  useStore.getState().syncCachedShellSnapshot(snapshot, environmentId);
  syncProjectUiFromStore();
  syncThreadUiFromStore();
}

function createPrimaryEnvironmentClient(
  knownEnvironment: ReturnType<typeof getPrimaryKnownEnvironment>,
) {
  const wsBaseUrl = getKnownEnvironmentWsBaseUrl(knownEnvironment);
  if (!wsBaseUrl) {
    throw new Error(
      `Unable to resolve websocket URL for ${knownEnvironment?.label ?? "primary environment"}.`,
    );
  }

  const resolveAuthenticatedWsBaseUrl = async () => {
    const url = new URL(wsBaseUrl);
    const bearerToken = await resolveAuthenticatedServerBearerToken();
    if (!bearerToken) {
      throw new Error("Unable to resolve an authenticated server bearer token.");
    }
    url.searchParams.set("access_token", bearerToken);
    return url.toString();
  };

  return createWsRpcClient(new WsTransport(resolveAuthenticatedWsBaseUrl));
}

function registerConnection(connection: EnvironmentConnection): EnvironmentConnection {
  const existing = environmentConnections.get(connection.environmentId);
  if (existing && existing !== connection) {
    throw new Error(`Environment ${connection.environmentId} already has an active connection.`);
  }
  environmentConnections.set(connection.environmentId, connection);
  emitEnvironmentConnectionRegistryChange();
  return connection;
}

async function removeConnection(environmentId: EnvironmentId): Promise<boolean> {
  const connection = environmentConnections.get(environmentId);
  if (!connection) {
    return false;
  }

  cancelThreadDetailEventBatchForEnvironment(environmentId);
  disposeThreadDetailSubscriptionsForEnvironment(environmentId);
  lastAppliedProjectionVersionByEnvironment.delete(environmentId);
  forgetLiveShellSnapshot(environmentId);
  environmentConnections.delete(environmentId);
  emitEnvironmentConnectionRegistryChange();
  await connection.dispose();
  return true;
}

function createPrimaryEnvironmentConnection(): EnvironmentConnection {
  const knownEnvironment = getPrimaryKnownEnvironment();
  if (!knownEnvironment?.environmentId) {
    throw new Error("Unable to resolve the primary environment.");
  }

  const existing = environmentConnections.get(knownEnvironment.environmentId);
  if (existing) {
    return existing;
  }

  return registerConnection(
    createEnvironmentConnection({
      knownEnvironment,
      client: createPrimaryEnvironmentClient(knownEnvironment),
      onConfigSnapshot: setServerConfigSnapshot,
      onWelcome: emitWelcome,
      ...createEnvironmentConnectionHandlers(),
    }),
  );
}

function stopActiveService() {
  activeService?.stop();
  activeService = null;
  pendingShellGapRepairByEnvironment.clear();
  cancelPendingGitStatusActivityRefreshes();
}

export function subscribeEnvironmentConnections(listener: () => void): () => void {
  environmentConnectionListeners.add(listener);
  return () => {
    environmentConnectionListeners.delete(listener);
  };
}

export function listEnvironmentConnections(): ReadonlyArray<EnvironmentConnection> {
  return [...environmentConnections.values()];
}

export function readEnvironmentConnection(
  environmentId: EnvironmentId,
): EnvironmentConnection | null {
  return environmentConnections.get(environmentId) ?? null;
}

export function requireEnvironmentConnection(environmentId: EnvironmentId): EnvironmentConnection {
  const connection = readEnvironmentConnection(environmentId);
  if (!connection) {
    throw new Error(`No websocket client registered for environment ${environmentId}.`);
  }
  return connection;
}

export function getPrimaryEnvironmentConnection(): EnvironmentConnection {
  return createPrimaryEnvironmentConnection();
}

export function getPrimaryEnvironmentWsRpcClient(): WsRpcClient {
  return getPrimaryEnvironmentConnection().client;
}

export function getEnvironmentWsRpcClient(
  environmentId: EnvironmentId | null | undefined,
): WsRpcClient {
  if (!environmentId) {
    return getPrimaryEnvironmentWsRpcClient();
  }

  const connection = readEnvironmentConnection(environmentId);
  if (!connection) {
    throw new Error(`Environment API not found for environment ${environmentId}`);
  }

  return connection.client;
}

export async function ensureEnvironmentConnectionBootstrapped(
  environmentId: EnvironmentId,
): Promise<void> {
  await environmentConnections.get(environmentId)?.ensureBootstrapped();
}

export function startEnvironmentConnectionService(queryClient: QueryClient): () => void {
  if (activeService?.queryClient === queryClient) {
    activeService.refCount += 1;
    return () => {
      if (!activeService || activeService.queryClient !== queryClient) {
        return;
      }
      activeService.refCount -= 1;
      if (activeService.refCount === 0) {
        stopActiveService();
      }
    };
  }

  stopActiveService();

  const connection = createPrimaryEnvironmentConnection();
  hydrateCachedShellSnapshot(connection.environmentId);

  activeService = {
    queryClient,
    refCount: 1,
    stop: NOOP,
  };

  return () => {
    if (!activeService || activeService.queryClient !== queryClient) {
      return;
    }
    activeService.refCount -= 1;
    if (activeService.refCount === 0) {
      stopActiveService();
    }
  };
}

export async function resetEnvironmentServiceForTests(): Promise<void> {
  stopActiveService();
  cancelPendingThreadDetailEventBatches();
  lastAppliedProjectionVersionByEnvironment.clear();
  for (const key of Array.from(threadDetailSubscriptions.keys())) {
    disposeThreadDetailSubscriptionByKey(key);
  }
  await Promise.all(
    [...environmentConnections.keys()].map((environmentId) => removeConnection(environmentId)),
  );
}
