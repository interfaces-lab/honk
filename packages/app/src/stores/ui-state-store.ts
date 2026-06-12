import { Debouncer } from "@tanstack/react-pacer";
import { Option, Schema } from "effect";
import { create } from "zustand";

const PERSISTED_STATE_KEY = "honk:ui-state:v1";

export const SIDEBAR_THREAD_FILTERS = [
  "running",
  "needs_attention",
  "idle",
  "stopped",
  "error",
  "archived",
] as const;
export type SidebarThreadFilter = (typeof SIDEBAR_THREAD_FILTERS)[number];

const PersistedUiState = Schema.Struct({
  collapsedProjectCwds: Schema.optionalKey(Schema.Array(Schema.String)),
  expandedProjectCwds: Schema.optionalKey(Schema.Array(Schema.String)),
  pinnedThreadKeys: Schema.optionalKey(Schema.Array(Schema.String)),
  projectOrderCwds: Schema.optionalKey(Schema.Array(Schema.String)),
  sidebarThreadFilters: Schema.optionalKey(Schema.Array(Schema.String)),
});
type PersistedUiState = typeof PersistedUiState.Type;
const decodePersistedUiStateOption = Schema.decodeUnknownOption(PersistedUiState);

export interface UiProjectState {
  projectExpandedById: Record<string, boolean>;
  projectOrder: string[];
}

export interface UiThreadState {
  threadLastVisitedAtById: Record<string, string>;
  pinnedThreadKeys: string[];
  sidebarThreadFilters: SidebarThreadFilter[];
}

export interface UiState extends UiProjectState, UiThreadState {}

export interface SyncProjectInput {
  /** Physical project key (environment + cwd). Used for manual sort order. */
  key: string;
  /** Sidebar section state key. Used for expand/collapse state. */
  logicalKey: string;
  cwd: string;
}

export interface SyncThreadInput {
  key: string;
  seedVisitedAt?: string | undefined;
}

const initialState: UiState = {
  projectExpandedById: {},
  projectOrder: [],
  threadLastVisitedAtById: {},
  pinnedThreadKeys: [],
  sidebarThreadFilters: [],
};

const persistedCollapsedProjectCwds = new Set<string>();
const persistedExpandedProjectCwds = new Set<string>();
const persistedProjectOrderCwds: string[] = [];
const currentProjectCwdById = new Map<string, string>();
const currentProjectCwdsByLogicalKey = new Map<string, string[]>();
const currentLogicalKeyByPhysicalKey = new Map<string, string>();

function readPersistedState(): UiState {
  if (typeof window === "undefined") {
    return initialState;
  }
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) {
      return initialState;
    }
    const parsed = Option.getOrElse(decodePersistedUiStateOption(JSON.parse(raw)), () => null);
    if (parsed === null) {
      return initialState;
    }
    hydratePersistedProjectState(parsed);
    return {
      ...initialState,
      pinnedThreadKeys: uniqueNonEmptyStrings(parsed.pinnedThreadKeys ?? []),
      sidebarThreadFilters: sanitizeSidebarThreadFilters(parsed.sidebarThreadFilters ?? []),
    };
  } catch {
    return initialState;
  }
}

function sanitizeSidebarThreadFilters(values: readonly string[]): SidebarThreadFilter[] {
  return uniqueNonEmptyStrings(values).filter((value): value is SidebarThreadFilter =>
    (SIDEBAR_THREAD_FILTERS as readonly string[]).includes(value),
  );
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function hydratePersistedProjectState(parsed: PersistedUiState): void {
  persistedCollapsedProjectCwds.clear();
  persistedExpandedProjectCwds.clear();
  persistedProjectOrderCwds.length = 0;
  for (const cwd of parsed.collapsedProjectCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0) {
      persistedCollapsedProjectCwds.add(cwd);
    }
  }
  for (const cwd of parsed.expandedProjectCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0) {
      persistedExpandedProjectCwds.add(cwd);
    }
  }
  const persistedProjectOrderCwdSet = new Set(persistedProjectOrderCwds);
  for (const cwd of parsed.projectOrderCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0 && !persistedProjectOrderCwdSet.has(cwd)) {
      persistedProjectOrderCwds.push(cwd);
      persistedProjectOrderCwdSet.add(cwd);
    }
  }
}

