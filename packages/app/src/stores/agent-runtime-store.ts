import {
  type ClientOrchestrationCommand,
  CommandId,
  type DesktopExtensionUiRequest,
  type EnvironmentId,
  type EnvironmentApi,
  EnvironmentId as EnvironmentIdSchema,
  EventId,
  MessageId,
  type MultiRuntimeHostEvent,
  type MultiRuntimeHostSnapshot,
  type OrchestrationThreadActivity,
  type RuntimeDisplayTimelineItem,
  type RuntimeDisplayTimelineProjection,
  type SessionTreeProjection,
  type SessionTreeEntry,
  type ThreadId,
  TurnId,
} from "@multi/contracts";
import { create } from "zustand";

import { DESKTOP_RUNTIME_ENVIRONMENT_ID } from "../lib/environment-scope";
import { createEmptyRuntimeHostSnapshot, readMultiRuntimeApi } from "../lib/multi-runtime-api";
import { runtimeParentToolDisplaySignature } from "../lib/runtime-tool-display";
import { readEnvironmentApi } from "../environment-api";
import { getThreadFromEnvironmentState } from "../thread-derivation";
import { useComposerDraftStore } from "./chat-drafts";
import { runtimeSubagentActivitiesForToolEvent } from "./thread-sync";
import { useStore, type EnvironmentState } from "./thread-store";

interface AgentRuntimeState {
  readonly snapshot: MultiRuntimeHostSnapshot;
  readonly localRuntimeThreadIds: ReadonlySet<ThreadId>;
  readonly setSnapshot: (snapshot: MultiRuntimeHostSnapshot) => void;
  readonly applyHostEvent: (event: MultiRuntimeHostEvent) => void;
  readonly markLocalRuntimeThread: (threadId: ThreadId) => void;
  readonly clearLocalRuntimeThread: (threadId: ThreadId) => void;
}

const MAX_RETAINED_RUNTIME_EVENTS = 500;
const EMPTY_PENDING_EXTENSION_UI_REQUESTS: readonly DesktopExtensionUiRequest[] = [];
let lastPendingExtensionUiRequestsSource: ReadonlyArray<DesktopExtensionUiRequest> | null = null;
let lastPendingExtensionUiRequestsThreadId: ThreadId | null | undefined;
let lastPendingExtensionUiRequestsResult: readonly DesktopExtensionUiRequest[] =
  EMPTY_PENDING_EXTENSION_UI_REQUESTS;
const persistedRuntimeEventKeys = new Set<string>();
const persistedRuntimeAssistantEntryKeys = new Set<string>();

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
  tree: MultiRuntimeHostSnapshot["sessionTrees"][number],
): void {
  const store = useStore.getState();
  const environmentId = resolveRuntimeThreadEnvironmentId(tree.threadId);
  store.applyRuntimeSessionTreeProjection(tree, environmentId);
}

function persistRuntimeSessionTreeToOrchestration(
  tree: MultiRuntimeHostSnapshot["sessionTrees"][number],
): void {
  const environmentId = resolveRuntimeThreadEnvironmentId(tree.threadId);
  const api = readEnvironmentApi(environmentId);
  if (!api) {
    return;
  }

  const entryById = new Map(tree.entries.map((entry) => [entry.id, entry] as const));
  for (const entry of tree.entries) {
    const command = runtimeSessionTreeAssistantCompleteCommand({
      tree,
      entry,
      entryById,
    });
    if (!command) {
      continue;
    }
    const entryKey = runtimeAssistantEntryPersistenceKey(tree, entry);
    if (persistedRuntimeAssistantEntryKeys.has(entryKey)) {
      continue;
    }
    dispatchRuntimePersistenceCommand({
      api,
      command,
      persistenceKey: entryKey,
      persistedKeys: persistedRuntimeAssistantEntryKeys,
    });
  }
}

function applyRuntimeEventToThreadStore(
  event: MultiRuntimeHostSnapshot["runtimeEvents"][number],
): void {
  const store = useStore.getState();
  const environmentId = resolveRuntimeThreadEnvironmentId(event.threadId);
  store.applyAgentRuntimeEvent(event, environmentId);
}

