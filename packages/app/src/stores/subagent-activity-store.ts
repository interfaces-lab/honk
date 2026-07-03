import type { EnvironmentId } from "@honk/shared/environment";
import type { OrchestrationThreadActivity } from "@honk/shared/orchestration";
import type { ThreadId } from "@honk/shared/base-schemas";
import { create } from "zustand";

import {
  deriveWorkLogSubagentsFromOrderedActivities,
  isSubagentTranscriptStreamingActivity,
  type SubagentTranscriptItem,
  type WorkLogSubagent,
  type WorkLogSubagentLog,
} from "../session-logic";
import { isSubagentTrayOpenForThread } from "./subagent-tray-store";

const MAX_SUBAGENT_ACTIVITIES = 500;

interface SubagentProjectionScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

interface SubagentActivityProjection {
  readonly activityIds: string[];
  readonly activityById: Record<string, OrchestrationThreadActivity>;
  readonly subagentById: Record<string, WorkLogSubagent>;
}

interface SubagentActivityStore {
  readonly projectionByThreadKey: Record<string, SubagentActivityProjection>;
  replaceActivities: (
    scope: SubagentProjectionScope,
    activities: ReadonlyArray<OrchestrationThreadActivity>,
  ) => void;
  upsertActivities: (
    scope: SubagentProjectionScope,
    activities: ReadonlyArray<OrchestrationThreadActivity>,
  ) => void;
  removeThread: (scope: SubagentProjectionScope) => void;
  retainThreadsForEnvironment: (
    environmentId: EnvironmentId,
    threadIds: ReadonlySet<ThreadId>,
  ) => void;
  refreshProjection: (scope: SubagentProjectionScope) => void;
  reset: () => void;
}

const EMPTY_ACTIVITY_BY_ID: Record<string, OrchestrationThreadActivity> = {};
const EMPTY_SUBAGENT_BY_ID: Record<string, WorkLogSubagent> = {};

const EMPTY_PROJECTION: SubagentActivityProjection = {
  activityIds: [],
  activityById: EMPTY_ACTIVITY_BY_ID,
  subagentById: EMPTY_SUBAGENT_BY_ID,
};

export function subagentActivityThreadKey(scope: SubagentProjectionScope): string {
  return `${scope.environmentId}\u001f${scope.threadId}`;
}

interface PendingSubagentUpsert {
  readonly scope: SubagentProjectionScope;
  activities: OrchestrationThreadActivity[];
}

const pendingSubagentUpsertsByKey = new Map<string, PendingSubagentUpsert>();
let subagentUpsertFlushHandle: number | null = null;

type SubagentActivityStoreSetter = (
  partial:
    | SubagentActivityStore
    | Partial<SubagentActivityStore>
    | ((state: SubagentActivityStore) => SubagentActivityStore | Partial<SubagentActivityStore>),
) => void;

function queueSubagentActivitiesUpsert(
  scope: SubagentProjectionScope,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  set: SubagentActivityStoreSetter,
): void {
  const key = subagentActivityThreadKey(scope);
  const pending = pendingSubagentUpsertsByKey.get(key);
  if (pending) {
    pending.activities.push(...activities);
  } else {
    pendingSubagentUpsertsByKey.set(key, {
      scope,
      activities: [...activities],
    });
  }
  if (subagentUpsertFlushHandle !== null) {
    return;
  }
  if (typeof requestAnimationFrame !== "function") {
    flushQueuedSubagentActivitiesUpserts(set);
    return;
  }
  subagentUpsertFlushHandle = requestAnimationFrame(() => {
    subagentUpsertFlushHandle = null;
    flushQueuedSubagentActivitiesUpserts(set);
  });
}

function flushQueuedSubagentActivitiesUpserts(set: SubagentActivityStoreSetter): void {
  const queued = [...pendingSubagentUpsertsByKey.values()];
  pendingSubagentUpsertsByKey.clear();
  if (queued.length === 0) {
    return;
  }

  set((state) => {
    let projectionByThreadKey = state.projectionByThreadKey;
    let stateChanged = false;

    for (const { scope, activities } of queued) {
      const key = subagentActivityThreadKey(scope);
      const previousProjection = projectionByThreadKey[key] ?? EMPTY_PROJECTION;
      const changedReplacements = filterChangedSubagentActivityReplacements(
        previousProjection,
        dedupeSubagentActivitiesById(activities),
      );
      if (changedReplacements.length === 0) {
        continue;
      }
      const projectionOptions = subagentProjectionOptionsForScope(scope);
      const nextProjection = reduceSubagentActivityProjection(
        previousProjection,
        changedReplacements,
        projectionOptions,
      );
      if (nextProjection === previousProjection) {
        continue;
      }
      if (!stateChanged) {
        projectionByThreadKey = { ...state.projectionByThreadKey };
        stateChanged = true;
      }
      projectionByThreadKey[key] = nextProjection;
    }

    if (!stateChanged) {
      return state;
    }
    return {
      ...state,
      projectionByThreadKey,
    };
  });
}

