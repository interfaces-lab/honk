import {
  type AgentRuntimeEvent,
  type DesktopExtensionUiRequest,
  type HonkRuntimeHostEvent,
  type HonkRuntimeHostSnapshot,
  migrateLegacyRuntimeHostEventInput,
  migrateLegacyRuntimeHostSnapshotInput,
  type RuntimeDisplayTimelineItem,
  type RuntimeDisplayTimelineProjection,
  type RuntimeThreadIdentity,
  type TurnId,
} from "@honk/contracts";
import { type EnvironmentId, EnvironmentId as EnvironmentIdSchema } from "@honk/shared/environment";
import type { ThreadId } from "@honk/shared/base-schemas";
import { create } from "zustand";

import { DESKTOP_RUNTIME_ENVIRONMENT_ID } from "../lib/environment-scope";
import { createEmptyRuntimeHostSnapshot, readHonkRuntimeApi } from "../lib/honk-runtime-api";
import { resetRuntimeThreadHydrationCache } from "../lib/runtime-turn-dispatch";
import { runtimeParentToolDisplaySignature } from "../lib/runtime-tool-display";
import { useComposerDraftStore } from "./chat-drafts";
import { useStore, type EnvironmentState } from "./thread-store";

export interface AgentRuntimeState {
  readonly snapshot: HonkRuntimeHostSnapshot;
  readonly localRuntimeThreadIds: ReadonlySet<ThreadId>;
  readonly runtimeActivityByThreadId: ReadonlyMap<ThreadId, RuntimeThreadActivityState>;
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

export interface RuntimeThreadActivityState extends RuntimeAgentRunEventState {
  /**
   * Live presentation state derived from runtime events until the next display timeline
   * confirms the visible rows. This bridges the host's raw-event-before-timeline ordering.
   */
  readonly presentationActive: boolean;
}

const EMPTY_RUNTIME_THREAD_ACTIVITY: RuntimeThreadActivityState = {
  lifecycle: null,
  latestTurnId: null,
  presentationActive: false,
};

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

export function selectRuntimeThreadActivity(
  state: AgentRuntimeState,
  threadId: ThreadId | null | undefined,
): RuntimeThreadActivityState {
  if (!threadId) {
    return EMPTY_RUNTIME_THREAD_ACTIVITY;
  }
  return state.runtimeActivityByThreadId.get(threadId) ?? EMPTY_RUNTIME_THREAD_ACTIVITY;
}

const EMPTY_RUNTIME_THREAD_EVENTS: AgentRuntimeEvent[] = [];

// Cache one filtered array per thread keyed by the source `runtimeEvents`
// reference. A single shared slot thrashes when multiple ChatView surfaces
// (tiled panes) subscribe with different thread ids: each `useSyncExternalStore`
// getSnapshot would return a fresh `.filter()` array, fail Object.is, and force
// an infinite re-render. Keying by thread id keeps every surface stable.
interface CachedRuntimeThreadEvents {
  readonly source: ReadonlyArray<AgentRuntimeEvent>;
  readonly events: ReadonlyArray<AgentRuntimeEvent>;
}

const cachedRuntimeThreadEventsByThreadId = new Map<ThreadId, CachedRuntimeThreadEvents>();

function areSameRuntimeEventReferences(
  left: ReadonlyArray<AgentRuntimeEvent>,
  right: ReadonlyArray<AgentRuntimeEvent>,
): boolean {
  if (left === right) {
    return true;
  }
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

export function selectRuntimeEventsForThread(
  state: AgentRuntimeState,
  threadId: ThreadId | null | undefined,
): ReadonlyArray<AgentRuntimeEvent> {
  if (!threadId) {
    return EMPTY_RUNTIME_THREAD_EVENTS;
  }

  const source = state.snapshot.runtimeEvents;
  const cached = cachedRuntimeThreadEventsByThreadId.get(threadId);
  if (cached && cached.source === source) {
    return cached.events;
  }

  const next = source.filter((event) => event.threadId === threadId);
  if (cached && areSameRuntimeEventReferences(cached.events, next)) {
    cachedRuntimeThreadEventsByThreadId.set(threadId, { source, events: cached.events });
    return cached.events;
  }

  cachedRuntimeThreadEventsByThreadId.set(threadId, { source, events: next });
  return next;
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
    case "queued-follow-ups":
      return new Set(event.items.map((item) => item.threadId));
    case "runtime-ingestion-records":
      return new Set(event.records.map((record) => record.threadId));
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
    case "queued-follow-ups":
      return {
        ...snapshot,
        queuedFollowUps: [...event.items],
      };
    case "runtime-ingestion-records":
      return snapshot;
    case "credential-auth-flows":
      return {
        ...snapshot,
        credentialAuthFlows: [...event.flows],
      };
  }
}

function reduceRuntimeActivitiesForHostEvent(
  activities: ReadonlyMap<ThreadId, RuntimeThreadActivityState>,
  event: HonkRuntimeHostEvent,
  snapshot: HonkRuntimeHostSnapshot,
): ReadonlyMap<ThreadId, RuntimeThreadActivityState> {
  switch (event.type) {
    case "snapshot":
      return normalizeRuntimeActivitiesForSnapshot(snapshot, activities);
    case "runtime-event":
      return updateRuntimeThreadActivity(
        activities,
        event.event.threadId,
        reduceRuntimeThreadActivityEvent(
          activities.get(event.event.threadId) ?? EMPTY_RUNTIME_THREAD_ACTIVITY,
          event.event,
        ),
      );
    case "display-timeline":
      return updateRuntimeThreadActivity(
        activities,
        event.timeline.threadId,
        reduceRuntimeThreadActivityDisplayTimeline(
          activities.get(event.timeline.threadId) ?? EMPTY_RUNTIME_THREAD_ACTIVITY,
          event.timeline,
        ),
      );
    case "pending-extension-ui":
      return reduceRuntimeThreadActivityPendingRequests(activities, event.requests);
    case "queued-follow-ups":
    case "runtime-ingestion-records":
    case "session-tree":
    case "runtime-identities":
    case "credential-auth-flows":
      return activities;
  }
}

function normalizeRuntimeActivitiesForSnapshot(
  snapshot: HonkRuntimeHostSnapshot,
  previousActivities: ReadonlyMap<ThreadId, RuntimeThreadActivityState>,
): ReadonlyMap<ThreadId, RuntimeThreadActivityState> {
  const nextActivities = new Map<ThreadId, RuntimeThreadActivityState>();
  for (const threadId of runtimeThreadIds(snapshot)) {
    let activity = previousActivities.get(threadId) ?? EMPTY_RUNTIME_THREAD_ACTIVITY;
    for (const event of snapshot.runtimeEvents) {
      if (event.threadId === threadId) {
        activity = reduceRuntimeThreadActivityEvent(activity, event);
      }
    }
    const timeline = snapshot.displayTimelines.find((candidate) => candidate.threadId === threadId);
    if (timeline) {
      activity = reduceRuntimeThreadActivityDisplayTimeline(activity, timeline);
    }
    if (snapshot.pendingExtensionUiRequests.some((request) => request.threadId === threadId)) {
      activity = {
        ...activity,
        presentationActive: true,
      };
    }
    if (!isEmptyRuntimeThreadActivity(activity)) {
      nextActivities.set(threadId, activity);
    }
  }
  return runtimeThreadActivityMapsEqual(previousActivities, nextActivities)
    ? previousActivities
    : nextActivities;
}

function reduceRuntimeThreadActivityEvent(
  activity: RuntimeThreadActivityState,
  event: AgentRuntimeEvent,
): RuntimeThreadActivityState {
  const lifecycle = runtimeLifecycleAfterEvent(activity.lifecycle, event);
  const latestTurnId = runtimeLatestTurnIdAfterEvent(activity.latestTurnId, event);
  const presentationActive = runtimePresentationActiveAfterEvent(activity, event, lifecycle);
  const nextActivity = {
    lifecycle,
    latestTurnId,
    presentationActive,
  };
  return runtimeThreadActivitiesEqual(activity, nextActivity) ? activity : nextActivity;
}

function runtimeLifecycleAfterEvent(
  lifecycle: RuntimeAgentRunLifecycle,
  event: AgentRuntimeEvent,
): RuntimeAgentRunLifecycle {
  switch (event.type) {
    case "agent.started":
    case "turn.started":
      return "active";
    case "agent.completed":
    case "turn.interrupted":
    case "runtime.error":
      return "terminal";
    default:
      return lifecycle;
  }
}

function runtimePresentationActiveAfterEvent(
  activity: RuntimeThreadActivityState,
  event: AgentRuntimeEvent,
  lifecycle: RuntimeAgentRunLifecycle,
): boolean {
  switch (event.type) {
    case "message.started":
    case "message.updated":
      return event.messageRole !== "user";
    case "tool.started":
    case "tool.updated":
    case "extension-ui.requested":
      return true;
    case "agent.completed":
    case "turn.completed":
    case "turn.interrupted":
    case "runtime.error":
      // The host emits the raw runtime event before the coalesced display timeline. Keep
      // the presentation live until that timeline confirms the visible tail has settled.
      return activity.presentationActive || activity.lifecycle === "active";
    default:
      return lifecycle === "active" ? activity.presentationActive : false;
  }
}

function reduceRuntimeThreadActivityDisplayTimeline(
  activity: RuntimeThreadActivityState,
  timeline: RuntimeDisplayTimelineProjection,
): RuntimeThreadActivityState {
  const nextActivity = {
    ...activity,
    presentationActive: runtimeDisplayTimelineHasActiveWorkForActivity(timeline),
  };
  return runtimeThreadActivitiesEqual(activity, nextActivity) ? activity : nextActivity;
}

function reduceRuntimeThreadActivityPendingRequests(
  activities: ReadonlyMap<ThreadId, RuntimeThreadActivityState>,
  requests: ReadonlyArray<DesktopExtensionUiRequest>,
): ReadonlyMap<ThreadId, RuntimeThreadActivityState> {
  const requestThreadIds = new Set(requests.map((request) => request.threadId));
  let result = activities;
  for (const threadId of requestThreadIds) {
    const activity = result.get(threadId) ?? EMPTY_RUNTIME_THREAD_ACTIVITY;
    result = updateRuntimeThreadActivity(result, threadId, {
      ...activity,
      presentationActive: true,
    });
  }
  return result;
}

function runtimeDisplayTimelineHasActiveWorkForActivity(
  timeline: RuntimeDisplayTimelineProjection,
): boolean {
  return timeline.items.some((item) => {
    switch (item.kind) {
      case "message":
        return item.streaming === true;
      case "tool":
        return (
          item.status === "running" ||
          (item.display.kind === "subagent" &&
            item.display.runs.some((run) => run.state === "running"))
        );
      case "extension-ui-request":
        return item.status === "pending";
      case "proposed-plan":
        return false;
    }
  });
}

function updateRuntimeThreadActivity(
  activities: ReadonlyMap<ThreadId, RuntimeThreadActivityState>,
  threadId: ThreadId,
  activity: RuntimeThreadActivityState,
): ReadonlyMap<ThreadId, RuntimeThreadActivityState> {
  const previousActivity = activities.get(threadId) ?? EMPTY_RUNTIME_THREAD_ACTIVITY;
  if (runtimeThreadActivitiesEqual(previousActivity, activity)) {
    return activities;
  }
  const nextActivities = new Map(activities);
  if (isEmptyRuntimeThreadActivity(activity)) {
    nextActivities.delete(threadId);
  } else {
    nextActivities.set(threadId, activity);
  }
  return nextActivities;
}

function isEmptyRuntimeThreadActivity(activity: RuntimeThreadActivityState): boolean {
  return (
    activity.lifecycle === null &&
    activity.latestTurnId === null &&
    activity.presentationActive === false
  );
}

function runtimeLatestTurnIdAfterEvent(
  latestTurnId: TurnId | null,
  event: AgentRuntimeEvent,
): TurnId | null {
  switch (event.type) {
    case "agent.started":
      return event.turnId ?? null;
    case "turn.started":
      return event.turnId ?? null;
    default:
      return latestTurnId;
  }
}

function runtimeThreadActivitiesEqual(
  left: RuntimeThreadActivityState,
  right: RuntimeThreadActivityState,
): boolean {
  return (
    left.lifecycle === right.lifecycle &&
    left.latestTurnId === right.latestTurnId &&
    left.presentationActive === right.presentationActive
  );
}

function runtimeThreadActivityMapsEqual(
  left: ReadonlyMap<ThreadId, RuntimeThreadActivityState>,
  right: ReadonlyMap<ThreadId, RuntimeThreadActivityState>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [threadId, leftActivity] of left) {
    const rightActivity = right.get(threadId);
    if (!rightActivity || !runtimeThreadActivitiesEqual(leftActivity, rightActivity)) {
      return false;
    }
  }
  return true;
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
    areSameStrings(left.options ?? [], right.options ?? []) &&
    areSameExtensionUiQuestions(left.questions ?? [], right.questions ?? [])
  );
}

