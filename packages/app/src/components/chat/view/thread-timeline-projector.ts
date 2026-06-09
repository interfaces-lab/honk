import {
  MessageId,
  OrchestrationProposedPlanId,
  runtimeSessionEntryMessageId,
  type RuntimeDisplayTimelineItem,
  type RuntimeDisplayTimelineMessageItem,
  type RuntimeDisplayTimelineProjection,
  type RuntimeSessionId,
} from "@multi/contracts";

import { resolveWaitingTimelineStatus } from "../message/waiting-status";
import type { TimelineEntry, WorkLogEntry } from "../../../session-logic";
import type { ChatMessage, ProposedPlan, ThreadSendIntent } from "../../../types";
import {
  timelineMessageEntryId,
  timelineToolCallEntryId,
  timelineTurnAssistantEntryId,
  timelineTurnThinkingEntryId,
} from "./timeline-entry-ids";
import type { ThreadBranchView } from "./thread-branch-view";

export function projectThreadTimeline(input: {
  readonly committedMessages: ReadonlyArray<ChatMessage>;
  readonly proposedPlans: ReadonlyArray<ProposedPlan>;
  readonly workLogEntries: ReadonlyArray<WorkLogEntry>;
  readonly sendIntents: ReadonlyArray<ThreadSendIntent>;
  readonly runtimeAcknowledgedMessageIds?: ReadonlySet<MessageId> | undefined;
  readonly activeRuntimeDisplayTimeline: RuntimeDisplayTimelineProjection | null;
  readonly isWorking: boolean;
  readonly isTurnActive: boolean;
  readonly activeTurnStartedAt: string | null;
}): ReadonlyArray<TimelineEntry> {
  const renderSendIntents = unacknowledgedThreadSendIntents({
    sendIntents: input.sendIntents,
    committedMessages: input.committedMessages,
  });
  const transientSendIntents = unacknowledgedThreadSendIntents({
    sendIntents: renderSendIntents,
    committedMessages: input.committedMessages,
    acknowledgedMessageIds: input.runtimeAcknowledgedMessageIds,
  });
  const timelineMessages = appendThreadSendIntentsToMessages(
    input.committedMessages,
    renderSendIntents,
  );
  const committedEntries = materializeCommittedTimelineEntries({
    messages: timelineMessages,
    proposedPlans: input.proposedPlans,
    workLogEntries: input.workLogEntries,
  });
  const committedEntriesWithTransientRows = appendTransientTimelineEntries({
    entries: committedEntries,
    messages: timelineMessages,
    sendIntents: transientSendIntents,
  });
  if (!input.activeRuntimeDisplayTimeline) {
    return appendWaitingTimelineEntry({
      entries: committedEntriesWithTransientRows,
      isWorking: input.isWorking,
      isTurnActive: input.isTurnActive,
      activeTurnStartedAt: input.activeTurnStartedAt,
    });
  }

  const runtimeEntries = materializeTimelineEntriesFromRuntimeDisplayTimeline({
    timeline: input.activeRuntimeDisplayTimeline,
    messages: timelineMessages,
    proposedPlans: input.proposedPlans,
  });
  if (
    !shouldUseRuntimeDisplayTimelineEntries({
      runtimeEntries,
      committedEntries: committedEntriesWithTransientRows,
    })
  ) {
    return appendWaitingTimelineEntry({
      entries: committedEntriesWithTransientRows,
      isWorking: input.isWorking,
      isTurnActive: input.isTurnActive,
      activeTurnStartedAt: input.activeTurnStartedAt,
    });
  }
  const entries = appendMissingRuntimeTimelineMessageEntries({
    entries: mergeRunningWorkLogEntriesIntoRuntimeTimeline({
      runtimeEntries,
      committedEntries: committedEntriesWithTransientRows,
    }),
    messages: timelineMessages,
    sendIntents: transientSendIntents,
  });
  return appendWaitingTimelineEntry({
    entries,
    isWorking: input.isWorking,
    isTurnActive: input.isTurnActive,
    activeTurnStartedAt: input.activeTurnStartedAt,
  });
}

// Counts occurrences per turn so every materialization pass assigns the same
// turn-scoped indices when it walks its messages in chronological order.
function turnOccurrenceCounter(): (turnId: string) => number {
  const counts = new Map<string, number>();
  return (turnId) => {
    const index = counts.get(turnId) ?? 0;
    counts.set(turnId, index + 1);
    return index;
  };
}