function persistState(state: UiState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const collapsedProjectCwds = Object.entries(state.projectExpandedById)
      .filter(([, expanded]) => !expanded)
      .flatMap(([logicalKey]) => currentProjectCwdsByLogicalKey.get(logicalKey) ?? []);
    const expandedProjectCwds = Object.entries(state.projectExpandedById)
      .filter(([, expanded]) => expanded)
      .flatMap(([logicalKey]) => currentProjectCwdsByLogicalKey.get(logicalKey) ?? []);
    const projectOrderCwds = state.projectOrder.flatMap((projectId) => {
      const cwd = currentProjectCwdById.get(projectId);
      return cwd ? [cwd] : [];
    });
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        collapsedProjectCwds,
        expandedProjectCwds,
        pinnedThreadKeys: state.pinnedThreadKeys,
        projectOrderCwds,
        sidebarThreadFilters: state.sidebarThreadFilters,
      } satisfies PersistedUiState),
    );
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

function recordsEqual<T>(left: Record<string, T>, right: Record<string, T>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (const [key, value] of leftEntries) {
    if (right[key] !== value) {
      return false;
    }
  }
  return true;
}

function projectOrdersEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((projectId, index) => projectId === right[index])
  );
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function syncProjects(state: UiState, projects: readonly SyncProjectInput[]): UiState {
  const previousProjectCwdById = new Map(currentProjectCwdById);
  const previousProjectIdByCwd = new Map(
    [...previousProjectCwdById.entries()].map(([projectId, cwd]) => [cwd, projectId] as const),
  );
  const previousLogicalKeyByPhysicalKey = new Map(currentLogicalKeyByPhysicalKey);
  currentProjectCwdById.clear();
  currentLogicalKeyByPhysicalKey.clear();
  for (const project of projects) {
    currentProjectCwdById.set(project.key, project.cwd);
    currentLogicalKeyByPhysicalKey.set(project.key, project.logicalKey);
  }
  currentProjectCwdsByLogicalKey.clear();
  const currentProjectCwdSetsByLogicalKey = new Map<string, Set<string>>();
  for (const project of projects) {
    const cwds = currentProjectCwdsByLogicalKey.get(project.logicalKey);
    if (cwds) {
      const cwdSet = currentProjectCwdSetsByLogicalKey.get(project.logicalKey) ?? new Set(cwds);
      if (!cwdSet.has(project.cwd)) {
        cwds.push(project.cwd);
        cwdSet.add(project.cwd);
      }
      currentProjectCwdSetsByLogicalKey.set(project.logicalKey, cwdSet);
    } else {
      currentProjectCwdsByLogicalKey.set(project.logicalKey, [project.cwd]);
      currentProjectCwdSetsByLogicalKey.set(project.logicalKey, new Set([project.cwd]));
    }
  }

  const previousLogicalKeysByNewLogicalKey = new Map<string, Set<string>>();
  for (const project of projects) {
    const previousLogicalKey = previousLogicalKeyByPhysicalKey.get(project.key);
    if (!previousLogicalKey || previousLogicalKey === project.logicalKey) {
      continue;
    }
    const set = previousLogicalKeysByNewLogicalKey.get(project.logicalKey);
    if (set) {
      set.add(previousLogicalKey);
    } else {
      previousLogicalKeysByNewLogicalKey.set(project.logicalKey, new Set([previousLogicalKey]));
    }
  }
  const cwdMappingChanged =
    previousProjectCwdById.size !== currentProjectCwdById.size ||
    projects.some((project) => previousProjectCwdById.get(project.key) !== project.cwd);

  const nextExpandedById: Record<string, boolean> = {};
  const previousExpandedById = state.projectExpandedById;
  const persistedOrderByCwd = new Map(
    persistedProjectOrderCwds.map((cwd, index) => [cwd, index] as const),
  );
  const mappedProjects = projects.map((project, index) => {
    if (!(project.logicalKey in nextExpandedById)) {
      const groupCwds = currentProjectCwdsByLogicalKey.get(project.logicalKey) ?? [project.cwd];
      const previousProjectIdForCwd = previousProjectIdByCwd.get(project.cwd);
      const fallbackFromPreviousLogicalKey = (() => {
        const previousKeys = previousLogicalKeysByNewLogicalKey.get(project.logicalKey);
        if (!previousKeys) {
          return undefined;
        }
        for (const previousKey of previousKeys) {
          if (previousKey in previousExpandedById) {
            return previousExpandedById[previousKey];
          }
        }
        return undefined;
      })();
      const fallbackFromPersistedShape = (() => {
        if (groupCwds.some((cwd) => persistedExpandedProjectCwds.has(cwd))) {
          return true;
        }
        if (groupCwds.some((cwd) => persistedCollapsedProjectCwds.has(cwd))) {
          return false;
        }
        return true;
      })();
      const expanded =
        previousExpandedById[project.logicalKey] ??
        fallbackFromPreviousLogicalKey ??
        (previousProjectIdForCwd ? previousExpandedById[previousProjectIdForCwd] : undefined) ??
        fallbackFromPersistedShape;
      nextExpandedById[project.logicalKey] = expanded;
    }
    return {
      id: project.key,
      cwd: project.cwd,
      incomingIndex: index,
    };
  });

  const nextProjectOrder =
    state.projectOrder.length > 0
      ? (() => {
          const currentProjectIds = new Set(mappedProjects.map((project) => project.id));
          const nextProjectIdByCwd = new Map(
            mappedProjects.map((project) => [project.cwd, project.id] as const),
          );
          const usedProjectIds = new Set<string>();
          const orderedProjectIds: string[] = [];

          for (const projectId of state.projectOrder) {
            const matchedProjectId =
              (currentProjectIds.has(projectId) ? projectId : undefined) ??
              (() => {
                const previousCwd = previousProjectCwdById.get(projectId);
                return previousCwd ? nextProjectIdByCwd.get(previousCwd) : undefined;
              })();
            if (!matchedProjectId || usedProjectIds.has(matchedProjectId)) {
              continue;
            }
            usedProjectIds.add(matchedProjectId);
            orderedProjectIds.push(matchedProjectId);
          }

          for (const project of mappedProjects) {
            if (usedProjectIds.has(project.id)) {
              continue;
            }
            orderedProjectIds.push(project.id);
          }

          return orderedProjectIds;
        })()
      : mappedProjects
          .map((project) => ({
            id: project.id,
            incomingIndex: project.incomingIndex,
            orderIndex:
              persistedOrderByCwd.get(project.cwd) ??
              persistedProjectOrderCwds.length + project.incomingIndex,
          }))
          .toSorted((left, right) => {
            const byOrder = left.orderIndex - right.orderIndex;
            if (byOrder !== 0) {
              return byOrder;
            }
            return left.incomingIndex - right.incomingIndex;
          })
          .map((project) => project.id);

  if (
    recordsEqual(state.projectExpandedById, nextExpandedById) &&
    projectOrdersEqual(state.projectOrder, nextProjectOrder) &&
    !cwdMappingChanged
  ) {
    return state;
  }

  return {
    ...state,
    projectExpandedById: nextExpandedById,
    projectOrder: nextProjectOrder,
  };
}