function persistRuntimeEventToOrchestration(
  event: MultiRuntimeHostSnapshot["runtimeEvents"][number],
): void {
  const eventKey = runtimeEventPersistenceKey(event);
  if (persistedRuntimeEventKeys.has(eventKey)) {
    return;
  }
  if (event.type !== "tool.completed") {
    return;
  }

  const environmentId = resolveRuntimeThreadEnvironmentId(event.threadId);
  const api = readEnvironmentApi(environmentId);
  if (!api) {
    return;
  }

  const activities = runtimeToolCompletedActivities(event);
  if (activities.length === 0) {
    return;
  }
  persistedRuntimeEventKeys.add(eventKey);
  for (const activity of activities) {
    dispatchRuntimePersistenceCommand({
      api,
      command: {
        type: "thread.activity.append",
        commandId: runtimeToolActivityCommandId(event, activity),
        threadId: event.threadId,
        activity,
        createdAt: event.createdAt,
      },
      persistenceKey: eventKey,
      persistedKeys: persistedRuntimeEventKeys,
    });
  }
}

function dispatchRuntimePersistenceCommand(input: {
  readonly api: EnvironmentApi;
  readonly command: ClientOrchestrationCommand;
  readonly persistenceKey: string;
  readonly persistedKeys: Set<string>;
}): void {
  input.persistedKeys.add(input.persistenceKey);
  void input.api.orchestration.dispatchCommand(input.command).catch((error: unknown) => {
    input.persistedKeys.delete(input.persistenceKey);
    console.error("Runtime orchestration persistence failed", error);
  });
}

function runtimeEventPersistenceKey(
  event: MultiRuntimeHostSnapshot["runtimeEvents"][number],
): string {
  return `${event.threadId}:${event.runtimeSessionId}:${event.id}`;
}

function runtimeAssistantEntryPersistenceKey(
  tree: SessionTreeProjection,
  entry: SessionTreeEntry,
): string {
  return `${tree.threadId}:${tree.runtimeSessionId}:${entry.id}`;
}

function runtimeSessionTreeAssistantCompleteCommand(input: {
  readonly tree: SessionTreeProjection;
  readonly entry: SessionTreeEntry;
  readonly entryById: ReadonlyMap<SessionTreeEntry["id"], SessionTreeEntry>;
}): ClientOrchestrationCommand | null {
  if (
    input.entry.role !== "assistant" ||
    !input.entry.turnId ||
    (input.entry.text?.trim().length ?? 0) === 0
  ) {
    return null;
  }

  const turnId = TurnId.make(input.entry.turnId);
  const parentEntryId =
    findSessionTreeUserAncestorEntryId(input.entry, input.entryById) ??
    findTurnUserEntryId(input.tree.threadId, turnId);
  if (!parentEntryId) {
    return null;
  }

  return {
    type: "thread.message.assistant.complete",
    commandId: runtimeAssistantCompleteCommandId(input.tree, input.entry),
    threadId: input.tree.threadId,
    messageId: runtimeAssistantMessageId(input.tree, input.entry),
    text: input.entry.text ?? "",
    turnId,
    parentEntryId,
    createdAt: input.entry.createdAt,
  };
}

function findSessionTreeUserAncestorEntryId(
  entry: SessionTreeEntry,
  entryById: ReadonlyMap<SessionTreeEntry["id"], SessionTreeEntry>,
) {
  const seen = new Set<SessionTreeEntry["id"]>();
  let cursor = entry.parentId;
  while (cursor) {
    if (seen.has(cursor)) {
      return null;
    }
    seen.add(cursor);
    const parent = entryById.get(cursor);
    if (!parent) {
      return null;
    }
    if (parent.role === "user" && parent.clientMessageId) {
      return parent.threadEntryId;
    }
    cursor = parent.parentId;
  }
  return null;
}

function runtimeAssistantCompleteCommandId(
  tree: SessionTreeProjection,
  entry: SessionTreeEntry,
): CommandId {
  return CommandId.make(`runtime-assistant:${tree.threadId}:${tree.runtimeSessionId}:${entry.id}`);
}