function committedMessageEntryId(
  message: ChatMessage,
  nextAssistantIndex: (turnId: string) => number,
): string {
  return message.role === "assistant" && message.turnId
    ? timelineTurnAssistantEntryId(message.turnId, nextAssistantIndex(message.turnId))
    : timelineMessageEntryId(message.id);
}

function materializeCommittedTimelineEntries(input: {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly proposedPlans: ReadonlyArray<ProposedPlan>;
  readonly workLogEntries: ReadonlyArray<WorkLogEntry>;
}): TimelineEntry[] {
  const nextAssistantIndex = turnOccurrenceCounter();
  const entries: TimelineEntry[] = [
    ...input.messages.map((message): TimelineEntry => ({
      id: committedMessageEntryId(message, nextAssistantIndex),
      kind: "message",
      createdAt: message.createdAt,
      message,
    })),
    ...input.proposedPlans.map((proposedPlan): TimelineEntry => ({
      id: `proposed-plan:${proposedPlan.id}`,
      kind: "proposed-plan",
      createdAt: proposedPlan.createdAt,
      proposedPlan,
    })),
    ...input.workLogEntries.map((entry): TimelineEntry => ({
      id: entry.toolCallId ? timelineToolCallEntryId(entry.toolCallId) : entry.id,
      kind: "work",
      createdAt: entry.createdAt,
      entry,
    })),
  ];
  return entries.toSorted(compareTimelineEntries);
}

export function filterThreadSendIntentsToBranch(
  intents: ReadonlyArray<ThreadSendIntent>,
  branchView: ThreadBranchView,
): ReadonlyArray<ThreadSendIntent> {
  if (branchView.status === "invalid") {
    return [];
  }
  if (branchView.status === "unfiltered") {
    return intents;
  }

  return intents.filter((intent) => {
    if (intent.parentEntryId === null) {
      return true;
    }
    return branchView.entryIds?.has(intent.parentEntryId) ?? false;
  });
}

export function appendThreadSendIntentsToMessages(
  messages: ReadonlyArray<ChatMessage>,
  sendIntents: ReadonlyArray<ThreadSendIntent>,
): ReadonlyArray<ChatMessage> {
  if (sendIntents.length === 0) {
    return messages;
  }

  const committedMessageIds = new Set(messages.map((message) => message.id));
  const transientMessages = sendIntents.flatMap((intent) =>
    committedMessageIds.has(intent.clientMessageId) ? [] : [messageFromThreadSendIntent(intent)],
  );
  return transientMessages.length === 0 ? messages : [...messages, ...transientMessages];
}

export function acknowledgedThreadSendIntents(input: {
  sendIntents: ReadonlyArray<ThreadSendIntent>;
  committedMessages: ReadonlyArray<ChatMessage>;
  acknowledgedMessageIds?: ReadonlySet<MessageId> | undefined;
}): ThreadSendIntent[] {
  const committedMessageIds = new Set(input.committedMessages.map((message) => message.id));
  for (const messageId of input.acknowledgedMessageIds ?? []) {
    committedMessageIds.add(messageId);
  }
  return input.sendIntents.filter((intent) => committedMessageIds.has(intent.clientMessageId));
}

export function unacknowledgedThreadSendIntents(input: {
  sendIntents: ReadonlyArray<ThreadSendIntent>;
  committedMessages: ReadonlyArray<ChatMessage>;
  acknowledgedMessageIds?: ReadonlySet<MessageId> | undefined;
}): ThreadSendIntent[] {
  const acknowledgedIntents = new Set(acknowledgedThreadSendIntents(input));
  return input.sendIntents.filter((intent) => !acknowledgedIntents.has(intent));
}

export function threadSendIntentMessages(
  intents: ReadonlyArray<ThreadSendIntent>,
): ChatMessage[] {
  return intents.map(messageFromThreadSendIntent);
}

export function messageFromThreadSendIntent(
  intent: ThreadSendIntent,
): ChatMessage & { role: "user"; streaming: false } {
  return {
    id: intent.clientMessageId,
    role: "user",
    text: intent.text,
    ...(intent.richText !== undefined ? { richText: intent.richText } : {}),
    ...(intent.attachments !== undefined && intent.attachments.length > 0
      ? { attachments: intent.attachments }
      : {}),
    createdAt: intent.createdAt,
    streaming: false,
  };
}

