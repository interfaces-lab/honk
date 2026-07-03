import type { MessageId } from "@honk/shared/base-schemas";
import type { OrchestrationThreadActivity } from "@honk/shared/orchestration";
import type { ScopedProjectRef, ScopedThreadRef } from "@honk/shared/environment";
import type { ThreadId } from "@honk/shared/base-schemas";
import { selectEnvironmentState, type AppState, type EnvironmentState } from "./thread-store";
import {
  type ChatMessage,
  type Project,
  type ProposedPlan,
  type Thread,
  type ThreadSession,
  type ThreadShell,
  type ThreadTurnState,
} from "../types";
import { getThreadFromEnvironmentState } from "../thread-derivation";

export function createProjectSelectorByRef(
  ref: ScopedProjectRef | null | undefined,
): (state: AppState) => Project | undefined {
  return (state) =>
    ref ? selectEnvironmentState(state, ref.environmentId).projectById[ref.projectId] : undefined;
}

function createScopedThreadSelector(
  resolveRef: (state: AppState) => ScopedThreadRef | null | undefined,
): (state: AppState) => Thread | undefined {
  let previousEnvironmentState: EnvironmentState | undefined;
  let previousThreadId: ThreadId | undefined;
  let previousThread: Thread | undefined;

  return (state) => {
    const ref = resolveRef(state);
    if (!ref) {
      previousEnvironmentState = undefined;
      previousThreadId = undefined;
      previousThread = undefined;
      return undefined;
    }

    const environmentState = selectEnvironmentState(state, ref.environmentId);
    const shell = environmentState.threadShellById[ref.threadId];
    if (
      previousThread &&
      previousEnvironmentState === environmentState &&
      previousThreadId === ref.threadId &&
      shell
    ) {
      return previousThread;
    }

    previousEnvironmentState = environmentState;
    previousThreadId = ref.threadId;
    previousThread = shell
      ? getThreadFromEnvironmentState(environmentState, ref.threadId)
      : undefined;
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

export interface ThreadWorkspaceSurface extends Pick<
  ThreadShell,
  | "id"
  | "environmentId"
  | "projectId"
  | "title"
  | "modelSelection"
  | "runtimeMode"
  | "interactionMode"
  | "createdAt"
  | "branch"
  | "worktreePath"
> {
  readonly session: ThreadSession | null;
  readonly latestTurn: ThreadTurnState["latestTurn"];
}

export interface ThreadPlanSurface {
  readonly id: ThreadId;
  readonly environmentId: ScopedThreadRef["environmentId"];
  readonly planActivities: OrchestrationThreadActivity[];
  readonly proposedPlans: ProposedPlan[];
}

export interface ThreadGitAgentSurface {
  readonly id: ThreadId;
  readonly environmentId: ScopedThreadRef["environmentId"];
  readonly session: ThreadSession | null;
  readonly latestTurn: ThreadTurnState["latestTurn"];
  readonly latestUserMessage: Pick<ChatMessage, "id" | "text" | "createdAt"> | null;
  readonly userMessageIds: readonly MessageId[];
  readonly startFailureActivities: readonly OrchestrationThreadActivity[];
}

export interface ThreadRouteLifecycleSurface {
  readonly id: ThreadId;
  readonly environmentId: ScopedThreadRef["environmentId"];
  readonly hasStarted: boolean;
  readonly hasRenderableUserStart: boolean;
}

const EMPTY_PROPOSED_PLANS: ProposedPlan[] = [];
const EMPTY_PLAN_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_START_FAILURE_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_USER_MESSAGE_IDS: MessageId[] = [];

const collectedByIdsCache = new WeakMap<readonly string[], WeakMap<object, unknown[]>>();

interface FilteredActivityCacheEntry {
  readonly activities: OrchestrationThreadActivity[];
}

interface UserMessageCacheEntry {
  readonly ids: readonly MessageId[];
  readonly latest: Pick<ChatMessage, "id" | "text" | "createdAt"> | null;
}

const planActivitiesByThreadKey = new Map<string, FilteredActivityCacheEntry>();
const startFailureActivitiesByThreadKey = new Map<string, FilteredActivityCacheEntry>();
const userMessagesByThreadKey = new Map<string, UserMessageCacheEntry>();

function collectByIds<TKey extends string, TValue>(
  ids: readonly TKey[] | undefined,
  byId: Record<TKey, TValue> | undefined,
  emptyValue: TValue[],
): TValue[] {
  if (!ids || ids.length === 0 || !byId) {
    return emptyValue;
  }

  let byIdCache = collectedByIdsCache.get(ids);
  if (!byIdCache) {
    byIdCache = new WeakMap<object, unknown[]>();
    collectedByIdsCache.set(ids, byIdCache);
  }
  const cached = byIdCache.get(byId);
  if (cached) {
    return cached as TValue[];
  }

  const collected = ids.flatMap((id) => {
    const value = byId[id];
    return value ? [value] : [];
  });
  byIdCache.set(byId, collected);
  return collected;
}

function threadCacheKey(ref: ScopedThreadRef): string {
  return `${ref.environmentId}\0${ref.threadId}`;
}

function sameActivityList(
  left: readonly OrchestrationThreadActivity[],
  right: readonly OrchestrationThreadActivity[],
): boolean {
  return left.length === right.length && left.every((activity, index) => activity === right[index]);
}

function selectFilteredActivities(input: {
  environmentState: EnvironmentState;
  threadRef: ScopedThreadRef;
  cache: Map<string, FilteredActivityCacheEntry>;
  emptyValue: OrchestrationThreadActivity[];
  predicate: (activity: OrchestrationThreadActivity) => boolean;
}): OrchestrationThreadActivity[] {
  const ids = input.environmentState.activityIdsByThreadId[input.threadRef.threadId];
  const byId = input.environmentState.activityByThreadId[input.threadRef.threadId];
  if (!ids || ids.length === 0 || !byId) {
    return input.emptyValue;
  }

  const selected = ids.flatMap((id) => {
    const activity = byId[id];
    return activity && input.predicate(activity) ? [activity] : [];
  });
  if (selected.length === 0) {
    return input.emptyValue;
  }

  const key = threadCacheKey(input.threadRef);
  const cached = input.cache.get(key);
  if (cached && sameActivityList(cached.activities, selected)) {
    return cached.activities;
  }

  input.cache.set(key, { activities: selected });
  return selected;
}

function sameMessageIds(left: readonly MessageId[], right: readonly MessageId[]): boolean {
  return (
    left.length === right.length && left.every((messageId, index) => messageId === right[index])
  );
}

function selectUserMessages(input: {
  environmentState: EnvironmentState;
  threadRef: ScopedThreadRef;
}): UserMessageCacheEntry {
  const ids = input.environmentState.messageIdsByThreadId[input.threadRef.threadId];
  const byId = input.environmentState.messageByThreadId[input.threadRef.threadId];
  if (!ids || ids.length === 0 || !byId) {
    return { ids: EMPTY_USER_MESSAGE_IDS, latest: null };
  }

  const userMessageIds: MessageId[] = [];
  let latest: Pick<ChatMessage, "id" | "text" | "createdAt"> | null = null;
  for (const messageId of ids) {
    const message = byId[messageId];
    if (message?.role !== "user") {
      continue;
    }
    userMessageIds.push(message.id);
    latest = {
      id: message.id,
      text: message.text,
      createdAt: message.createdAt,
    };
  }

  if (!latest) {
    return { ids: EMPTY_USER_MESSAGE_IDS, latest: null };
  }

  const key = threadCacheKey(input.threadRef);
  const cached = userMessagesByThreadKey.get(key);
  if (
    cached &&
    cached.latest?.id === latest.id &&
    cached.latest.text === latest.text &&
    cached.latest.createdAt === latest.createdAt &&
    sameMessageIds(cached.ids, userMessageIds)
  ) {
    return cached;
  }

  const next = { ids: userMessageIds, latest };
  userMessagesByThreadKey.set(key, next);
  return next;
}

function resolveThreadRefAcrossEnvironments(
  state: AppState,
  threadId: ThreadId | null | undefined,
): ScopedThreadRef | null {
  if (!threadId) {
    return null;
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
  return null;
}

function chatMessageHasRenderableContent(message: ChatMessage): boolean {
  return (
    message.text.trim().length > 0 ||
    message.richText !== undefined ||
    (message.attachments?.length ?? 0) > 0
  );
}

function selectThreadHasRenderableUserStart(state: EnvironmentState, threadId: ThreadId): boolean {
  const messageIds = state.messageIdsByThreadId[threadId];
  const messagesById = state.messageByThreadId[threadId];
  if (!messageIds || !messagesById) {
    return false;
  }

  return messageIds.some((messageId) => {
    const message = messagesById[messageId];
    return message?.role === "user" && chatMessageHasRenderableContent(message);
  });
}

export function selectThreadRouteLifecycleSurfaceByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): ThreadRouteLifecycleSurface | undefined {
  if (!ref) {
    return undefined;
  }

  const environmentState = selectEnvironmentState(state, ref.environmentId);
  const shell = environmentState.threadShellById[ref.threadId];
  if (!shell) {
    return undefined;
  }

  const latestTurn = environmentState.threadTurnStateById[ref.threadId]?.latestTurn ?? null;
  const messageCount = environmentState.messageIdsByThreadId[ref.threadId]?.length ?? 0;

  return {
    id: shell.id,
    environmentId: shell.environmentId,
    hasStarted:
      latestTurn !== null ||
      messageCount > 0 ||
      (environmentState.threadSessionById[ref.threadId] ?? null) !== null,
    hasRenderableUserStart: selectThreadHasRenderableUserStart(environmentState, ref.threadId),
  };
}

export function selectThreadRouteLifecycleSurfaceAcrossEnvironments(
  state: AppState,
  threadId: ThreadId | null | undefined,
): ThreadRouteLifecycleSurface | undefined {
  return selectThreadRouteLifecycleSurfaceByRef(
    state,
    resolveThreadRefAcrossEnvironments(state, threadId),
  );
}

export function selectThreadWorkspaceSurfaceByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): ThreadWorkspaceSurface | undefined {
  if (!ref) {
    return undefined;
  }

  const environmentState = selectEnvironmentState(state, ref.environmentId);
  const shell = environmentState.threadShellById[ref.threadId];
  if (!shell) {
    return undefined;
  }

  return {
    id: shell.id,
    environmentId: shell.environmentId,
    projectId: shell.projectId,
    title: shell.title,
    modelSelection: shell.modelSelection,
    runtimeMode: shell.runtimeMode,
    interactionMode: shell.interactionMode,
    createdAt: shell.createdAt,
    branch: shell.branch,
    worktreePath: shell.worktreePath,
    session: environmentState.threadSessionById[ref.threadId] ?? null,
    latestTurn: environmentState.threadTurnStateById[ref.threadId]?.latestTurn ?? null,
  };
}

export function selectThreadPlanSurfaceByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): ThreadPlanSurface | undefined {
  if (!ref) {
    return undefined;
  }

  const environmentState = selectEnvironmentState(state, ref.environmentId);
  const shell = environmentState.threadShellById[ref.threadId];
  if (!shell) {
    return undefined;
  }

  return {
    id: shell.id,
    environmentId: shell.environmentId,
    planActivities: selectFilteredActivities({
      environmentState,
      threadRef: ref,
      cache: planActivitiesByThreadKey,
      emptyValue: EMPTY_PLAN_ACTIVITIES,
      predicate: (activity) => activity.kind === "turn.plan.updated",
    }),
    proposedPlans: collectByIds(
      environmentState.proposedPlanIdsByThreadId[ref.threadId],
      environmentState.proposedPlanByThreadId[ref.threadId],
      EMPTY_PROPOSED_PLANS,
    ),
  };
}

