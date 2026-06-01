import {
  type DesktopExtensionUiRequest,
  type MultiRuntimeHostEvent,
  type MultiRuntimeHostSnapshot,
  type ThreadId,
} from "@multi/contracts";
import { create } from "zustand";

import { DESKTOP_RUNTIME_ENVIRONMENT_ID } from "../lib/client-runtime";
import { createEmptyRuntimeHostSnapshot, readMultiRuntimeApi } from "../lib/multi-runtime-api";
import { useStore } from "./thread-store";

interface AgentRuntimeState {
  readonly snapshot: MultiRuntimeHostSnapshot;
  readonly setSnapshot: (snapshot: MultiRuntimeHostSnapshot) => void;
  readonly applyHostEvent: (event: MultiRuntimeHostEvent) => void;
}

function syncRuntimeSnapshotToThreadStore(snapshot: MultiRuntimeHostSnapshot): void {
  const store = useStore.getState();
  store.setActiveEnvironmentId(DESKTOP_RUNTIME_ENVIRONMENT_ID);
  for (const tree of snapshot.sessionTrees) {
    store.applyRuntimeSessionTreeProjection(tree, DESKTOP_RUNTIME_ENVIRONMENT_ID);
  }
}

function applyRuntimeHostEventToThreadStore(event: MultiRuntimeHostEvent): void {
  const store = useStore.getState();
  store.setActiveEnvironmentId(DESKTOP_RUNTIME_ENVIRONMENT_ID);
  if (event.type === "snapshot") {
    syncRuntimeSnapshotToThreadStore(event.snapshot);
    return;
  }
  if (event.type === "session-tree") {
    store.applyRuntimeSessionTreeProjection(event.tree, DESKTOP_RUNTIME_ENVIRONMENT_ID);
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
  }
}

export const useAgentRuntimeStore = create<AgentRuntimeState>()((set) => ({
  snapshot: createEmptyRuntimeHostSnapshot(),
  setSnapshot: (snapshot) => {
    syncRuntimeSnapshotToThreadStore(snapshot);
    set({ snapshot });
  },
  applyHostEvent: (event) => {
    applyRuntimeHostEventToThreadStore(event);
    set((state) => ({ snapshot: reduceHostEvent(state.snapshot, event) }));
  },
}));

export function selectPendingExtensionUiRequestsForThread(
  state: AgentRuntimeState,
  threadId: ThreadId | null | undefined,
): readonly DesktopExtensionUiRequest[] {
  if (!threadId) {
    return [];
  }
  return state.snapshot.pendingExtensionUiRequests.filter((request) => request.threadId === threadId);
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
