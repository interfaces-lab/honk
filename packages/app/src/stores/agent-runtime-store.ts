import {
  type DesktopExtensionUiRequest,
  type EnvironmentId,
  EnvironmentId as EnvironmentIdSchema,
  type MultiRuntimeHostEvent,
  type MultiRuntimeHostSnapshot,
  type ThreadId,
} from "@multi/contracts";
import { create } from "zustand";

import { DESKTOP_RUNTIME_ENVIRONMENT_ID } from "../lib/environment-scope";
import { createEmptyRuntimeHostSnapshot, readMultiRuntimeApi } from "../lib/multi-runtime-api";
import { useComposerDraftStore } from "./chat-drafts";
import { useStore, type EnvironmentState } from "./thread-store";

interface AgentRuntimeState {
  readonly snapshot: MultiRuntimeHostSnapshot;
  readonly setSnapshot: (snapshot: MultiRuntimeHostSnapshot) => void;
  readonly applyHostEvent: (event: MultiRuntimeHostEvent) => void;
}

const EMPTY_PENDING_EXTENSION_UI_REQUESTS: readonly DesktopExtensionUiRequest[] = [];
let lastPendingExtensionUiRequestsSource: ReadonlyArray<DesktopExtensionUiRequest> | null = null;
let lastPendingExtensionUiRequestsThreadId: ThreadId | null | undefined;
let lastPendingExtensionUiRequestsResult: readonly DesktopExtensionUiRequest[] =
  EMPTY_PENDING_EXTENSION_UI_REQUESTS;

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

function applyRuntimeEventToThreadStore(
  event: MultiRuntimeHostSnapshot["runtimeEvents"][number],
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

function runtimeThreadIds(snapshot: MultiRuntimeHostSnapshot): Set<ThreadId> {
  const threadIds = new Set<ThreadId>();
  for (const tree of snapshot.sessionTrees) {
    threadIds.add(tree.threadId);
  }
  for (const event of snapshot.runtimeEvents) {
    threadIds.add(event.threadId);
  }
  for (const request of snapshot.pendingExtensionUiRequests) {
    threadIds.add(request.threadId);
  }
  return threadIds;
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
  }
  for (const event of snapshot.runtimeEvents) {
    applyRuntimeEventToThreadStore(event);
  }
  syncPendingExtensionUiRequestsToThreadStore(snapshot.pendingExtensionUiRequests);
}

function applyRuntimeHostEventToThreadStore(
  event: MultiRuntimeHostEvent,
  previousSnapshot: MultiRuntimeHostSnapshot,
): void {
  if (event.type === "snapshot") {
    syncRuntimeSnapshotToThreadStore(event.snapshot, previousSnapshot);
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
  }
}

function reduceHostEvent(
  snapshot: MultiRuntimeHostSnapshot,
  event: MultiRuntimeHostEvent,
): MultiRuntimeHostSnapshot {
  switch (event.type) {
    case "snapshot":
      return event.snapshot;
    case "runtime-event":
      return {
        ...snapshot,
        runtimeEvents: [...snapshot.runtimeEvents, event.event],
      };
    case "session-tree":
      return {
        ...snapshot,
        sessionTrees: [
          ...snapshot.sessionTrees.filter((tree) => tree.threadId !== event.tree.threadId),
          event.tree,
        ],
      };
    case "pending-extension-ui":
      return {
        ...snapshot,
        pendingExtensionUiRequests: [...event.requests],
      };
    case "credential-auth-flows":
      return {
        ...snapshot,
        credentialAuthFlows: [...event.flows],
      };
  }
}

export const useAgentRuntimeStore = create<AgentRuntimeState>()((set) => ({
  snapshot: createEmptyRuntimeHostSnapshot(),
  setSnapshot: (snapshot) => {
    set((state) => {
      syncRuntimeSnapshotToThreadStore(snapshot, state.snapshot);
      return { snapshot };
    });
  },
  applyHostEvent: (event) => {
    set((state) => {
      applyRuntimeHostEventToThreadStore(event, state.snapshot);
      return { snapshot: reduceHostEvent(state.snapshot, event) };
    });
  },
}));

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