export function runtimeDisplayTimelineHasResponseItem(
  timeline: RuntimeDisplayTimelineProjection | null | undefined,
): boolean {
  if (!timeline) {
    return false;
  }
  return timeline.items.some((item) => {
    if (item.kind !== "message") {
      return true;
    }
    if (item.role === "user") {
      return false;
    }
    return (
      (item.text?.trim().length ?? 0) > 0 ||
      shouldMaterializeRuntimeThinking(item)
    );
  });
}

export function runtimeDisplayTimelineRenderableUserMessageIds(
  timeline: RuntimeDisplayTimelineProjection | null | undefined,
): ReadonlySet<MessageId> {
  const messageIds = new Set<MessageId>();
  if (!timeline) {
    return messageIds;
  }
  for (const item of timeline.items) {
    if (item.kind !== "message" || item.role !== "user") {
      continue;
    }
    if ((item.text?.trim().length ?? 0) === 0) {
      continue;
    }
    messageIds.add(runtimeDisplayTimelineMessageId(timeline.runtimeSessionId, item));
  }
  return messageIds;
}

interface RuntimeTimelineMaterializationContext {
  readonly runtimeSessionId: RuntimeSessionId;
  readonly messagesById: ReadonlyMap<MessageId, ChatMessage>;
  readonly proposedPlansById: ReadonlyMap<OrchestrationProposedPlanId, ProposedPlan>;
  readonly nextAssistantIndex: (turnId: string) => number;
  readonly nextThinkingIndex: (turnId: string) => number;
}

function materializeTimelineEntriesFromRuntimeDisplayTimeline(input: {
  readonly timeline: RuntimeDisplayTimelineProjection;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly proposedPlans: ReadonlyArray<ProposedPlan>;
}): TimelineEntry[] {
  const ctx: RuntimeTimelineMaterializationContext = {
    runtimeSessionId: input.timeline.runtimeSessionId,
    messagesById: new Map(input.messages.map((message) => [message.id, message] as const)),
    proposedPlansById: new Map(
      input.proposedPlans.map((proposedPlan) => [proposedPlan.id, proposedPlan] as const),
    ),
    nextAssistantIndex: turnOccurrenceCounter(),
    nextThinkingIndex: turnOccurrenceCounter(),
  };
  const entries: TimelineEntry[] = [];

  for (const item of input.timeline.items) {
    entries.push(...runtimeDisplayTimelineItemToTimelineEntries(item, ctx));
  }

  return entries;
}

function runtimeDisplayTimelineItemToTimelineEntries(
  item: RuntimeDisplayTimelineItem,
  ctx: RuntimeTimelineMaterializationContext,
): TimelineEntry[] {
  switch (item.kind) {
    case "message": {
      const entries: TimelineEntry[] = [];
      const messageId = runtimeDisplayTimelineMessageId(ctx.runtimeSessionId, item);
      const existingMessage = ctx.messagesById.get(messageId);
      const role = runtimeDisplayMessageRole(item.role);
      if (!role) {
        return [];
      }
      if (shouldMaterializeRuntimeThinking(item)) {
        entries.push({
          // Turn-scoped so the row id survives the live item being replaced by the settled
          // session entry; otherwise the thinking row (often a group's first step, and so its
          // row id) re-keys at turn end and the whole group remounts.
          id: item.turnId
            ? timelineTurnThinkingEntryId(item.turnId, ctx.nextThinkingIndex(item.turnId))
            : `${item.id}:thinking`,
          kind: "runtime-thinking",
          createdAt: item.createdAt,
          message: runtimeThinkingStatusMessage(item),
        });
      }
      if (!shouldMaterializeRuntimeMessageText(item, existingMessage)) {
        return entries;
      }
      entries.push({
        id:
          role === "assistant" && item.turnId
            ? timelineTurnAssistantEntryId(item.turnId, ctx.nextAssistantIndex(item.turnId))
            : timelineMessageEntryId(messageId),
        kind: "message",
        createdAt: item.createdAt,
        message:
          existingMessage ??
          ({
            id: messageId,
            role,
            text: item.text ?? "",
            turnId: item.turnId ?? null,
            createdAt: item.createdAt,
            completedAt: item.streaming ? undefined : item.createdAt,
            streaming: item.streaming ?? false,
          } satisfies ChatMessage),
      });
      return entries;
    }
    case "tool":
      return [
        {
          id: item.toolCallId ? timelineToolCallEntryId(item.toolCallId) : item.id,
          kind: "runtime-tool",
          createdAt: item.createdAt,
          tool: item,
        },
      ];
    case "extension-ui-request":
      return [
        {
          id: item.id,
          kind: "runtime-extension-ui-request",
          createdAt: item.createdAt,
          request: item,
        },
      ];
    case "proposed-plan": {
      const planId = OrchestrationProposedPlanId.make(item.planId);
      return [
        {
          id: item.id,
          kind: "proposed-plan",
          createdAt: item.createdAt,
          proposedPlan:
            ctx.proposedPlansById.get(planId) ??
            ({
              id: planId,
              turnId: item.turnId ?? null,
              planMarkdown: item.planMarkdown,
              implementedAt: null,
              implementationThreadId: null,
              createdAt: item.createdAt,
              updatedAt: item.createdAt,
            } satisfies ProposedPlan),
        },
      ];
    }
  }
}