export function syncThreads(state: UiState, threads: readonly SyncThreadInput[]): UiState {
  const retainedThreadIds = new Set(threads.map((thread) => thread.key));
  const nextThreadLastVisitedAtById = Object.fromEntries(
    Object.entries(state.threadLastVisitedAtById).filter(([threadId]) =>
      retainedThreadIds.has(threadId),
    ),
  );
  const nextPinnedThreadKeys = state.pinnedThreadKeys.filter((threadKey) =>
    retainedThreadIds.has(threadKey),
  );
  for (const thread of threads) {
    if (
      nextThreadLastVisitedAtById[thread.key] === undefined &&
      thread.seedVisitedAt !== undefined &&
      thread.seedVisitedAt.length > 0
    ) {
      nextThreadLastVisitedAtById[thread.key] = thread.seedVisitedAt;
    }
  }
  if (
    recordsEqual(state.threadLastVisitedAtById, nextThreadLastVisitedAtById) &&
    stringArraysEqual(state.pinnedThreadKeys, nextPinnedThreadKeys)
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    pinnedThreadKeys: nextPinnedThreadKeys,
  };
}

export function setThreadPinned(state: UiState, threadId: string, pinned: boolean): UiState {
  const alreadyPinned = state.pinnedThreadKeys.includes(threadId);
  if (alreadyPinned === pinned) {
    return state;
  }
  return {
    ...state,
    pinnedThreadKeys: pinned
      ? [...state.pinnedThreadKeys, threadId]
      : state.pinnedThreadKeys.filter((pinnedThreadId) => pinnedThreadId !== threadId),
  };
}