function runtimeAssistantMessageId(
  tree: SessionTreeProjection,
  entry: SessionTreeEntry,
): MessageId {
  return MessageId.make(`runtime:${tree.runtimeSessionId}:${entry.id}`);
}

function runtimeToolActivityCommandId(
  event: MultiRuntimeHostSnapshot["runtimeEvents"][number],
  activity: OrchestrationThreadActivity,
): CommandId {
  return CommandId.make(`runtime-tool:${event.threadId}:${event.runtimeSessionId}:${activity.id}`);
}

function findTurnUserEntryId(threadId: ThreadId, turnId: TurnId) {
  const store = useStore.getState();
  const environmentId = resolveRuntimeThreadEnvironmentId(threadId);
  const environmentState = store.environmentStateById[environmentId];
  if (!environmentState) {
    return null;
  }
  const thread = getThreadFromEnvironmentState(environmentState, threadId);
  if (!thread) {
    return null;
  }
  const messagesById = new Map(thread.messages.map((message) => [message.id, message] as const));
  for (let index = thread.entries.length - 1; index >= 0; index -= 1) {
    const entry = thread.entries[index];
    if (!entry || entry.kind !== "message" || entry.turnId !== turnId || entry.messageId === null) {
      continue;
    }
    const message = messagesById.get(entry.messageId);
    if (message?.role === "user") {
      return entry.id;
    }
  }
  return null;
}

