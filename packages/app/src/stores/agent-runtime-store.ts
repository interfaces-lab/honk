import {
  type AgentRuntimeEvent,
  type DesktopExtensionUiRequest,
  type EnvironmentId,
  EnvironmentId as EnvironmentIdSchema,
  type HonkRuntimeHostEvent,
  type HonkRuntimeHostSnapshot,
  migrateLegacyRuntimeHostEventInput,
  migrateLegacyRuntimeHostSnapshotInput,
  type RuntimeDisplayTimelineItem,
  type RuntimeDisplayTimelineProjection,
  type RuntimeThreadIdentity,
  type SessionTreeProjection,
  type ThreadId,
  type TurnId,
} from "@honk/contracts";
import { create } from "zustand";

import { DESKTOP_RUNTIME_ENVIRONMENT_ID } from "../lib/environment-scope";
import { createEmptyRuntimeHostSnapshot, readHonkRuntimeApi } from "../lib/honk-runtime-api";
import { resetRuntimeThreadHydrationCache } from "../lib/runtime-turn-dispatch";
import { runtimeParentToolDisplaySignature } from "../lib/runtime-tool-display";
import { useComposerDraftStore } from "./chat-drafts";
import { useStore, type EnvironmentState } from "./thread-store";

interface AgentRuntimeState {
  readonly snapshot: HonkRuntimeHostSnapshot;
  readonly localRuntimeThreadIds: ReadonlySet<ThreadId>;
  readonly setSnapshot: (snapshot: HonkRuntimeHostSnapshot) => void;
  readonly applyHostEvent: (event: HonkRuntimeHostEvent) => void;
  readonly markLocalRuntimeThread: (threadId: ThreadId) => void;
  readonly clearLocalRuntimeThread: (threadId: ThreadId) => void;
}

const MAX_RETAINED_RUNTIME_EVENTS = 500;
const EMPTY_PENDING_EXTENSION_UI_REQUESTS: readonly DesktopExtensionUiRequest[] = [];
let lastPendingExtensionUiRequestsSource: ReadonlyArray<DesktopExtensionUiRequest> | null = null;
let lastPendingExtensionUiRequestsThreadId: ThreadId | null | undefined;
let lastPendingExtensionUiRequestsResult: readonly DesktopExtensionUiRequest[] =
  EMPTY_PENDING_EXTENSION_UI_REQUESTS;

export type RuntimeAgentRunLifecycle = "active" | "terminal" | null;

export interface RuntimeAgentRunEventState {
  readonly lifecycle: RuntimeAgentRunLifecycle;
  readonly latestTurnId: TurnId | null;
}

function resolveRuntimeThreadEnvironmentId(threadId: ThreadId): EnvironmentId {
  const store = useStore.getState();
  for (const [environmentId, environmentState] of Object.entries(store.environmentStateById)) {
    if (environmentState.threadShellById[threadId]) {
      return EnvironmentIdSchema.make(environmentId);
    }
  }

  const draftStore = useComposerDraftStore.getState();
  for (const draftThread of Object.values(draftStore.draftThreadsByThreadKey)) {
    if (draftThread.threadId === threadId) {
      return draftThread.environmentId;
    }
  }

  return DESKTOP_RUNTIME_ENVIRONMENT_ID;
}

function applyRuntimeSessionTreeToThreadStore(
  tree: HonkRuntimeHostSnapshot["sessionTrees"][number],
): void {
  const store = useStore.getState();
  const environmentId = resolveRuntimeThreadEnvironmentId(tree.threadId);
  store.applyRuntimeSessionTreeProjection(tree, environmentId);
}

function applyRuntimeEventToThreadStore(
  event: HonkRuntimeHostSnapshot["runtimeEvents"][number],
): void {
  const store = useStore.getState();
  const environmentId = resolveRuntimeThreadEnvironmentId(event.threadId);
  store.applyAgentRuntimeEvent(event, environmentId);
}

function hasPendingExtensionUiActivity(
  activitiesByThreadId: EnvironmentState["activityByThreadId"],
): boolean {
  return Object.values(activitiesByThreadId).some((activitiesById) =>
    Object.values(activitiesById).some((activity) => activity.kind === "extension-ui.requested"),
  );
}