export function markThreadVisited(state: UiState, threadId: string, visitedAt?: string): UiState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const previousVisitedAt = state.threadLastVisitedAtById[threadId];
  const previousVisitedAtMs = previousVisitedAt ? Date.parse(previousVisitedAt) : NaN;
  if (
    Number.isFinite(previousVisitedAtMs) &&
    Number.isFinite(visitedAtMs) &&
    previousVisitedAtMs >= visitedAtMs
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: at,
    },
  };
}

export function markThreadUnread(
  state: UiState,
  threadId: string,
  latestReadableAt: string | null | undefined,
): UiState {
  if (!latestReadableAt) {
    return state;
  }
  const latestReadableAtMs = Date.parse(latestReadableAt);
  if (Number.isNaN(latestReadableAtMs)) {
    return state;
  }
  const unreadVisitedAt = new Date(latestReadableAtMs - 1).toISOString();
  if (state.threadLastVisitedAtById[threadId] === unreadVisitedAt) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: unreadVisitedAt,
    },
  };
}

export function toggleSidebarThreadFilter(state: UiState, filter: SidebarThreadFilter): UiState {
  const active = state.sidebarThreadFilters.includes(filter);
  return {
    ...state,
    sidebarThreadFilters: active
      ? state.sidebarThreadFilters.filter((current) => current !== filter)
      : [...state.sidebarThreadFilters, filter],
  };
}

export function clearThreadUi(state: UiState, threadId: string): UiState {
  const hasVisitedState = threadId in state.threadLastVisitedAtById;
  const hasPinnedState = state.pinnedThreadKeys.includes(threadId);
  if (!hasVisitedState && !hasPinnedState) {
    return state;
  }
  const nextThreadLastVisitedAtById = { ...state.threadLastVisitedAtById };
  delete nextThreadLastVisitedAtById[threadId];
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    pinnedThreadKeys: state.pinnedThreadKeys.filter(
      (pinnedThreadId) => pinnedThreadId !== threadId,
    ),
  };
}

export function toggleProject(state: UiState, projectId: string): UiState {
  const expanded = state.projectExpandedById[projectId] ?? true;
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: !expanded,
    },
  };
}

export function setProjectExpanded(state: UiState, projectId: string, expanded: boolean): UiState {
  if ((state.projectExpandedById[projectId] ?? true) === expanded) {
    return state;
  }
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: expanded,
    },
  };
}