function areQueuedFollowUpsEqual(
  left: HonkRuntimeHostSnapshot["queuedFollowUps"],
  right: HonkRuntimeHostSnapshot["queuedFollowUps"],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((leftItem, index) => {
    const rightItem = right[index];
    return (
      rightItem !== undefined &&
      leftItem.threadId === rightItem.threadId &&
      leftItem.cwd === rightItem.cwd &&
      leftItem.clientMessageId === rightItem.clientMessageId &&
      leftItem.replacesClientMessageId === rightItem.replacesClientMessageId &&
      leftItem.parentEntryId === rightItem.parentEntryId &&
      leftItem.input === rightItem.input &&
      leftItem.interactionMode === rightItem.interactionMode &&
      leftItem.runtimeMode === rightItem.runtimeMode &&
      leftItem.titleSeed === rightItem.titleSeed &&
      leftItem.sourceProposedPlan?.threadId === rightItem.sourceProposedPlan?.threadId &&
      leftItem.sourceProposedPlan?.planId === rightItem.sourceProposedPlan?.planId &&
      leftItem.createdAt === rightItem.createdAt &&
      JSON.stringify(leftItem.policy) === JSON.stringify(rightItem.policy) &&
      JSON.stringify(leftItem.modelSelection) === JSON.stringify(rightItem.modelSelection) &&
      leftItem.images.length === rightItem.images.length &&
      leftItem.images.every((leftImage, imageIndex) => {
        const rightImage = rightItem.images[imageIndex];
        return (
          rightImage !== undefined &&
          leftImage.type === rightImage.type &&
          leftImage.name === rightImage.name &&
          leftImage.mimeType === rightImage.mimeType &&
          leftImage.sizeBytes === rightImage.sizeBytes &&
          leftImage.dataUrl === rightImage.dataUrl
        );
      })
    );
  });
}

