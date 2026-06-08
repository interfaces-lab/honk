import type { MessageId, ThreadEntryId, ThreadId, TurnId } from "@multi/contracts";
import type { EnvironmentState } from "./stores/thread-store";
import type {
  ChatMessage,
  LiveAssistantTurn,
  ProposedPlan,
  Thread,
  ThreadTreeEntry,
  ThreadSession,
  ThreadShell,
  ThreadTurnState,
  TurnDiffSummary,
} from "./types";

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_LIVE_ASSISTANT_TURNS: LiveAssistantTurn[] = [];
const EMPTY_ACTIVITIES: Thread["activities"] = [];
const EMPTY_PROPOSED_PLANS: ProposedPlan[] = [];
const EMPTY_TURN_DIFF_SUMMARIES: TurnDiffSummary[] = [];
const EMPTY_THREAD_ENTRIES: ThreadTreeEntry[] = [];
const EMPTY_MESSAGE_MAP: Record<MessageId, ChatMessage> = {};
const EMPTY_THREAD_ENTRY_MAP: Record<ThreadEntryId, ThreadTreeEntry> = {};
const EMPTY_ACTIVITY_MAP: Record<string, Thread["activities"][number]> = {};
const EMPTY_PROPOSED_PLAN_MAP: Record<string, ProposedPlan> = {};
const EMPTY_TURN_DIFF_MAP: Record<TurnId, TurnDiffSummary> = {};

const collectByIdsCache = new WeakMap<readonly string[], WeakMap<object, unknown[]>>();

const threadCache = new WeakMap<
  ThreadShell,
  {
    session: ThreadSession | null;
    turnState: ThreadTurnState | undefined;
    leafId: ThreadEntryId | null;
    messages: Thread["messages"];
    liveAssistantTurns: LiveAssistantTurn[];
    entries: ThreadTreeEntry[];
    activities: Thread["activities"];
    proposedPlans: Thread["proposedPlans"];
    turnDiffSummaries: Thread["turnDiffSummaries"];
    thread: Thread;
  }
>();

function collectByIds<TKey extends string, TValue>(
  ids: readonly TKey[] | undefined,
  byId: Record<TKey, TValue> | undefined,
  emptyValue: TValue[],
): TValue[] {
  if (!ids || ids.length === 0 || !byId) {
    return emptyValue;
  }

  let byIdCache = collectByIdsCache.get(ids);
  if (!byIdCache) {
    byIdCache = new WeakMap<object, unknown[]>();
    collectByIdsCache.set(ids, byIdCache);
  }
  const cached = byIdCache.get(byId);
  if (cached) {
    return cached as TValue[];
  }

  const result = ids.flatMap((id) => {
    const value = byId[id];
    return value ? [value] : [];
  });
  byIdCache.set(byId, result);
  return result;
}

function selectThreadMessages(state: EnvironmentState, threadId: ThreadId): Thread["messages"] {
  return collectByIds(
    state.messageIdsByThreadId[threadId],
    state.messageByThreadId[threadId] ?? EMPTY_MESSAGE_MAP,
    EMPTY_MESSAGES,
  );
}

function selectLiveAssistantTurns(
  state: EnvironmentState,
  threadId: ThreadId,
): LiveAssistantTurn[] {
  return collectByIds(
    state.liveAssistantTurnIdsByThreadId[threadId],
    state.liveAssistantTurnByThreadId[threadId] ?? {},
    EMPTY_LIVE_ASSISTANT_TURNS,
  );
}

function withLiveAssistantTurns(
  messages: Thread["messages"],
  liveAssistantTurns: ReadonlyArray<LiveAssistantTurn>,
): Thread["messages"] {
  if (liveAssistantTurns.length === 0) {
    return messages;
  }
  const committedMessageIds = new Set(messages.map((message) => message.id));
  const liveMessages = liveAssistantTurns.flatMap((turn): ChatMessage[] =>
    committedMessageIds.has(turn.messageId)
      ? []
      : [
          {
            id: turn.messageId,
            role: "assistant",
            text: turn.text,
            turnId: turn.turnId,
            createdAt: turn.createdAt,
            streaming: true,
          },
        ],
  );
  return liveMessages.length === 0 ? messages : [...messages, ...liveMessages];
}

function selectThreadEntries(state: EnvironmentState, threadId: ThreadId): ThreadTreeEntry[] {
  return collectByIds(
    state.entryIdsByThreadId?.[threadId],
    state.entryByThreadId?.[threadId] ?? EMPTY_THREAD_ENTRY_MAP,
    EMPTY_THREAD_ENTRIES,
  );
}

function selectThreadActivities(state: EnvironmentState, threadId: ThreadId): Thread["activities"] {
  return collectByIds(
    state.activityIdsByThreadId[threadId],
    state.activityByThreadId[threadId] ?? EMPTY_ACTIVITY_MAP,
    EMPTY_ACTIVITIES,
  );
}

function selectThreadProposedPlans(
  state: EnvironmentState,
  threadId: ThreadId,
): Thread["proposedPlans"] {
  return collectByIds(
    state.proposedPlanIdsByThreadId[threadId],
    state.proposedPlanByThreadId[threadId] ?? EMPTY_PROPOSED_PLAN_MAP,
    EMPTY_PROPOSED_PLANS,
  );
}

function selectThreadTurnDiffSummaries(
  state: EnvironmentState,
  threadId: ThreadId,
): Thread["turnDiffSummaries"] {
  return collectByIds(
    state.turnDiffIdsByThreadId[threadId],
    state.turnDiffSummaryByThreadId[threadId] ?? EMPTY_TURN_DIFF_MAP,
    EMPTY_TURN_DIFF_SUMMARIES,
  );
}

export function getThreadFromEnvironmentState(
  state: EnvironmentState,
  threadId: ThreadId,
): Thread | undefined {
  const shell = state.threadShellById[threadId];
  if (!shell) {
    return undefined;
  }

  const session = state.threadSessionById[threadId] ?? null;
  const turnState = state.threadTurnStateById[threadId];
  const leafId = state.leafIdByThreadId?.[threadId] ?? null;
  const committedMessages = selectThreadMessages(state, threadId);
  const liveAssistantTurns = selectLiveAssistantTurns(state, threadId);
  const messages = withLiveAssistantTurns(committedMessages, liveAssistantTurns);
  const entries = selectThreadEntries(state, threadId);
  const activities = selectThreadActivities(state, threadId);
  const proposedPlans = selectThreadProposedPlans(state, threadId);
  const turnDiffSummaries = selectThreadTurnDiffSummaries(state, threadId);
  const cached = threadCache.get(shell);

  if (
    cached &&
    cached.session === session &&
    cached.turnState === turnState &&
    cached.leafId === leafId &&
    cached.messages === messages &&
    cached.liveAssistantTurns === liveAssistantTurns &&
    cached.entries === entries &&
    cached.activities === activities &&
    cached.proposedPlans === proposedPlans &&
    cached.turnDiffSummaries === turnDiffSummaries
  ) {
    return cached.thread;
  }

  const thread: Thread = {
    ...shell,
    session,
    latestTurn: turnState?.latestTurn ?? null,
    pendingSourceProposedPlan: turnState?.pendingSourceProposedPlan,
    messages,
    leafId,
    entries,
    activities,
    proposedPlans,
    turnDiffSummaries,
  };

  threadCache.set(shell, {
    session,
    turnState,
    leafId,
    messages,
    liveAssistantTurns,
    entries,
    activities,
    proposedPlans,
    turnDiffSummaries,
    thread,
  });

  return thread;
}