function syncPendingExtensionUiRequestsToThreadStore(
  requests: ReadonlyArray<DesktopExtensionUiRequest>,
): void {
  const store = useStore.getState();
  const requestsByEnvironmentId = new Map<EnvironmentId, DesktopExtensionUiRequest[]>();
  for (const request of requests) {
    const environmentId = resolveRuntimeThreadEnvironmentId(request.threadId);
    requestsByEnvironmentId.set(environmentId, [
      ...(requestsByEnvironmentId.get(environmentId) ?? []),
      request,
    ]);
  }
  for (const [environmentId, environmentState] of Object.entries(store.environmentStateById)) {
    if (hasPendingExtensionUiActivity(environmentState.activityByThreadId)) {
      const key = EnvironmentIdSchema.make(environmentId);
      requestsByEnvironmentId.set(key, requestsByEnvironmentId.get(key) ?? []);
    }
  }
  for (const [environmentId, environmentRequests] of requestsByEnvironmentId) {
    store.syncPendingExtensionUiRequests(environmentRequests, environmentId);
  }
}

function runtimeThreadIds(snapshot: HonkRuntimeHostSnapshot): Set<ThreadId> {
  const threadIds = new Set<ThreadId>();
  for (const tree of snapshot.sessionTrees) {
    threadIds.add(tree.threadId);
  }
  for (const timeline of snapshot.displayTimelines) {
    threadIds.add(timeline.threadId);
  }
  for (const event of snapshot.runtimeEvents) {
    threadIds.add(event.threadId);
  }
  for (const request of snapshot.pendingExtensionUiRequests) {
    threadIds.add(request.threadId);
  }
  for (const identity of snapshot.runtimeIdentities) {
    threadIds.add(identity.threadId);
  }
  return threadIds;
}

export function runtimeAgentRunEventState(
  events: ReadonlyArray<AgentRuntimeEvent>,
  threadId: ThreadId | null | undefined,
): RuntimeAgentRunEventState {
  if (!threadId) {
    return { lifecycle: null, latestTurnId: null };
  }

  let lifecycle: RuntimeAgentRunLifecycle = null;
  let latestTurnId: TurnId | null = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.threadId !== threadId) {
      continue;
    }
    if (latestTurnId === null && event.turnId) {
      latestTurnId = event.turnId;
    }
    if (lifecycle !== null) {
      if (latestTurnId !== null) {
        break;
      }
      continue;
    }
    switch (event.type) {
      case "agent.started":
        lifecycle = "active";
        break;
      case "agent.completed":
      case "turn.interrupted":
      case "runtime.error":
        lifecycle = "terminal";
        break;
    }
  }
  return { lifecycle, latestTurnId };
}

export function runtimeEventsIndicateActiveAgentRun(
  events: ReadonlyArray<AgentRuntimeEvent>,
  threadId: ThreadId | null | undefined,
): boolean {
  return runtimeAgentRunEventState(events, threadId).lifecycle === "active";
}

export function runtimeEventsIndicateTerminalAgentRun(
  events: ReadonlyArray<AgentRuntimeEvent>,
  threadId: ThreadId | null | undefined,
): boolean {
  return runtimeAgentRunEventState(events, threadId).lifecycle === "terminal";
}

export function latestRuntimeEventTurnId(
  events: ReadonlyArray<AgentRuntimeEvent>,
  threadId: ThreadId | null | undefined,
): TurnId | null {
  return runtimeAgentRunEventState(events, threadId).latestTurnId;
}

function hostOwnedRuntimeThreadIds(snapshot: HonkRuntimeHostSnapshot): Set<ThreadId> {
  const threadIds = new Set<ThreadId>();
  for (const tree of snapshot.sessionTrees) {
    threadIds.add(tree.threadId);
  }
  for (const timeline of snapshot.displayTimelines) {
    threadIds.add(timeline.threadId);
  }
  for (const request of snapshot.pendingExtensionUiRequests) {
    threadIds.add(request.threadId);
  }
  for (const identity of snapshot.runtimeIdentities) {
    threadIds.add(identity.threadId);
  }
  return threadIds;
}