function areSameExtensionUiQuestions(
  left: NonNullable<DesktopExtensionUiRequest["questions"]>,
  right: NonNullable<DesktopExtensionUiRequest["questions"]>,
): boolean {
  if (left.length !== right.length) return false;
  return left.every((leftQuestion, index) => {
    const rightQuestion = right[index];
    if (!rightQuestion) return false;
    return (
      leftQuestion.id === rightQuestion.id &&
      leftQuestion.text === rightQuestion.text &&
      leftQuestion.allowMultiple === rightQuestion.allowMultiple &&
      leftQuestion.options.length === rightQuestion.options.length &&
      leftQuestion.options.every((leftOption, optionIndex) => {
        const rightOption = rightQuestion.options[optionIndex];
        return (
          rightOption !== undefined &&
          leftOption.id === rightOption.id &&
          leftOption.label === rightOption.label
        );
      })
    );
  });
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
        left.shortDescription === right.shortDescription &&
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
  previousSnapshot?: HonkRuntimeHostSnapshot,
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
    queuedFollowUps:
      previousSnapshot &&
      areQueuedFollowUpsEqual(previousSnapshot.queuedFollowUps, snapshot.queuedFollowUps)
        ? previousSnapshot.queuedFollowUps
        : [...snapshot.queuedFollowUps],
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
  runtimeActivityByThreadId: new Map(),
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
      const runtimeActivityByThreadId = normalizeRuntimeActivitiesForSnapshot(
        normalizedSnapshot,
        state.runtimeActivityByThreadId,
      );
      return {
        snapshot: normalizedSnapshot,
        ...(localRuntimeThreadIds !== state.localRuntimeThreadIds ? { localRuntimeThreadIds } : {}),
        ...(runtimeActivityByThreadId !== state.runtimeActivityByThreadId
          ? { runtimeActivityByThreadId }
          : {}),
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
      const runtimeActivityByThreadId = reduceRuntimeActivitiesForHostEvent(
        state.runtimeActivityByThreadId,
        migratedEvent,
        snapshot,
      );
      if (
        snapshot === state.snapshot &&
        localRuntimeThreadIds === state.localRuntimeThreadIds &&
        runtimeActivityByThreadId === state.runtimeActivityByThreadId
      ) {
        return state;
      }
      return {
        ...(snapshot !== state.snapshot ? { snapshot } : {}),
        ...(localRuntimeThreadIds !== state.localRuntimeThreadIds ? { localRuntimeThreadIds } : {}),
        ...(runtimeActivityByThreadId !== state.runtimeActivityByThreadId
          ? { runtimeActivityByThreadId }
          : {}),
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
  let snapshotApplied = false;
  const bufferedEvents: HonkRuntimeHostEvent[] = [];
  const applyBufferedEvents = () => {
    for (const event of bufferedEvents.splice(0)) {
      useAgentRuntimeStore.getState().applyHostEvent(event);
    }
  };

  void api.getHostSnapshot().then(
    (snapshot) => {
      if (!disposed) {
        useAgentRuntimeStore.getState().setSnapshot(snapshot);
        snapshotApplied = true;
        applyBufferedEvents();
      }
    },
    () => {
      if (!disposed) {
        snapshotApplied = true;
        applyBufferedEvents();
      }
    },
  );

  const unsubscribe = api.onHostEvent((event) => {
    if (!disposed) {
      if (!snapshotApplied) {
        bufferedEvents.push(event);
        return;
      }
      useAgentRuntimeStore.getState().applyHostEvent(event);
    }
  });

  return () => {
    disposed = true;
    unsubscribe();
    resetRuntimeThreadHydrationCache();
  };
}
