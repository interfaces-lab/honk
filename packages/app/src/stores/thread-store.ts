import type {
  EnvironmentId,
  ScopedProjectRef,
  ScopedThreadRef,
} from "@honk/shared/environment";
import type {
  AgentRuntimeEvent,
  MessageId,
  OrchestrationThreadActivity,
  ThreadEntryId,
  OrchestrationEvent,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  OrchestrationThread,
  DesktopExtensionUiRequest,
  SessionTreeProjection,
  TurnId,
} from "@honk/contracts";
import type { ProjectId, ThreadId } from "@honk/shared/base-schemas";
import { create } from "zustand";
import type {
  ChatMessage,
  LiveAssistantTurn,
  Project,
  ProposedPlan,
  SidebarThreadSummary,
  Thread,
  ThreadTreeEntry,
  ThreadSession,
  ThreadShell,
  ThreadTurnState,
  TurnDiffSummary,
} from "../types";
import { getThreadFromEnvironmentState } from "../thread-derivation";
import { scopedThreadKey, scopeThreadRef } from "~/lib/environment-scope";
import {
  applyOrchestrationEvent,
  applyOrchestrationEvents,
  applyAgentRuntimeEvent,
  clearAgentRuntimeThreadSession,
  applyRuntimeSessionTreeProjection,
  clearUnconfirmedLocalThread,
  clearUnconfirmedLocalTurnStart,
  applyShellEvent,
  setActiveEnvironmentId,
  setError,
  setThreadBranch,
  syncServerShellSnapshot,
  syncCachedShellSnapshot,
  syncPendingExtensionUiRequests,
  syncServerThreadDetail,
  runtimeSubagentActivitiesForToolEvent,
  subagentActivitiesForThreadDetail,
  subagentActivityBatchesForOrchestrationEvent,
  subagentActivityBatchesForOrchestrationEvents,
} from "./thread-sync";
import { useSubagentActivityStore } from "./subagent-activity-store";

export {
  applyOrchestrationEvent,
  applyOrchestrationEvents,
  applyAgentRuntimeEvent,
  clearAgentRuntimeThreadSession,
  applyRuntimeSessionTreeProjection,
  clearUnconfirmedLocalThread,
  clearUnconfirmedLocalTurnStart,
  applyShellEvent,
  setActiveEnvironmentId,
  setError,
  setThreadBranch,
  syncServerShellSnapshot,
  syncCachedShellSnapshot,
  syncPendingExtensionUiRequests,
  syncServerThreadDetail,
} from "./thread-sync";

export type EnvironmentSnapshotSource = "none" | "cache" | "server";

export interface EnvironmentState {
  projectIds: ProjectId[];
  projectById: Record<ProjectId, Project>;
  threadIds: ThreadId[];
  threadIdsByProjectId: Record<ProjectId, ThreadId[]>;
  projectlessThreadIds: ThreadId[];
  threadShellById: Record<ThreadId, ThreadShell>;
  threadSessionById: Record<ThreadId, ThreadSession | null>;
  threadTurnStateById: Record<ThreadId, ThreadTurnState>;
  messageIdsByThreadId: Record<ThreadId, MessageId[]>;
  messageByThreadId: Record<ThreadId, Record<MessageId, ChatMessage>>;
  liveAssistantTurnIdsByThreadId: Record<ThreadId, TurnId[]>;
  liveAssistantTurnByThreadId: Record<ThreadId, Record<TurnId, LiveAssistantTurn>>;
  leafIdByThreadId?: Record<ThreadId, ThreadEntryId | null>;
  entryIdsByThreadId?: Record<ThreadId, ThreadEntryId[]>;
  entryByThreadId?: Record<ThreadId, Record<ThreadEntryId, ThreadTreeEntry>>;
  activityIdsByThreadId: Record<ThreadId, string[]>;
  activityByThreadId: Record<ThreadId, Record<string, OrchestrationThreadActivity>>;
  proposedPlanIdsByThreadId: Record<ThreadId, string[]>;
  proposedPlanByThreadId: Record<ThreadId, Record<string, ProposedPlan>>;
  turnDiffIdsByThreadId: Record<ThreadId, TurnId[]>;
  turnDiffSummaryByThreadId: Record<ThreadId, Record<TurnId, TurnDiffSummary>>;
  sidebarThreadSummaryById: Record<ThreadId, SidebarThreadSummary>;
  snapshotSource: EnvironmentSnapshotSource;
  bootstrapComplete: boolean;
}