function shouldMaterializeRuntimeThinking(
  item: Extract<RuntimeDisplayTimelineItem, { kind: "message" }>,
): boolean {
  return (
    item.role === "assistant" &&
    (item.thinking?.trim().length ?? 0) > 0
  );
}

function runtimeThinkingStatusMessage(
  item: RuntimeDisplayTimelineMessageItem,
): RuntimeDisplayTimelineMessageItem {
  if (item.streaming !== true) {
    return item;
  }
  const { thinking: _thinking, ...message } = item;
  return message;
}

function shouldUseRuntimeDisplayTimelineEntries(input: {
  readonly runtimeEntries: ReadonlyArray<TimelineEntry>;
  readonly committedEntries: ReadonlyArray<TimelineEntry>;
}): boolean {
  if (input.runtimeEntries.length === 0) {
    return false;
  }
  if (
    input.committedEntries.length > 0 &&
    !input.runtimeEntries.some(isRuntimeDisplayTimelineResponseEntry)
  ) {
    return false;
  }
  return true;
}

function isRuntimeDisplayTimelineResponseEntry(entry: TimelineEntry): boolean {
  if (entry.kind !== "message") {
    return true;
  }
  return entry.message.role !== "user";
}

function mergeRunningWorkLogEntriesIntoRuntimeTimeline(input: {
  readonly runtimeEntries: ReadonlyArray<TimelineEntry>;
  readonly committedEntries: ReadonlyArray<TimelineEntry>;
}): TimelineEntry[] {
  const runtimeToolCallIds = new Set(
    input.runtimeEntries.flatMap((entry) =>
      entry.kind === "runtime-tool" ? [entry.tool.toolCallId] : [],
    ),
  );
  const supplementalWorkEntries = input.committedEntries.filter(
    (entry): entry is Extract<TimelineEntry, { kind: "work" }> =>
      entry.kind === "work" &&
      entry.entry.status === "running" &&
      (entry.entry.toolCallId === undefined ||
        !runtimeToolCallIds.has(entry.entry.toolCallId)),
  );
  if (supplementalWorkEntries.length === 0) {
    return [...input.runtimeEntries];
  }
  return mergeTransientTimelineEntries(
    input.runtimeEntries,
    supplementalWorkEntries.toSorted(compareTransientEntries),
  );
}

function runtimeDisplayTimelineMessageId(
  runtimeSessionId: RuntimeSessionId,
  item: RuntimeDisplayTimelineMessageItem,
): MessageId {
  if (item.clientMessageId) {
    return item.clientMessageId;
  }
  if (item.entryId) {
    // Must match the id ingestion mints for the committed assistant message, so the hydrated
    // runtime item aliases to it instead of rendering the same text a second time.
    return runtimeSessionEntryMessageId(runtimeSessionId, item.entryId);
  }
  return MessageId.make(item.threadEntryId ?? item.id);
}

function shouldMaterializeRuntimeMessageText(
  item: Extract<RuntimeDisplayTimelineItem, { kind: "message" }>,
  existingMessage: ChatMessage | undefined,
): boolean {
  if (existingMessage && existingMessage.text.trim().length > 0) {
    return true;
  }
  if (existingMessage?.richText !== undefined || (existingMessage?.attachments?.length ?? 0) > 0) {
    return true;
  }
  if ((item.text?.trim().length ?? 0) > 0) {
    return true;
  }
  return false;
}

