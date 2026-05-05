import type {
  EnvironmentId,
  OrchestrationEvent,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  OrchestrationThread,
  ScopedProjectRef,
  ScopedThreadRef,
  ThreadId,
} from "@multi/contracts";
import { create } from "zustand";
import type { Project, SidebarThreadSummary, Thread, ThreadShell } from "./types";
import { getThreadFromEnvironmentState } from "./thread-derivation";
import {
  EMPTY_THREAD_IDS,
  initialEnvironmentState,
  initialState,
  type AppState,
  type EnvironmentState,
} from "./thread-state";
import {
  applyOrchestrationEvent,
  applyOrchestrationEvents,
  applyShellEvent,
  setActiveEnvironmentId,
  setError,
  setThreadBranch,
  syncServerShellSnapshot,
  syncServerThreadDetail,
} from "./thread-sync";

export type { AppState, EnvironmentState } from "./thread-state";
export {
  applyOrchestrationEvent,
  applyOrchestrationEvents,
  applyShellEvent,
  setActiveEnvironmentId,
  setError,
  setThreadBranch,
  syncServerShellSnapshot,
  syncServerThreadDetail,
} from "./thread-sync";

function getStoredEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId,
): EnvironmentState {
  return state.environmentStateById[environmentId] ?? initialEnvironmentState;
}

function getProjects(state: EnvironmentState): Project[] {
  return state.projectIds.flatMap((projectId) => {
    const project = state.projectById[projectId];
    return project ? [project] : [];
  });
}

function getThreads(state: EnvironmentState): Thread[] {
  return state.threadIds.flatMap((threadId) => {
    const thread = getThreadFromEnvironmentState(state, threadId);
    return thread ? [thread] : [];
  });
}

function getEnvironmentEntries(
  state: AppState,
): ReadonlyArray<readonly [EnvironmentId, EnvironmentState]> {
  return Object.entries(state.environmentStateById) as unknown as ReadonlyArray<
    readonly [EnvironmentId, EnvironmentState]
  >;
}

export function selectEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): EnvironmentState {
  return environmentId ? getStoredEnvironmentState(state, environmentId) : initialEnvironmentState;
}

export function selectProjectsForEnvironment(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): Project[] {
  return getProjects(selectEnvironmentState(state, environmentId));
}

export function selectThreadsForEnvironment(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): Thread[] {
  return getThreads(selectEnvironmentState(state, environmentId));
}

export function selectProjectsAcrossEnvironments(state: AppState): Project[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    getProjects(environmentState),
  );
}

export function selectThreadsAcrossEnvironments(state: AppState): Thread[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    getThreads(environmentState),
  );
}

/** Like `selectThreadsAcrossEnvironments` but returns stable `ThreadShell` references from the store (no derived data). */
export function selectThreadShellsAcrossEnvironments(state: AppState): ThreadShell[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    environmentState.threadIds.flatMap((threadId) => {
      const shell = environmentState.threadShellById[threadId];
      return shell ? [shell] : [];
    }),
  );
}

export function selectSidebarThreadsAcrossEnvironments(state: AppState): SidebarThreadSummary[] {
  return getEnvironmentEntries(state).flatMap(([environmentId, environmentState]) =>
    environmentState.threadIds.flatMap((threadId) => {
      const thread = environmentState.sidebarThreadSummaryById[threadId];
      return thread && thread.environmentId === environmentId ? [thread] : [];
    }),
  );
}

export function selectSidebarThreadsForProjectRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): SidebarThreadSummary[] {
  if (!ref) {
    return [];
  }

  const environmentState = selectEnvironmentState(state, ref.environmentId);
  const threadIds = environmentState.threadIdsByProjectId[ref.projectId] ?? EMPTY_THREAD_IDS;
  return threadIds.flatMap((threadId) => {
    const thread = environmentState.sidebarThreadSummaryById[threadId];
    return thread ? [thread] : [];
  });
}

export function selectSidebarThreadsForProjectRefs(
  state: AppState,
  refs: readonly ScopedProjectRef[],
): SidebarThreadSummary[] {
  if (refs.length === 0) return [];
  if (refs.length === 1) return selectSidebarThreadsForProjectRef(state, refs[0]);
  return refs.flatMap((ref) => selectSidebarThreadsForProjectRef(state, ref));
}

export function selectBootstrapCompleteForActiveEnvironment(state: AppState): boolean {
  return selectEnvironmentState(state, state.activeEnvironmentId).bootstrapComplete;
}

export function selectProjectByRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): Project | undefined {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).projectById[ref.projectId]
    : undefined;
}

export function selectThreadByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): Thread | undefined {
  return ref
    ? getThreadFromEnvironmentState(selectEnvironmentState(state, ref.environmentId), ref.threadId)
    : undefined;
}

export function selectThreadExistsByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): boolean {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).threadShellById[ref.threadId] !== undefined
    : false;
}

export function selectSidebarThreadSummaryByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): SidebarThreadSummary | undefined {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).sidebarThreadSummaryById[ref.threadId]
    : undefined;
}

export function selectThreadIdsByProjectRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): ThreadId[] {
  return ref
    ? (selectEnvironmentState(state, ref.environmentId).threadIdsByProjectId[ref.projectId] ??
        EMPTY_THREAD_IDS)
    : EMPTY_THREAD_IDS;
}

interface AppStore extends AppState {
  setActiveEnvironmentId: (environmentId: EnvironmentId) => void;
  syncServerShellSnapshot: (
    snapshot: OrchestrationShellSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  syncServerThreadDetail: (thread: OrchestrationThread, environmentId: EnvironmentId) => void;
  applyOrchestrationEvent: (event: OrchestrationEvent, environmentId: EnvironmentId) => void;
  applyOrchestrationEvents: (
    events: ReadonlyArray<OrchestrationEvent>,
    environmentId: EnvironmentId,
  ) => void;
  applyShellEvent: (event: OrchestrationShellStreamEvent, environmentId: EnvironmentId) => void;
  setError: (threadId: ThreadId, error: string | null) => void;
  setThreadBranch: (
    threadRef: ScopedThreadRef,
    branch: string | null,
    worktreePath: string | null,
  ) => void;
}

export const useStore = create<AppStore>((set) => ({
  ...initialState,
  setActiveEnvironmentId: (environmentId) =>
    set((state) => setActiveEnvironmentId(state, environmentId)),
  syncServerShellSnapshot: (snapshot, environmentId) =>
    set((state) => syncServerShellSnapshot(state, snapshot, environmentId)),
  syncServerThreadDetail: (thread, environmentId) =>
    set((state) => syncServerThreadDetail(state, thread, environmentId)),
  applyOrchestrationEvent: (event, environmentId) =>
    set((state) => applyOrchestrationEvent(state, event, environmentId)),
  applyOrchestrationEvents: (events, environmentId) =>
    set((state) => applyOrchestrationEvents(state, events, environmentId)),
  applyShellEvent: (event, environmentId) =>
    set((state) => applyShellEvent(state, event, environmentId)),
  setError: (threadId, error) => set((state) => setError(state, threadId, error)),
  setThreadBranch: (threadRef, branch, worktreePath) =>
    set((state) => setThreadBranch(state, threadRef, branch, worktreePath)),
}));