function runtimeToolCompletedActivities(
  event: MultiRuntimeHostSnapshot["runtimeEvents"][number],
): OrchestrationThreadActivity[] {
  if (event.type !== "tool.completed") {
    return [];
  }
  const subagentActivities = runtimeSubagentActivitiesForToolEvent(event);
  if (subagentActivities.length > 0) {
    return subagentActivities;
  }
  const data = event.data && typeof event.data === "object" ? event.data : {};
  const record = data as Record<string, unknown>;
  const toolName = typeof record.toolName === "string" ? record.toolName : "tool";
  const toolCallId = typeof record.toolCallId === "string" ? record.toolCallId : event.id;
  const isError = record.isError === true;
  return [{
    id: EventId.make(`runtime-activity:${event.id}`),
    tone: isError ? ("error" as const) : ("tool" as const),
    kind: "tool.completed",
    summary: event.summary ?? (isError ? "Tool failed" : "Tool completed"),
    payload: {
      itemId: toolCallId,
      status: isError ? "error" : "completed",
      title: toolName,
      detail: event.summary,
      data: event.data ?? null,
    },
    turnId: event.turnId ?? null,
    createdAt: event.createdAt,
  }];
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

function runtimeThreadIds(snapshot: MultiRuntimeHostSnapshot): Set<ThreadId> {
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
  return threadIds;
}

function hostOwnedRuntimeThreadIds(snapshot: MultiRuntimeHostSnapshot): Set<ThreadId> {
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
  return threadIds;
}

function hostOwnedRuntimeThreadIdsForEvent(event: MultiRuntimeHostEvent): Set<ThreadId> {
  switch (event.type) {
    case "snapshot":
      return hostOwnedRuntimeThreadIds(event.snapshot);
    case "session-tree":
      return new Set([event.tree.threadId]);
    case "display-timeline":
      return new Set([event.timeline.threadId]);
    case "pending-extension-ui":
      return new Set(event.requests.map((request) => request.threadId));
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
  snapshot: MultiRuntimeHostSnapshot,
  previousSnapshot: MultiRuntimeHostSnapshot,
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
  snapshot: MultiRuntimeHostSnapshot,
  previousSnapshot: MultiRuntimeHostSnapshot,
): void {
  clearStaleRuntimeThreadsFromThreadStore(snapshot, previousSnapshot);
  for (const tree of snapshot.sessionTrees) {
    applyRuntimeSessionTreeToThreadStore(tree);
    persistRuntimeSessionTreeToOrchestration(tree);
  }
  for (const event of snapshot.runtimeEvents) {
    applyRuntimeEventToThreadStore(event);
    persistRuntimeEventToOrchestration(event);
  }
  syncPendingExtensionUiRequestsToThreadStore(snapshot.pendingExtensionUiRequests);
}

function applyRuntimeHostEventToThreadStore(
  event: MultiRuntimeHostEvent,
  previousSnapshot: MultiRuntimeHostSnapshot,
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
    persistRuntimeEventToOrchestration(event.event);
    return;
  }
  if (event.type === "session-tree") {
    applyRuntimeSessionTreeToThreadStore(event.tree);
    persistRuntimeSessionTreeToOrchestration(event.tree);
    return;
  }
  if (event.type === "pending-extension-ui") {
    syncPendingExtensionUiRequestsToThreadStore(event.requests);
    return;
  }
}

function reduceHostEvent(
  snapshot: MultiRuntimeHostSnapshot,
  event: MultiRuntimeHostEvent,
): MultiRuntimeHostSnapshot {
  switch (event.type) {
    case "snapshot":
      return normalizeRuntimeHostSnapshot(event.snapshot, snapshot);
    case "runtime-event":
      return snapshot;
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
  events: ReadonlyArray<MultiRuntimeHostSnapshot["runtimeEvents"][number]>,
): MultiRuntimeHostSnapshot["runtimeEvents"] {
  return events.length <= MAX_RETAINED_RUNTIME_EVENTS
    ? [...events]
    : events.slice(events.length - MAX_RETAINED_RUNTIME_EVENTS);
}

function upsertPendingExtensionUiRequests(
  snapshot: MultiRuntimeHostSnapshot,
  requests: ReadonlyArray<DesktopExtensionUiRequest>,
): MultiRuntimeHostSnapshot {
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
  snapshot: MultiRuntimeHostSnapshot,
  timeline: RuntimeDisplayTimelineProjection,
): MultiRuntimeHostSnapshot {
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
    case "custom-message": {
      if (right.kind !== "custom-message") return false;
      return (
        left.entryId === right.entryId &&
        left.threadEntryId === right.threadEntryId &&
        left.parentEntryId === right.parentEntryId &&
        left.parentThreadEntryId === right.parentThreadEntryId &&
        left.turnId === right.turnId &&
        left.customType === right.customType &&
        left.display === right.display &&
        runtimeCustomMessageVisibleText(left.content, left.text) ===
          runtimeCustomMessageVisibleText(right.content, right.text)
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

function runtimeCustomMessageVisibleText(
  content: unknown,
  fallbackText: string | undefined,
): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const record = entry as Record<string, unknown>;
        return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
      })
      .join("\n");
  }
  return fallbackText ?? "";
}

function normalizeRuntimeHostSnapshot(
  snapshot: MultiRuntimeHostSnapshot,
  previousSnapshot?: MultiRuntimeHostSnapshot | undefined,
): MultiRuntimeHostSnapshot {
  return {
    ...snapshot,
    runtimeEvents: retainRecentRuntimeEvents(snapshot.runtimeEvents),
    displayTimelines: previousSnapshot
      ? preserveDisplayTimelineIdentities(snapshot.displayTimelines, previousSnapshot.displayTimelines)
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
    set((state) => {
      const normalizedSnapshot = normalizeRuntimeHostSnapshot(snapshot, state.snapshot);
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
    set((state) => {
      applyRuntimeHostEventToThreadStore(event, state.snapshot);
      const snapshot = reduceHostEvent(state.snapshot, event);
      const localRuntimeThreadIds = clearAcknowledgedLocalRuntimeThreadIds(
        state.localRuntimeThreadIds,
        hostOwnedRuntimeThreadIdsForEvent(event),
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
    state.snapshot.displayTimelines.some((timeline) => timeline.threadId === threadId) ||
    state.snapshot.sessionTrees.some((tree) => tree.threadId === threadId) ||
    state.snapshot.pendingExtensionUiRequests.some((request) => request.threadId === threadId)
  );
}

export function selectPendingExtensionUiRequestsForThread(
  state: AgentRuntimeState,
  threadId: ThreadId | null | undefined,
): readonly DesktopExtensionUiRequest[] {
  const source = state.snapshot.pendingExtensionUiRequests;
  if (source === lastPendingExtensionUiRequestsSource && threadId === lastPendingExtensionUiRequestsThreadId) {
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
  const api = readMultiRuntimeApi();
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
  };
}