function runtimeDisplayMessageRole(role: string): ChatMessage["role"] | null {
  switch (role) {
    case "user":
    case "assistant":
    case "system":
      return role;
    default:
      return null;
  }
}

function appendTransientTimelineEntries(input: {
  entries: ReadonlyArray<TimelineEntry>;
  messages: ReadonlyArray<ChatMessage>;
  sendIntents: ReadonlyArray<ThreadSendIntent>;
}): ReadonlyArray<TimelineEntry> {
  const existingMessageIds = new Set(
    input.entries.flatMap((entry) => (entry.kind === "message" ? [entry.message.id] : [])),
  );
  const transientEntries: TimelineEntry[] = [];

  if (existingMessageIds.size < input.messages.length) {
    for (const message of input.messages) {
      if (existingMessageIds.has(message.id)) {
        continue;
      }
      existingMessageIds.add(message.id);
      transientEntries.push({
        id: timelineMessageEntryId(message.id),
        kind: "message",
        createdAt: message.createdAt,
        message,
      });
    }
  }

  for (const intent of input.sendIntents) {
    if (existingMessageIds.has(intent.clientMessageId)) {
      continue;
    }
    existingMessageIds.add(intent.clientMessageId);
    const message = messageFromThreadSendIntent(intent);
    transientEntries.push({
      id: timelineMessageEntryId(intent.clientMessageId),
      kind: "message",
      createdAt: message.createdAt,
      message,
    });
  }

  if (transientEntries.length === 0) {
    return input.entries;
  }

  return mergeTransientTimelineEntries(
    input.entries,
    transientEntries.toSorted(compareTransientEntries),
  );
}

function appendMissingRuntimeTimelineMessageEntries(input: {
  entries: ReadonlyArray<TimelineEntry>;
  messages: ReadonlyArray<ChatMessage>;
  sendIntents: ReadonlyArray<ThreadSendIntent>;
}): ReadonlyArray<TimelineEntry> {
  const existingEntryIds = new Set(input.entries.map((entry) => entry.id));
  const existingMessageIds = new Set(
    input.entries.flatMap((entry) => (entry.kind === "message" ? [entry.message.id] : [])),
  );
  const missingMessageEntries: TimelineEntry[] = [];
  const nextAssistantIndex = turnOccurrenceCounter();

  for (const message of input.messages) {
    // The runtime branch keys assistant rows by turn + occurrence, so a committed assistant
    // message whose row already exists (under any payload stage) must not be appended again.
    const entryId = committedMessageEntryId(message, nextAssistantIndex);
    if (existingEntryIds.has(entryId) || existingMessageIds.has(message.id)) {
      continue;
    }
    existingEntryIds.add(entryId);
    existingMessageIds.add(message.id);
    missingMessageEntries.push({
      id: entryId,
      kind: "message",
      createdAt: message.createdAt,
      message,
    });
  }

  for (const intent of input.sendIntents) {
    if (existingMessageIds.has(intent.clientMessageId)) {
      continue;
    }
    existingMessageIds.add(intent.clientMessageId);
    const message = messageFromThreadSendIntent(intent);
    missingMessageEntries.push({
      id: timelineMessageEntryId(intent.clientMessageId),
      kind: "message",
      createdAt: message.createdAt,
      message,
    });
  }

  if (missingMessageEntries.length === 0) {
    return input.entries;
  }
  return mergeTransientTimelineEntries(
    input.entries,
    missingMessageEntries.toSorted(compareTransientEntries),
  );
}

function appendWaitingTimelineEntry(input: {
  entries: ReadonlyArray<TimelineEntry>;
  isWorking: boolean;
  isTurnActive: boolean;
  activeTurnStartedAt: string | null;
}): ReadonlyArray<TimelineEntry> {
  if (!input.isWorking || timelineEntriesEndWithStatusSurface(input.entries, input)) {
    return input.entries;
  }
  const waitingStatus = resolveWaitingTimelineStatus({
    activeTurnStartedAt: input.activeTurnStartedAt,
  });
  return [
    ...input.entries,
    {
      id: "working-indicator-row",
      kind: "waiting",
      createdAt: input.activeTurnStartedAt,
      phase: waitingStatus.phase,
      elapsedStartedAt: waitingStatus.elapsedStartedAt,
    },
  ];
}