function hostOwnedRuntimeThreadIdsForEvent(event: HonkRuntimeHostEvent): Set<ThreadId> {
  switch (event.type) {
    case "snapshot":
      return hostOwnedRuntimeThreadIds(event.snapshot);
    case "session-tree":
      return new Set([event.tree.threadId]);
    case "display-timeline":
      return new Set([event.timeline.threadId]);
    case "pending-extension-ui":
      return new Set(event.requests.map((request) => request.threadId));
    case "runtime-identities":
      return new Set(event.identities.map((identity) => identity.threadId));
    case "runtime-event":
    case "credential-auth-flows":
      return new Set();
  }
}

function clearAcknowledgedLocalRuntimeThreadIds(
  threadIds: ReadonlySet<ThreadId>,
  acknowledgedThreadIds: ReadonlySet<ThreadId>,
): ReadonlySet<ThreadId> {
  if (threadIds.size === 0 || acknowledgedThreadIds.size === 0) {
    return threadIds;
  }
  let changed = false;
  const nextThreadIds = new Set<ThreadId>();
  for (const threadId of threadIds) {
    if (acknowledgedThreadIds.has(threadId)) {
      changed = true;
      continue;
    }
    nextThreadIds.add(threadId);
  }
  return changed ? nextThreadIds : threadIds;
}

function clearStaleRuntimeThreadsFromThreadStore(
  snapshot: HonkRuntimeHostSnapshot,
  previousSnapshot: HonkRuntimeHostSnapshot,
): void {
  const activeThreadIds = runtimeThreadIds(snapshot);
  for (const threadId of runtimeThreadIds(previousSnapshot)) {
    if (!activeThreadIds.has(threadId)) {
      const environmentId = resolveRuntimeThreadEnvironmentId(threadId);
      useStore.getState().clearAgentRuntimeThreadSession(threadId, environmentId);
    }
  }
}

function syncRuntimeSnapshotToThreadStore(
  snapshot: HonkRuntimeHostSnapshot,
  previousSnapshot: HonkRuntimeHostSnapshot,
): void {
  clearStaleRuntimeThreadsFromThreadStore(snapshot, previousSnapshot);
  for (const tree of snapshot.sessionTrees) {
    applyRuntimeSessionTreeToThreadStore(tree);
  }
  for (const event of snapshot.runtimeEvents) {
    applyRuntimeEventToThreadStore(event);
  }
  syncPendingExtensionUiRequestsToThreadStore(snapshot.pendingExtensionUiRequests);
}

function applyRuntimeHostEventToThreadStore(
  event: HonkRuntimeHostEvent,
  previousSnapshot: HonkRuntimeHostSnapshot,
): void {
  if (event.type === "snapshot") {
    syncRuntimeSnapshotToThreadStore(
      normalizeRuntimeHostSnapshot(event.snapshot, previousSnapshot),
      previousSnapshot,
    );
    return;
  }
  if (event.type === "runtime-event") {
    applyRuntimeEventToThreadStore(event.event);
    return;
  }
  if (event.type === "session-tree") {
    applyRuntimeSessionTreeToThreadStore(event.tree);
    return;
  }
  if (event.type === "pending-extension-ui") {
    syncPendingExtensionUiRequestsToThreadStore(event.requests);
    return;
  }
}

function reduceHostEvent(
  snapshot: HonkRuntimeHostSnapshot,
  event: HonkRuntimeHostEvent,
): HonkRuntimeHostSnapshot {
  switch (event.type) {
    case "snapshot":
      return normalizeRuntimeHostSnapshot(event.snapshot, snapshot);
    case "runtime-event":
      return snapshot;
    case "runtime-identities":
      return {
        ...snapshot,
        runtimeIdentities: [...event.identities],
        authStatuses: [...event.authStatuses],
      };
    case "session-tree":
      return {
        ...snapshot,
        sessionTrees: [
          ...snapshot.sessionTrees.filter((tree) => tree.threadId !== event.tree.threadId),
          event.tree,
        ],
      };
    case "display-timeline":
      return upsertDisplayTimeline(snapshot, event.timeline);
    case "pending-extension-ui":
      return upsertPendingExtensionUiRequests(snapshot, event.requests);
    case "credential-auth-flows":
      return {
        ...snapshot,
        credentialAuthFlows: [...event.flows],
      };
  }
}