export const useSubagentActivityStore = create<SubagentActivityStore>((set) => ({
  projectionByThreadKey: {},
  replaceActivities: (scope, activities) => {
    const key = subagentActivityThreadKey(scope);
    set((state) => {
      const previousProjection = state.projectionByThreadKey[key];
      if (activities.length === 0) {
        if (!previousProjection) {
          return state;
        }
        const { [key]: _removedProjection, ...projectionByThreadKey } = state.projectionByThreadKey;
        return {
          ...state,
          projectionByThreadKey,
        };
      }

      const nextProjection = replaceSubagentActivityProjection(
        previousProjection ?? EMPTY_PROJECTION,
        activities,
        subagentProjectionOptionsForScope(scope),
      );
      if (previousProjection && nextProjection === previousProjection) {
        return state;
      }
      return {
        ...state,
        projectionByThreadKey: {
          ...state.projectionByThreadKey,
          [key]: nextProjection,
        },
      };
    });
  },
  upsertActivities: (scope, activities) => {
    if (activities.length === 0) {
      return;
    }
    queueSubagentActivitiesUpsert(scope, activities, set);
  },
  refreshProjection: (scope) => {
    if (pendingSubagentUpsertsByKey.size > 0) {
      if (subagentUpsertFlushHandle !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(subagentUpsertFlushHandle);
      }
      subagentUpsertFlushHandle = null;
      flushQueuedSubagentActivitiesUpserts(set);
    }
    const key = subagentActivityThreadKey(scope);
    set((state) => {
      const previousProjection = state.projectionByThreadKey[key];
      if (!previousProjection) {
        return state;
      }
      const activities = previousProjection.activityIds
        .map((id) => previousProjection.activityById[id])
        .filter((activity): activity is OrchestrationThreadActivity => Boolean(activity));
      const nextProjection = projectionFromOrderedActivities(previousProjection, activities, {
        includeTranscript: true,
        reprojectAllSubagents: true,
      });
      if (nextProjection === previousProjection) {
        return state;
      }
      return {
        ...state,
        projectionByThreadKey: {
          ...state.projectionByThreadKey,
          [key]: nextProjection,
        },
      };
    });
  },
  removeThread: (scope) => {
    const key = subagentActivityThreadKey(scope);
    set((state) => {
      if (!state.projectionByThreadKey[key]) {
        return state;
      }
      const { [key]: _removedProjection, ...projectionByThreadKey } = state.projectionByThreadKey;
      return {
        ...state,
        projectionByThreadKey,
      };
    });
  },
  retainThreadsForEnvironment: (environmentId, threadIds) => {
    set((state) => {
      let changed = false;
      const entries = Object.entries(state.projectionByThreadKey).filter(([key]) => {
        const [entryEnvironmentId, entryThreadId] = key.split("\u001f", 2);
        const retain =
          entryEnvironmentId !== environmentId || threadIds.has((entryThreadId ?? "") as ThreadId);
        changed ||= !retain;
        return retain;
      });
      if (!changed) {
        return state;
      }
      return {
        ...state,
        projectionByThreadKey: Object.fromEntries(entries) as Record<
          string,
          SubagentActivityProjection
        >,
      };
    });
  },
  reset: () => set({ projectionByThreadKey: {} }),
}));

export function selectSubagentProjection(
  state: Pick<SubagentActivityStore, "projectionByThreadKey">,
  scope: SubagentProjectionScope,
): SubagentActivityProjection {
  return state.projectionByThreadKey[subagentActivityThreadKey(scope)] ?? EMPTY_PROJECTION;
}

export function refreshSubagentActivityProjection(scope: SubagentProjectionScope): void {
  useSubagentActivityStore.getState().refreshProjection(scope);
}