export interface AppState {
  activeEnvironmentId: EnvironmentId | null;
  environmentStateById: Record<string, EnvironmentState>;
}

export const initialEnvironmentState: EnvironmentState = {
  projectIds: [],
  projectById: {},
  threadIds: [],
  threadIdsByProjectId: {},
  projectlessThreadIds: [],
  threadShellById: {},
  threadSessionById: {},
  threadTurnStateById: {},
  messageIdsByThreadId: {},
  messageByThreadId: {},
  liveAssistantTurnIdsByThreadId: {},
  liveAssistantTurnByThreadId: {},
  leafIdByThreadId: {},
  entryIdsByThreadId: {},
  entryByThreadId: {},
  activityIdsByThreadId: {},
  activityByThreadId: {},
  proposedPlanIdsByThreadId: {},
  proposedPlanByThreadId: {},
  turnDiffIdsByThreadId: {},
  turnDiffSummaryByThreadId: {},
  sidebarThreadSummaryById: {},
  snapshotSource: "none",
  bootstrapComplete: false,
};

export const initialState: AppState = {
  activeEnvironmentId: null,
  environmentStateById: {},
};

export const EMPTY_THREAD_IDS: ThreadId[] = [];

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

export function selectThreadKeysAcrossEnvironments(state: AppState): string[] {
  return getEnvironmentEntries(state).flatMap(([environmentId, environmentState]) =>
    environmentState.threadIds.map((threadId) =>
      scopedThreadKey(scopeThreadRef(environmentId, threadId)),
    ),
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

export function selectBootstrapCompleteForActiveEnvironment(state: AppState): boolean {
  return selectEnvironmentState(state, state.activeEnvironmentId).bootstrapComplete;
}

export function selectEnvironmentSnapshotSource(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): EnvironmentSnapshotSource {
  return selectEnvironmentState(state, environmentId).snapshotSource;
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

function replaceSubagentActivitiesForThreadDetail(
  thread: OrchestrationThread,
  environmentId: EnvironmentId,
): void {
  const activities = subagentActivitiesForThreadDetail(thread);
  if (activities.length === 0) {
    return;
  }
  useSubagentActivityStore
    .getState()
    .replaceActivities({ environmentId, threadId: thread.id }, activities);
}

function upsertSubagentActivityBatches(
  batches: ReadonlyArray<{
    readonly threadId: ThreadId;
    readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  }>,
  environmentId: EnvironmentId,
): void {
  const store = useSubagentActivityStore.getState();
  for (const batch of batches) {
    store.upsertActivities(
      {
        environmentId,
        threadId: batch.threadId,
      },
      batch.activities,
    );
  }
}

function syncSubagentActivitiesForOrchestrationEvent(
  event: OrchestrationEvent,
  environmentId: EnvironmentId,
): void {
  upsertSubagentActivityBatches(subagentActivityBatchesForOrchestrationEvent(event), environmentId);
  if (event.type === "thread.deleted") {
    useSubagentActivityStore.getState().removeThread({
      environmentId,
      threadId: event.payload.threadId,
    });
  }
}

function syncSubagentActivitiesForOrchestrationEvents(
  events: ReadonlyArray<OrchestrationEvent>,
  environmentId: EnvironmentId,
): void {
  upsertSubagentActivityBatches(
    subagentActivityBatchesForOrchestrationEvents(events),
    environmentId,
  );
  const store = useSubagentActivityStore.getState();
  for (const event of events) {
    if (event.type === "thread.deleted") {
      store.removeThread({
        environmentId,
        threadId: event.payload.threadId,
      });
    }
  }
}

function syncSubagentActivitiesForRuntimeEvent(
  event: AgentRuntimeEvent,
  environmentId: EnvironmentId,
): void {
  const activities = runtimeSubagentActivitiesForToolEvent(event);
  if (activities.length > 0) {
    useSubagentActivityStore.getState().upsertActivities(
      {
        environmentId,
        threadId: event.threadId,
      },
      activities,
    );
  }
}

function syncSubagentActivitiesForShellEvent(
  event: OrchestrationShellStreamEvent,
  environmentId: EnvironmentId,
): void {
  if (event.kind === "thread-removed") {
    useSubagentActivityStore.getState().removeThread({
      environmentId,
      threadId: event.threadId,
    });
  }
}

function retainSubagentActivitiesFromShellSnapshot(
  snapshot: OrchestrationShellSnapshot,
  environmentId: EnvironmentId,
): void {
  useSubagentActivityStore
    .getState()
    .retainThreadsForEnvironment(
      environmentId,
      new Set(snapshot.threads.map((thread) => thread.id)),
    );
}

interface AppStore extends AppState {
  setActiveEnvironmentId: (environmentId: EnvironmentId) => void;
  syncServerShellSnapshot: (
    snapshot: OrchestrationShellSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  syncCachedShellSnapshot: (
    snapshot: OrchestrationShellSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  syncServerThreadDetail: (thread: OrchestrationThread, environmentId: EnvironmentId) => void;
  applyOrchestrationEvent: (event: OrchestrationEvent, environmentId: EnvironmentId) => void;
  applyOrchestrationEvents: (
    events: ReadonlyArray<OrchestrationEvent>,
    environmentId: EnvironmentId,
  ) => void;
  applyAgentRuntimeEvent: (event: AgentRuntimeEvent, environmentId: EnvironmentId) => void;
  clearAgentRuntimeThreadSession: (threadId: ThreadId, environmentId: EnvironmentId) => void;
  clearUnconfirmedLocalTurnStart: (input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
  }) => void;
  clearUnconfirmedLocalThread: (input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  }) => void;
  applyRuntimeSessionTreeProjection: (
    tree: SessionTreeProjection,
    environmentId: EnvironmentId,
  ) => void;
  syncPendingExtensionUiRequests: (
    requests: ReadonlyArray<DesktopExtensionUiRequest>,
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
  syncServerShellSnapshot: (snapshot, environmentId) => {
    retainSubagentActivitiesFromShellSnapshot(snapshot, environmentId);
    set((state) => syncServerShellSnapshot(state, snapshot, environmentId));
  },
  syncCachedShellSnapshot: (snapshot, environmentId) =>
    set((state) => syncCachedShellSnapshot(state, snapshot, environmentId)),
  syncServerThreadDetail: (thread, environmentId) => {
    replaceSubagentActivitiesForThreadDetail(thread, environmentId);
    set((state) => syncServerThreadDetail(state, thread, environmentId));
  },
  applyOrchestrationEvent: (event, environmentId) => {
    syncSubagentActivitiesForOrchestrationEvent(event, environmentId);
    set((state) => applyOrchestrationEvent(state, event, environmentId));
  },
  applyOrchestrationEvents: (events, environmentId) => {
    syncSubagentActivitiesForOrchestrationEvents(events, environmentId);
    set((state) => applyOrchestrationEvents(state, events, environmentId));
  },
  applyAgentRuntimeEvent: (event, environmentId) => {
    syncSubagentActivitiesForRuntimeEvent(event, environmentId);
    set((state) => applyAgentRuntimeEvent(state, event, environmentId));
  },
  clearAgentRuntimeThreadSession: (threadId, environmentId) =>
    set((state) => clearAgentRuntimeThreadSession(state, threadId, environmentId)),
  clearUnconfirmedLocalTurnStart: (input) =>
    set((state) => clearUnconfirmedLocalTurnStart(state, input)),
  clearUnconfirmedLocalThread: (input) => set((state) => clearUnconfirmedLocalThread(state, input)),
  applyRuntimeSessionTreeProjection: (tree, environmentId) =>
    set((state) => applyRuntimeSessionTreeProjection(state, tree, environmentId)),
  syncPendingExtensionUiRequests: (requests, environmentId) =>
    set((state) => syncPendingExtensionUiRequests(state, requests, environmentId)),
  applyShellEvent: (event, environmentId) => {
    syncSubagentActivitiesForShellEvent(event, environmentId);
    set((state) => applyShellEvent(state, event, environmentId));
  },
  setError: (threadId, error) => set((state) => setError(state, threadId, error)),
  setThreadBranch: (threadRef, branch, worktreePath) =>
    set((state) => setThreadBranch(state, threadRef, branch, worktreePath)),
}));