function retainRecentRuntimeEvents(
  events: ReadonlyArray<HonkRuntimeHostSnapshot["runtimeEvents"][number]>,
): HonkRuntimeHostSnapshot["runtimeEvents"] {
  return events.length <= MAX_RETAINED_RUNTIME_EVENTS
    ? [...events]
    : events.slice(events.length - MAX_RETAINED_RUNTIME_EVENTS);
}

function upsertPendingExtensionUiRequests(
  snapshot: HonkRuntimeHostSnapshot,
  requests: ReadonlyArray<DesktopExtensionUiRequest>,
): HonkRuntimeHostSnapshot {
  if (arePendingExtensionUiRequestsEqual(snapshot.pendingExtensionUiRequests, requests)) {
    return snapshot;
  }
  return {
    ...snapshot,
    pendingExtensionUiRequests: [...requests],
  };
}

function arePendingExtensionUiRequestsEqual(
  left: ReadonlyArray<DesktopExtensionUiRequest>,
  right: ReadonlyArray<DesktopExtensionUiRequest>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftRequest = left[index];
    const rightRequest = right[index];
    if (
      !leftRequest ||
      !rightRequest ||
      !arePendingExtensionUiRequestsEqualAtIndex(leftRequest, rightRequest)
    ) {
      return false;
    }
  }
  return true;
}

function arePendingExtensionUiRequestsEqualAtIndex(
  left: DesktopExtensionUiRequest,
  right: DesktopExtensionUiRequest,
): boolean {
  return (
    left.id === right.id &&
    left.threadId === right.threadId &&
    left.runtimeSessionId === right.runtimeSessionId &&
    left.kind === right.kind &&
    left.title === right.title &&
    left.message === right.message &&
    left.placeholder === right.placeholder &&
    left.timeout === right.timeout &&
    left.createdAt === right.createdAt &&
    areSameStrings(left.options ?? [], right.options ?? [])
  );
}