interface SubagentProjectionOptions {
  readonly includeTranscript: boolean;
  readonly reprojectAllSubagents?: boolean;
}

function subagentProjectionOptionsForScope(
  scope: SubagentProjectionScope,
): SubagentProjectionOptions {
  return {
    includeTranscript: isSubagentTrayOpenForThread(scope),
  };
}

function isSubagentMetadataProjectionActivity(activity: OrchestrationThreadActivity): boolean {
  return (
    activity.kind === "subagent.thread.started" ||
    activity.kind === "subagent.thread.state.changed" ||
    activity.kind === "subagent.usage.updated"
  );
}

function dedupeSubagentActivitiesById(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationThreadActivity[] {
  const byId = new Map<string, OrchestrationThreadActivity>();
  for (const activity of activities) {
    byId.set(activity.id, activity);
  }
  return [...byId.values()];
}

function filterChangedSubagentActivityReplacements(
  previous: SubagentActivityProjection,
  replacements: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationThreadActivity[] {
  const changed: OrchestrationThreadActivity[] = [];
  for (const replacement of replacements) {
    const previousActivity = previous.activityById[replacement.id];
    if (!previousActivity || !subagentActivitiesEqual(previousActivity, replacement)) {
      changed.push(replacement);
    }
  }
  return changed;
}

function reduceSubagentActivityProjection(
  previous: SubagentActivityProjection,
  replacements: ReadonlyArray<OrchestrationThreadActivity>,
  options: SubagentProjectionOptions,
): SubagentActivityProjection {
  const currentActivities = previous.activityIds
    .map((id) => previous.activityById[id])
    .filter((activity): activity is OrchestrationThreadActivity => Boolean(activity));
  const nextActivities = upsertSubagentActivities(currentActivities, replacements);
  if (nextActivities === currentActivities) {
    return previous;
  }
  const introducesNewActivity = replacements.some(
    (replacement) => !previous.activityById[replacement.id],
  );
  const cacheOnly =
    !options.includeTranscript &&
    !introducesNewActivity &&
    !replacements.some((activity) => isSubagentMetadataProjectionActivity(activity)) &&
    replacements.every(
      (activity) =>
        isSubagentTranscriptStreamingActivity(activity) ||
        activity.kind === "subagent.thread.started",
    );
  if (cacheOnly) {
    return mergeSubagentActivityCache(previous, nextActivities);
  }
  return projectionFromOrderedActivities(previous, nextActivities, options);
}

function replaceSubagentActivityProjection(
  previous: SubagentActivityProjection,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  options: SubagentProjectionOptions,
): SubagentActivityProjection {
  const nextActivities = upsertSubagentActivities([], activities);
  return projectionFromOrderedActivities(previous, nextActivities, options);
}

function mergeSubagentActivityCache(
  previous: SubagentActivityProjection,
  nextActivities: ReadonlyArray<OrchestrationThreadActivity>,
): SubagentActivityProjection {
  const nextActivityIds = nextActivities.map((activity) => activity.id);
  const nextActivityById = Object.fromEntries(
    nextActivities.map((activity) => [activity.id, activity] as const),
  ) as Record<string, OrchestrationThreadActivity>;
  if (
    arraysEqual(previous.activityIds, nextActivityIds) &&
    activitiesByIdEqual(previous.activityById, nextActivityById)
  ) {
    return previous;
  }
  return {
    activityIds: nextActivityIds,
    activityById: nextActivityById,
    subagentById: previous.subagentById,
  };
}

function projectionFromOrderedActivities(
  previous: SubagentActivityProjection,
  nextActivities: ReadonlyArray<OrchestrationThreadActivity>,
  options: SubagentProjectionOptions,
): SubagentActivityProjection {
  const nextActivityIds = nextActivities.map((activity) => activity.id);
  const nextActivityById = Object.fromEntries(
    nextActivities.map((activity) => [activity.id, activity] as const),
  ) as Record<string, OrchestrationThreadActivity>;
  const affectedSubagentThreadIds = options.reprojectAllSubagents
    ? allSubagentThreadIdsInActivities(nextActivities)
    : affectedSubagentThreadIdsForProjection(previous, nextActivityIds, nextActivityById);
  const nextSubagentById =
    affectedSubagentThreadIds.size === 0
      ? previous.subagentById
      : projectAffectedSubagents(
          previous.subagentById,
          nextActivities,
          affectedSubagentThreadIds,
          options,
        );

  if (
    arraysEqual(previous.activityIds, nextActivityIds) &&
    activitiesByIdEqual(previous.activityById, nextActivityById) &&
    subagentsByIdEqual(previous.subagentById, nextSubagentById)
  ) {
    return previous;
  }

  return {
    activityIds: nextActivityIds,
    activityById: nextActivityById,
    subagentById: nextSubagentById,
  };
}

function allSubagentThreadIdsInActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): Set<string> {
  const affected = new Set<string>();
  for (const activity of activities) {
    addSubagentThreadId(affected, activity);
  }
  return affected;
}

function affectedSubagentThreadIdsForProjection(
  previous: SubagentActivityProjection,
  nextActivityIds: ReadonlyArray<string>,
  nextActivityById: Record<string, OrchestrationThreadActivity>,
): Set<string> {
  const affected = new Set<string>();
  const nextIds = new Set(nextActivityIds);

  for (const previousId of previous.activityIds) {
    const previousActivity = previous.activityById[previousId];
    const nextActivity = nextActivityById[previousId];
    if (!previousActivity) {
      continue;
    }
    if (!nextIds.has(previousId) || !nextActivity) {
      addSubagentThreadId(affected, previousActivity);
      continue;
    }
    if (!subagentActivitiesEqual(previousActivity, nextActivity)) {
      addSubagentThreadId(affected, previousActivity);
      addSubagentThreadId(affected, nextActivity);
    }
  }

  for (const nextId of nextActivityIds) {
    if (!previous.activityById[nextId]) {
      addSubagentThreadId(affected, nextActivityById[nextId]);
    }
  }

  return affected;
}

function projectAffectedSubagents(
  previousSubagents: Record<string, WorkLogSubagent>,
  nextActivities: ReadonlyArray<OrchestrationThreadActivity>,
  affectedSubagentThreadIds: ReadonlySet<string>,
  options: SubagentProjectionOptions,
): Record<string, WorkLogSubagent> {
  const affectedActivities = nextActivities.filter((activity) => {
    const subagentThreadId = subagentThreadIdFromActivity(activity);
    return subagentThreadId !== null && affectedSubagentThreadIds.has(subagentThreadId);
  });
  const derivedSubagents = deriveWorkLogSubagentsFromOrderedActivities(affectedActivities, {
    includeTranscript: options.includeTranscript,
  });
  let nextSubagents = previousSubagents;

  for (const subagentThreadId of affectedSubagentThreadIds) {
    const previousSubagent = previousSubagents[subagentThreadId];
    const derivedSubagent = derivedSubagents.get(subagentThreadId);
    if (!derivedSubagent) {
      if (previousSubagent) {
        if (nextSubagents === previousSubagents) {
          nextSubagents = { ...previousSubagents };
        }
        delete nextSubagents[subagentThreadId];
      }
      continue;
    }

    const stableSubagent = stableWorkLogSubagent(previousSubagent, derivedSubagent, options);
    if (stableSubagent !== previousSubagent) {
      if (nextSubagents === previousSubagents) {
        nextSubagents = { ...previousSubagents };
      }
      nextSubagents[subagentThreadId] = stableSubagent;
    }
  }

  return nextSubagents;
}

function addSubagentThreadId(
  set: Set<string>,
  activity: OrchestrationThreadActivity | undefined,
): void {
  const subagentThreadId = activity ? subagentThreadIdFromActivity(activity) : null;
  if (subagentThreadId) {
    set.add(subagentThreadId);
  }
}

function subagentThreadIdFromActivity(activity: OrchestrationThreadActivity): string | null {
  const payload = activity.payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const value = (payload as Record<string, unknown>).subagentThreadId;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function upsertSubagentActivities(
  current: ReadonlyArray<OrchestrationThreadActivity>,
  replacements: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<OrchestrationThreadActivity> {
  let next = current;
  for (const replacement of replacements) {
    next = upsertSubagentActivity(next, replacement);
  }
  if (next === current) {
    return current;
  }
  const capped =
    next.length > MAX_SUBAGENT_ACTIVITIES ? next.slice(-MAX_SUBAGENT_ACTIVITIES) : next;
  return capped;
}

function upsertSubagentActivity(
  current: ReadonlyArray<OrchestrationThreadActivity>,
  replacement: OrchestrationThreadActivity,
): ReadonlyArray<OrchestrationThreadActivity> {
  const existingIndex = current.findIndex((activity) => activity.id === replacement.id);
  if (existingIndex >= 0) {
    const existing = current[existingIndex];
    if (
      existing &&
      subagentActivitiesEqual(existing, replacement) &&
      isActivityOrderedAt(current, existingIndex, replacement)
    ) {
      return current;
    }
    if (isActivityOrderedAt(current, existingIndex, replacement)) {
      const next = [...current];
      next[existingIndex] = replacement;
      return next;
    }
  }

  const withoutExisting =
    existingIndex >= 0
      ? [...current.slice(0, existingIndex), ...current.slice(existingIndex + 1)]
      : [...current];
  const insertIndex = activityInsertIndex(withoutExisting, replacement);
  withoutExisting.splice(insertIndex, 0, replacement);
  return withoutExisting;
}

function isActivityOrderedAt(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  index: number,
  activity: OrchestrationThreadActivity,
): boolean {
  const previous = activities[index - 1];
  const next = activities[index + 1];
  return (
    (previous === undefined || compareActivities(previous, activity) <= 0) &&
    (next === undefined || compareActivities(activity, next) <= 0)
  );
}

function activityInsertIndex(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  activity: OrchestrationThreadActivity,
): number {
  let low = 0;
  let high = activities.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = activities[mid];
    if (candidate && compareActivities(candidate, activity) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function compareActivities(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function stableWorkLogSubagent(
  previous: WorkLogSubagent | undefined,
  next: WorkLogSubagent,
  options: SubagentProjectionOptions,
): WorkLogSubagent {
  if (!previous) {
    return next;
  }
  const logs = stableSubagentLogs(previous.logs, next.logs);
  const transcriptItems = options.includeTranscript
    ? stableSubagentTranscriptItems(previous.transcriptItems, next.transcriptItems)
    : previous.transcriptItems;
  const stableNext: WorkLogSubagent =
    logs === next.logs && transcriptItems === next.transcriptItems
      ? next
      : {
          ...next,
          ...(logs !== next.logs ? { logs } : {}),
          ...(transcriptItems !== next.transcriptItems ? { transcriptItems } : {}),
        };
  const preservedTranscript =
    !options.includeTranscript && previous.transcriptItems
      ? {
          transcriptItems: previous.transcriptItems,
          hasDetails: stableNext.hasDetails || previous.transcriptItems.length > 0,
        }
      : null;
  const mergedNext = preservedTranscript ? { ...stableNext, ...preservedTranscript } : stableNext;
  return areSameWorkLogSubagent(previous, mergedNext) ? previous : mergedNext;
}

function areSameWorkLogSubagent(previous: WorkLogSubagent, next: WorkLogSubagent): boolean {
  return (
    previous.threadId === next.threadId &&
    previous.subagentThreadId === next.subagentThreadId &&
    previous.parentItemId === next.parentItemId &&
    previous.resolvedThreadId === next.resolvedThreadId &&
    previous.agentId === next.agentId &&
    previous.nickname === next.nickname &&
    previous.role === next.role &&
    previous.model === next.model &&
    previous.prompt === next.prompt &&
    previous.rawStatus === next.rawStatus &&
    previous.latestUpdate === next.latestUpdate &&
    previous.title === next.title &&
    previous.statusLabel === next.statusLabel &&
    previous.isActive === next.isActive &&
    previous.usedTokens === next.usedTokens &&
    previous.maxTokens === next.maxTokens &&
    previous.usedPercentage === next.usedPercentage &&
    previous.hasDetails === next.hasDetails &&
    areSameSubagentLogs(previous.logs, next.logs) &&
    areSameSubagentTranscriptItems(previous.transcriptItems, next.transcriptItems)
  );
}

function areSameSubagentLogs(
  previous: ReadonlyArray<WorkLogSubagentLog> | undefined,
  next: ReadonlyArray<WorkLogSubagentLog> | undefined,
): boolean {
  if (previous === next) {
    return true;
  }
  if (!previous || !next || previous.length !== next.length) {
    return false;
  }
  return previous.every((previousLog, index) => areSameSubagentLog(previousLog, next[index]));
}

function areSameSubagentTranscriptItems(
  previous: ReadonlyArray<SubagentTranscriptItem> | undefined,
  next: ReadonlyArray<SubagentTranscriptItem> | undefined,
): boolean {
  if (previous === next) {
    return true;
  }
  if (!previous || !next || previous.length !== next.length) {
    return false;
  }
  return previous.every((previousItem, index) => {
    return areSameSubagentTranscriptItem(previousItem, next[index]);
  });
}

function stableSubagentLogs(
  previous: ReadonlyArray<WorkLogSubagentLog> | undefined,
  next: ReadonlyArray<WorkLogSubagentLog> | undefined,
): ReadonlyArray<WorkLogSubagentLog> | undefined {
  if (previous === next || !previous || !next || previous.length !== next.length) {
    return next;
  }
  let changed = false;
  const stable = next.map((nextLog, index) => {
    const previousLog = previous[index];
    if (areSameSubagentLog(previousLog, nextLog)) {
      return previousLog;
    }
    changed = true;
    return nextLog;
  });
  return changed ? stable : previous;
}

function stableSubagentTranscriptItems(
  previous: ReadonlyArray<SubagentTranscriptItem> | undefined,
  next: ReadonlyArray<SubagentTranscriptItem> | undefined,
): ReadonlyArray<SubagentTranscriptItem> | undefined {
  if (previous === next || !previous || !next || previous.length !== next.length) {
    return next;
  }
  let changed = false;
  const stable = next.map((nextItem, index) => {
    const previousItem = previous[index];
    if (areSameSubagentTranscriptItem(previousItem, nextItem)) {
      return previousItem;
    }
    changed = true;
    return nextItem;
  });
  return changed ? stable : previous;
}

function areSameSubagentLog(
  previous: WorkLogSubagentLog | undefined,
  next: WorkLogSubagentLog | undefined,
): previous is WorkLogSubagentLog {
  return (
    previous !== undefined &&
    next !== undefined &&
    previous.id === next.id &&
    previous.createdAt === next.createdAt &&
    previous.kind === next.kind &&
    previous.label === next.label &&
    previous.itemId === next.itemId &&
    previous.detail === next.detail &&
    previous.streamKind === next.streamKind &&
    previous.itemType === next.itemType &&
    previous.status === next.status
  );
}

function areSameSubagentTranscriptItem(
  previous: SubagentTranscriptItem | undefined,
  next: SubagentTranscriptItem | undefined,
): previous is SubagentTranscriptItem {
  return (
    previous !== undefined &&
    next !== undefined &&
    previous.id === next.id &&
    previous.itemId === next.itemId &&
    previous.kind === next.kind &&
    previous.role === next.role &&
    previous.title === next.title &&
    previous.text === next.text &&
    previous.command === next.command &&
    previous.rawCommand === next.rawCommand &&
    previous.output === next.output &&
    arraysEqual(previous.changedFiles ?? [], next.changedFiles ?? []) &&
    previous.itemType === next.itemType &&
    previous.status === next.status &&
    previous.streamKind === next.streamKind &&
    previous.loading === next.loading &&
    previous.createdAt === next.createdAt &&
    previous.sequence === next.sequence
  );
}

function subagentsByIdEqual(
  previous: Record<string, WorkLogSubagent>,
  next: Record<string, WorkLogSubagent>,
): boolean {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  return (
    previousKeys.length === nextKeys.length &&
    previousKeys.every((key) => previous[key] === next[key])
  );
}

function activitiesByIdEqual(
  previous: Record<string, OrchestrationThreadActivity>,
  next: Record<string, OrchestrationThreadActivity>,
): boolean {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  return (
    previousKeys.length === nextKeys.length &&
    previousKeys.every((key) => {
      const previousActivity = previous[key];
      const nextActivity = next[key];
      return (
        previousActivity !== undefined &&
        nextActivity !== undefined &&
        subagentActivitiesEqual(previousActivity, nextActivity)
      );
    })
  );
}

function subagentActivitiesEqual(
  previous: OrchestrationThreadActivity,
  next: OrchestrationThreadActivity,
): boolean {
  return (
    previous.id === next.id &&
    previous.kind === next.kind &&
    previous.tone === next.tone &&
    previous.summary === next.summary &&
    previous.turnId === next.turnId &&
    previous.sequence === next.sequence &&
    previous.createdAt === next.createdAt &&
    valuesEqual(previous.payload, next.payload)
  );
}

function arraysEqual<T>(left: ReadonlyArray<T>, right: ReadonlyArray<T>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