export function reorderProjects(
  state: UiState,
  draggedProjectIds: readonly string[],
  targetProjectIds: readonly string[],
  insertAfter?: boolean,
): UiState {
  if (insertAfter !== undefined) {
    if (draggedProjectIds.length === 0 || targetProjectIds.length === 0) {
      return state;
    }
    const draggedSet = new Set(draggedProjectIds);
    const targetSet = new Set(targetProjectIds);
    if (draggedProjectIds.every((id) => targetSet.has(id))) {
      return state;
    }

    const remaining: string[] = [];
    const removed: string[] = [];
    for (const projectId of state.projectOrder) {
      if (draggedSet.has(projectId)) {
        removed.push(projectId);
      } else {
        remaining.push(projectId);
      }
    }
    const targetIndex = insertAfter
      ? remaining.findLastIndex((projectId) => targetSet.has(projectId))
      : remaining.findIndex((projectId) => targetSet.has(projectId));
    if (removed.length === 0 || targetIndex < 0) {
      return state;
    }

    const projectOrder = [...remaining];
    projectOrder.splice(targetIndex + (insertAfter ? 1 : 0), 0, ...removed);
    return stringArraysEqual(projectOrder, state.projectOrder) ? state : { ...state, projectOrder };
  }

  if (draggedProjectIds.length === 0) {
    return state;
  }
  const draggedSet = new Set(draggedProjectIds);
  const targetSet = new Set(targetProjectIds);
  if (draggedProjectIds.every((id) => targetSet.has(id))) {
    return state;
  }

  const originalTargetIndex = state.projectOrder.findIndex((id) => targetSet.has(id));
  if (originalTargetIndex < 0) {
    return state;
  }

  const projectOrder = [...state.projectOrder];

  const removed: string[] = [];
  let draggedBeforeTarget = 0;
  for (let i = projectOrder.length - 1; i >= 0; i--) {
    if (draggedSet.has(projectOrder[i]!)) {
      removed.unshift(projectOrder.splice(i, 1)[0]!);
      if (i < originalTargetIndex) {
        draggedBeforeTarget++;
      }
    }
  }
  if (removed.length === 0) {
    return state;
  }

  const insertIndex = originalTargetIndex - Math.max(0, draggedBeforeTarget - 1);
  projectOrder.splice(insertIndex, 0, ...removed);
  return {
    ...state,
    projectOrder,
  };
}

interface UiStateStore extends UiState {
  syncProjects: (projects: readonly SyncProjectInput[]) => void;
  syncThreads: (threads: readonly SyncThreadInput[]) => void;
  markThreadVisited: (threadId: string, visitedAt?: string) => void;
  markThreadUnread: (threadId: string, latestReadableAt: string | null | undefined) => void;
  setThreadPinned: (threadId: string, pinned: boolean) => void;
  toggleSidebarThreadFilter: (filter: SidebarThreadFilter) => void;
  clearThreadUi: (threadId: string) => void;
  toggleProject: (projectId: string) => void;
  setProjectExpanded: (projectId: string, expanded: boolean) => void;
  reorderProjects: (
    draggedProjectIds: readonly string[],
    targetProjectIds: readonly string[],
    insertAfter?: boolean,
  ) => void;
}

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedState(),
  syncProjects: (projects) => set((state) => syncProjects(state, projects)),
  syncThreads: (threads) => set((state) => syncThreads(state, threads)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId, latestReadableAt) =>
    set((state) => markThreadUnread(state, threadId, latestReadableAt)),
  setThreadPinned: (threadId, pinned) => set((state) => setThreadPinned(state, threadId, pinned)),
  toggleSidebarThreadFilter: (filter) => set((state) => toggleSidebarThreadFilter(state, filter)),
  clearThreadUi: (threadId) => set((state) => clearThreadUi(state, threadId)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  reorderProjects: (draggedProjectIds, targetProjectIds, insertAfter) =>
    set((state) => reorderProjects(state, draggedProjectIds, targetProjectIds, insertAfter)),
}));

useUiStateStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
