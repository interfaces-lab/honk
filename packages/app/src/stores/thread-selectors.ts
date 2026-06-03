import { type ScopedProjectRef, type ScopedThreadRef, type ThreadId } from "@multi/contracts";
import { selectEnvironmentState, type AppState, type EnvironmentState } from "./thread-store";
import { type Project, type Thread } from "../types";
import { getThreadFromEnvironmentState } from "../thread-derivation";
import { debugLog } from "../lib/debug-log";

let nextThreadSelectorDebugId = 0;

export function createProjectSelectorByRef(
  ref: ScopedProjectRef | null | undefined,
): (state: AppState) => Project | undefined {
  return (state) =>
    ref ? selectEnvironmentState(state, ref.environmentId).projectById[ref.projectId] : undefined;
}

function createScopedThreadSelector(
  resolveRef: (state: AppState) => ScopedThreadRef | null | undefined,
): (state: AppState) => Thread | undefined {
  const selectorDebugId = ++nextThreadSelectorDebugId;
  let previousEnvironmentState: EnvironmentState | undefined;
  let previousThreadId: ThreadId | undefined;
  let previousThread: Thread | undefined;
  let callCount = 0;

  return (state) => {
    callCount += 1;
    const ref = resolveRef(state);
    if (!ref) {
      if (callCount <= 5) {
        debugLog("thread-selector.no-ref", { selectorDebugId, callCount });
      }
      return undefined;
    }

    const environmentState = selectEnvironmentState(state, ref.environmentId);
    if (
      previousThread &&
      previousEnvironmentState === environmentState &&
      previousThreadId === ref.threadId
    ) {
      if (callCount <= 10 || callCount % 25 === 0) {
        debugLog("thread-selector.hit", {
          selectorDebugId,
          callCount,
          environmentId: ref.environmentId,
          threadId: ref.threadId,
        });
      }
      return previousThread;
    }

    previousEnvironmentState = environmentState;
    previousThreadId = ref.threadId;
    previousThread = getThreadFromEnvironmentState(environmentState, ref.threadId);
    debugLog("thread-selector.miss", {
      selectorDebugId,
      callCount,
      environmentId: ref.environmentId,
      threadId: ref.threadId,
      hasThread: previousThread !== undefined,
      messageCount: previousThread?.messages.length ?? null,
      entryCount: previousThread?.entries.length ?? null,
    });
    return previousThread;
  };
}

export function createThreadSelectorByRef(
  ref: ScopedThreadRef | null | undefined,
): (state: AppState) => Thread | undefined {
  return createScopedThreadSelector(() => ref);
}

export function createThreadSelectorAcrossEnvironments(
  threadId: ThreadId | null | undefined,
): (state: AppState) => Thread | undefined {
  return createScopedThreadSelector((state) => {
    if (!threadId) {
      return undefined;
    }

    for (const [environmentId, environmentState] of Object.entries(
      state.environmentStateById,
    ) as Array<[ScopedThreadRef["environmentId"], EnvironmentState]>) {
      if (environmentState.threadShellById[threadId]) {
        return {
          environmentId,
          threadId,
        };
      }
    }
    return undefined;
  });
}