function areSameStrings(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function upsertDisplayTimeline(
  snapshot: HonkRuntimeHostSnapshot,
  timeline: RuntimeDisplayTimelineProjection,
): HonkRuntimeHostSnapshot {
  const existingTimeline = snapshot.displayTimelines.find(
    (candidate) => candidate.threadId === timeline.threadId,
  );
  if (existingTimeline && areDisplayTimelinesVisiblyEqual(existingTimeline, timeline)) {
    return snapshot;
  }
  return {
    ...snapshot,
    displayTimelines: [
      ...snapshot.displayTimelines.filter((candidate) => candidate.threadId !== timeline.threadId),
      timeline,
    ],
  };
}

function areDisplayTimelinesVisiblyEqual(
  left: RuntimeDisplayTimelineProjection,
  right: RuntimeDisplayTimelineProjection,
): boolean {
  if (
    left.threadId !== right.threadId ||
    left.runtimeSessionId !== right.runtimeSessionId ||
    left.items.length !== right.items.length
  ) {
    return false;
  }
  for (let index = 0; index < left.items.length; index += 1) {
    const leftItem = left.items[index];
    const rightItem = right.items[index];
    if (!leftItem || !rightItem || !areDisplayTimelineItemsVisiblyEqual(leftItem, rightItem)) {
      return false;
    }
  }
  return true;
}

function areDisplayTimelineItemsVisiblyEqual(
  left: RuntimeDisplayTimelineItem,
  right: RuntimeDisplayTimelineItem,
): boolean {
  if (
    left.kind !== right.kind ||
    left.id !== right.id ||
    left.orderKey !== right.orderKey ||
    left.createdAt !== right.createdAt
  ) {
    return false;
  }

  switch (left.kind) {
    case "message": {
      if (right.kind !== "message") return false;
      return (
        left.source === right.source &&
        left.entryId === right.entryId &&
        left.threadEntryId === right.threadEntryId &&
        left.parentEntryId === right.parentEntryId &&
        left.parentThreadEntryId === right.parentThreadEntryId &&
        left.role === right.role &&
        left.turnId === right.turnId &&
        left.clientMessageId === right.clientMessageId &&
        left.streaming === right.streaming &&
        left.text === right.text &&
        left.thinking === right.thinking
      );
    }
    case "tool": {
      if (right.kind !== "tool") return false;
      return (
        left.toolCallId === right.toolCallId &&
        left.toolName === right.toolName &&
        left.turnId === right.turnId &&
        left.status === right.status &&
        left.argsComplete === right.argsComplete &&
        left.executionStarted === right.executionStarted &&
        left.isPartial === right.isPartial &&
        left.isError === right.isError &&
        left.summary === right.summary &&
        areRuntimeToolVisibleDetailsEqual(left, right)
      );
    }
    case "extension-ui-request": {
      if (right.kind !== "extension-ui-request") return false;
      return (
        left.requestId === right.requestId &&
        left.requestKind === right.requestKind &&
        left.status === right.status &&
        left.threadId === right.threadId &&
        left.runtimeSessionId === right.runtimeSessionId &&
        left.title === right.title &&
        left.message === right.message &&
        left.placeholder === right.placeholder &&
        left.turnId === right.turnId
      );
    }
    case "proposed-plan": {
      if (right.kind !== "proposed-plan") return false;
      return (
        left.planId === right.planId &&
        left.turnId === right.turnId &&
        left.planMarkdown === right.planMarkdown &&
        left.summary === right.summary
      );
    }
  }
}

function areRuntimeToolVisibleDetailsEqual(
  left: Extract<RuntimeDisplayTimelineItem, { kind: "tool" }>,
  right: Extract<RuntimeDisplayTimelineItem, { kind: "tool" }>,
): boolean {
  return (
    runtimeParentToolDisplaySignature(left.display) ===
    runtimeParentToolDisplaySignature(right.display)
  );
}

function normalizeRuntimeHostSnapshot(
  snapshot: HonkRuntimeHostSnapshot,
  previousSnapshot?: HonkRuntimeHostSnapshot | undefined,
): HonkRuntimeHostSnapshot {
  return {
    ...snapshot,
    runtimeEvents: retainRecentRuntimeEvents(snapshot.runtimeEvents),
    displayTimelines: previousSnapshot
      ? preserveDisplayTimelineIdentities(
          snapshot.displayTimelines,
          previousSnapshot.displayTimelines,
        )
      : snapshot.displayTimelines,
    pendingExtensionUiRequests:
      previousSnapshot &&
      arePendingExtensionUiRequestsEqual(
        previousSnapshot.pendingExtensionUiRequests,
        snapshot.pendingExtensionUiRequests,
      )
        ? previousSnapshot.pendingExtensionUiRequests
        : [...snapshot.pendingExtensionUiRequests],
  };
}

function preserveDisplayTimelineIdentities(
  timelines: ReadonlyArray<RuntimeDisplayTimelineProjection>,
  previousTimelines: ReadonlyArray<RuntimeDisplayTimelineProjection>,
): RuntimeDisplayTimelineProjection[] {
  return timelines.map((timeline) => {
    const previousTimeline = previousTimelines.find(
      (candidate) => candidate.threadId === timeline.threadId,
    );
    return previousTimeline && areDisplayTimelinesVisiblyEqual(previousTimeline, timeline)
      ? previousTimeline
      : timeline;
  });
}

export const useAgentRuntimeStore = create<AgentRuntimeState>()((set) => ({
  snapshot: createEmptyRuntimeHostSnapshot(),
  localRuntimeThreadIds: new Set(),
  setSnapshot: (snapshot) => {
    const migratedSnapshot = migrateLegacyRuntimeHostSnapshotInput(
      snapshot,
    ) as HonkRuntimeHostSnapshot;
    set((state) => {
      const normalizedSnapshot = normalizeRuntimeHostSnapshot(migratedSnapshot, state.snapshot);
      syncRuntimeSnapshotToThreadStore(normalizedSnapshot, state.snapshot);
      const localRuntimeThreadIds = clearAcknowledgedLocalRuntimeThreadIds(
        state.localRuntimeThreadIds,
        hostOwnedRuntimeThreadIds(normalizedSnapshot),
      );
      return {
        snapshot: normalizedSnapshot,
        ...(localRuntimeThreadIds !== state.localRuntimeThreadIds ? { localRuntimeThreadIds } : {}),
      };
    });
  },
  applyHostEvent: (event) => {
    const migratedEvent = migrateLegacyRuntimeHostEventInput(event) as HonkRuntimeHostEvent;
    set((state) => {
      applyRuntimeHostEventToThreadStore(migratedEvent, state.snapshot);
      const snapshot = reduceHostEvent(state.snapshot, migratedEvent);
      const localRuntimeThreadIds = clearAcknowledgedLocalRuntimeThreadIds(
        state.localRuntimeThreadIds,
        hostOwnedRuntimeThreadIdsForEvent(migratedEvent),
      );
      if (snapshot === state.snapshot && localRuntimeThreadIds === state.localRuntimeThreadIds) {
        return state;
      }
      return {
        ...(snapshot !== state.snapshot ? { snapshot } : {}),
        ...(localRuntimeThreadIds !== state.localRuntimeThreadIds ? { localRuntimeThreadIds } : {}),
      };
    });
  },
  markLocalRuntimeThread: (threadId) => {
    set((state) => {
      if (state.localRuntimeThreadIds.has(threadId)) {
        return state;
      }
      return {
        localRuntimeThreadIds: new Set([...state.localRuntimeThreadIds, threadId]),
      };
    });
  },
  clearLocalRuntimeThread: (threadId) => {
    set((state) => {
      if (!state.localRuntimeThreadIds.has(threadId)) {
        return state;
      }
      const nextThreadIds = new Set(state.localRuntimeThreadIds);
      nextThreadIds.delete(threadId);
      return {
        localRuntimeThreadIds: nextThreadIds,
      };
    });
  },
}));

export function selectIsRuntimeThread(
  state: AgentRuntimeState,
  threadId: ThreadId | null | undefined,
): boolean {
  if (!threadId) {
    return false;
  }
  return (
    state.localRuntimeThreadIds.has(threadId) ||
    state.snapshot.runtimeIdentities.some((identity) => identity.threadId === threadId) ||
    state.snapshot.displayTimelines.some((timeline) => timeline.threadId === threadId) ||
    state.snapshot.sessionTrees.some((tree) => tree.threadId === threadId) ||
    state.snapshot.pendingExtensionUiRequests.some((request) => request.threadId === threadId)
  );
}

export function selectRuntimeIdentityForThread(
  state: AgentRuntimeState,
  threadId: ThreadId | null | undefined,
): RuntimeThreadIdentity | null {
  if (!threadId) {
    return null;
  }
  return (
    state.snapshot.runtimeIdentities.find((identity) => identity.threadId === threadId) ?? null
  );
}

export function selectPendingExtensionUiRequestsForThread(
  state: AgentRuntimeState,
  threadId: ThreadId | null | undefined,
): readonly DesktopExtensionUiRequest[] {
  const source = state.snapshot.pendingExtensionUiRequests;
  if (
    source === lastPendingExtensionUiRequestsSource &&
    threadId === lastPendingExtensionUiRequestsThreadId
  ) {
    return lastPendingExtensionUiRequestsResult;
  }

  if (!threadId || source.length === 0) {
    lastPendingExtensionUiRequestsSource = source;
    lastPendingExtensionUiRequestsThreadId = threadId;
    lastPendingExtensionUiRequestsResult = EMPTY_PENDING_EXTENSION_UI_REQUESTS;
    return lastPendingExtensionUiRequestsResult;
  }

  const requests = source.filter((request) => request.threadId === threadId);
  lastPendingExtensionUiRequestsSource = source;
  lastPendingExtensionUiRequestsThreadId = threadId;
  lastPendingExtensionUiRequestsResult =
    requests.length === 0 ? EMPTY_PENDING_EXTENSION_UI_REQUESTS : requests;
  return lastPendingExtensionUiRequestsResult;
}

export function startDesktopRuntimeHostSync(): () => void {
  const api = readHonkRuntimeApi();
  let disposed = false;

  void api.getHostSnapshot().then((snapshot) => {
    if (!disposed) {
      useAgentRuntimeStore.getState().setSnapshot(snapshot);
    }
  });

  const unsubscribe = api.onHostEvent((event) => {
    if (!disposed) {
      useAgentRuntimeStore.getState().applyHostEvent(event);
    }
  });

  return () => {
    disposed = true;
    unsubscribe();
    resetRuntimeThreadHydrationCache();
  };
}