function timelineEntriesEndWithStatusSurface(
  entries: ReadonlyArray<TimelineEntry>,
  input: { isWorking: boolean; isTurnActive: boolean },
): boolean {
  const lastEntry = entries.at(-1);
  if (!lastEntry) {
    return false;
  }
  if (lastEntry.kind === "work") {
    const trailingWork = trailingWorkEntries(entries);
    if (input.isTurnActive && input.isWorking && trailingWork.length > 0) {
      return true;
    }
    return (
      input.isTurnActive &&
      trailingWork.some((entry) => entry.entry.status === "running")
    );
  }
  if (lastEntry.kind === "runtime-tool" && lastEntry.tool.display?.kind === "subagent") {
    return lastEntry.tool.status === "running";
  }
  if (isRuntimeGroupableTimelineEntry(lastEntry)) {
    const trailingRuntime = trailingRuntimeGroupEntries(entries);
    if (input.isTurnActive && input.isWorking && trailingRuntime.length > 0) {
      return true;
    }
    return (
      input.isWorking &&
      input.isTurnActive &&
      trailingRuntime.some(isRunningRuntimeTimelineEntry)
    );
  }
  if (lastEntry.kind === "message") {
    return (
      input.isWorking &&
      input.isTurnActive &&
      lastEntry.message.role === "assistant" &&
      lastEntry.message.streaming === true
    );
  }
  return (
    lastEntry.kind === "runtime-extension-ui-request" &&
    lastEntry.request.status === "pending"
  );
}

function trailingWorkEntries(entries: ReadonlyArray<TimelineEntry>): Array<Extract<TimelineEntry, { kind: "work" }>> {
  const result: Array<Extract<TimelineEntry, { kind: "work" }>> = [];
  const lastEntry = entries.at(-1);
  if (lastEntry?.kind !== "work") {
    return result;
  }
  const isThinking = lastEntry.entry.tone === "thinking";
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.kind !== "work" || (entry.entry.tone === "thinking") !== isThinking) {
      break;
    }
    result.push(entry);
  }
  return result;
}

function trailingRuntimeGroupEntries(
  entries: ReadonlyArray<TimelineEntry>,
): Array<Extract<TimelineEntry, { kind: "runtime-thinking" | "runtime-tool" }>> {
  const result: Array<Extract<TimelineEntry, { kind: "runtime-thinking" | "runtime-tool" }>> = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || !isRuntimeGroupableTimelineEntry(entry)) {
      break;
    }
    result.push(entry);
  }
  return result;
}

function isRuntimeGroupableTimelineEntry(
  entry: TimelineEntry,
): entry is Extract<TimelineEntry, { kind: "runtime-thinking" | "runtime-tool" }> {
  return (
    entry.kind === "runtime-thinking" ||
    (entry.kind === "runtime-tool" && entry.tool.display?.kind !== "subagent")
  );
}

function isRunningRuntimeTimelineEntry(
  entry: Extract<TimelineEntry, { kind: "runtime-thinking" | "runtime-tool" }>,
): boolean {
  if (entry.kind === "runtime-thinking") {
    return entry.message.streaming === true;
  }
  return entry.tool.status === "running";
}

function mergeTransientTimelineEntries(
  entries: ReadonlyArray<TimelineEntry>,
  transientEntries: ReadonlyArray<TimelineEntry>,
): TimelineEntry[] {
  const result: TimelineEntry[] = [];
  let transientIndex = 0;

  for (const entry of entries) {
    while (
      transientIndex < transientEntries.length &&
      compareTimelineEntryCreatedAt(transientEntries[transientIndex]!.createdAt, entry.createdAt) <
        0
    ) {
      result.push(transientEntries[transientIndex]!);
      transientIndex += 1;
    }
    result.push(entry);
  }

  while (transientIndex < transientEntries.length) {
    result.push(transientEntries[transientIndex]!);
    transientIndex += 1;
  }

  return result;
}

function compareTransientEntries(left: TimelineEntry, right: TimelineEntry): number {
  return compareTimelineEntries(left, right);
}

function compareTimelineEntries(left: TimelineEntry, right: TimelineEntry): number {
  const createdAtOrder = compareTimelineEntryCreatedAt(left.createdAt, right.createdAt);
  return createdAtOrder === 0 ? left.id.localeCompare(right.id) : createdAtOrder;
}

function compareTimelineEntryCreatedAt(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left.localeCompare(right);
}