export function selectThreadPlanSurfaceAcrossEnvironments(
  state: AppState,
  threadId: ThreadId | null | undefined,
): ThreadPlanSurface | undefined {
  return selectThreadPlanSurfaceByRef(state, resolveThreadRefAcrossEnvironments(state, threadId));
}

export function selectThreadGitAgentSurfaceByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): ThreadGitAgentSurface | undefined {
  if (!ref) {
    return undefined;
  }

  const environmentState = selectEnvironmentState(state, ref.environmentId);
  const shell = environmentState.threadShellById[ref.threadId];
  if (!shell) {
    return undefined;
  }

  const userMessages = selectUserMessages({ environmentState, threadRef: ref });

  return {
    id: shell.id,
    environmentId: shell.environmentId,
    session: environmentState.threadSessionById[ref.threadId] ?? null,
    latestTurn: environmentState.threadTurnStateById[ref.threadId]?.latestTurn ?? null,
    latestUserMessage: userMessages.latest,
    userMessageIds: userMessages.ids,
    startFailureActivities: selectFilteredActivities({
      environmentState,
      threadRef: ref,
      cache: startFailureActivitiesByThreadKey,
      emptyValue: EMPTY_START_FAILURE_ACTIVITIES,
      predicate: (activity) => activity.kind === "runtime.turn.start.failed",
    }),
  };
}
