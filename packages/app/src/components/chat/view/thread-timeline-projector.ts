import {
  MessageId,
  OrchestrationProposedPlanId,
  runtimeSessionEntryMessageId,
  type RuntimeDisplayTimelineItem,
  type RuntimeDisplayTimelineMessageItem,
  type RuntimeDisplayTimelineProjection,
  type RuntimeSessionId,
  type TurnId,
} from "@honk/contracts";

import { shouldSuppressProviderFailureAssistantRow } from "../../../lib/turn-failure-index";

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

const RUNTIME_USER_ECHO_CREATED_AT_TOLERANCE_MS = 2_000;

export function projectThreadTimeline(input: {
  readonly committedMessages: ReadonlyArray<ChatMessage>;
  readonly proposedPlans: ReadonlyArray<ProposedPlan>;
  readonly workLogEntries: ReadonlyArray<WorkLogEntry>;
  readonly sendIntents: ReadonlyArray<ThreadSendIntent>;
  readonly runtimeAcknowledgedMessageIds?: ReadonlySet<MessageId> | undefined;
  readonly activeRuntimeDisplayTimeline: RuntimeDisplayTimelineProjection | null;
  readonly turnFailuresByUserMessageId?: ReadonlyMap<MessageId, string> | undefined;
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
  const turnFailuresByUserMessageId = input.turnFailuresByUserMessageId ?? new Map();
  const withTurnFailures = (entries: ReadonlyArray<TimelineEntry>) =>
    applyTurnFailuresToTimeline({
      entries,
      messages: timelineMessages,
      turnFailuresByUserMessageId,
    });

  if (!input.activeRuntimeDisplayTimeline) {
    return withTurnFailures(
      appendWaitingTimelineEntry({
        entries: committedEntriesWithTransientRows,
        isWorking: input.isWorking,
        isTurnActive: input.isTurnActive,
        activeTurnStartedAt: input.activeTurnStartedAt,
      }),
    );
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
    return withTurnFailures(
      appendWaitingTimelineEntry({
        entries: committedEntriesWithTransientRows,
        isWorking: input.isWorking,
        isTurnActive: input.isTurnActive,
        activeTurnStartedAt: input.activeTurnStartedAt,
      }),
    );
  }
  const entries = appendMissingRuntimeTimelineMessageEntries({
    entries: mergeRunningWorkLogEntriesIntoRuntimeTimeline({
      runtimeEntries,
      committedEntries: committedEntriesWithTransientRows,
    }),
    messages: timelineMessages,
    sendIntents: transientSendIntents,
  });
  return withTurnFailures(
    appendWaitingTimelineEntry({
      entries,
      isWorking: input.isWorking,
      isTurnActive: input.isTurnActive,
      activeTurnStartedAt: input.activeTurnStartedAt,
    }),
  );
}

function applyTurnFailuresToTimeline(input: {
  readonly entries: ReadonlyArray<TimelineEntry>;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly turnFailuresByUserMessageId: ReadonlyMap<MessageId, string>;
}): TimelineEntry[] {
  const result: TimelineEntry[] = [];
  for (const entry of input.entries) {
    if (entry.kind !== "message") {
      result.push(entry);
      continue;
    }
    if (
      shouldSuppressProviderFailureAssistantRow(
        entry.message,
        input.messages,
        input.turnFailuresByUserMessageId,
      )
    ) {
      continue;
    }
    if (entry.message.role !== "user") {
      result.push(entry);
      continue;
    }
    const turnFailure = input.turnFailuresByUserMessageId.get(entry.message.id);
    if (!turnFailure) {
      result.push(entry);
      continue;
    }
    result.push({
      ...entry,
      message: {
        ...entry.message,
        turnFailure,
      },
    });
  }
  return result;
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
    ...input.messages.map(
      (message): TimelineEntry => ({
        id: committedMessageEntryId(message, nextAssistantIndex),
        kind: "message",
        createdAt: message.createdAt,
        message,
      }),
    ),
    ...input.proposedPlans.map(
      (proposedPlan): TimelineEntry => ({
        id: `proposed-plan:${proposedPlan.id}`,
        kind: "proposed-plan",
        createdAt: proposedPlan.createdAt,
        proposedPlan,
      }),
    ),
    ...input.workLogEntries.map(
      (entry): TimelineEntry => ({
        id: entry.toolCallId ? timelineToolCallEntryId(entry.toolCallId) : entry.id,
        kind: "work",
        createdAt: entry.createdAt,
        entry,
      }),
    ),
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

  const renderedMessages = [...messages];
  const renderedMessageIds = new Set(renderedMessages.map((message) => message.id));
  const transientMessages: ChatMessage[] = [];

  for (const intent of sendIntents) {
    if (renderedMessageIds.has(intent.clientMessageId)) {
      continue;
    }
    const message = messageFromThreadSendIntent(intent);
    if (isEquivalentUserMessageAlreadyRendered(message, renderedMessages)) {
      continue;
    }
    renderedMessageIds.add(message.id);
    renderedMessages.push(message);
    transientMessages.push(message);
  }
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

export function threadSendIntentMessages(intents: ReadonlyArray<ThreadSendIntent>): ChatMessage[] {
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
    return (item.text?.trim().length ?? 0) > 0 || shouldMaterializeRuntimeThinking(item);
  });
}

export function runtimeDisplayTimelineHasActiveWork(
  timeline: RuntimeDisplayTimelineProjection | null | undefined,
): boolean {
  if (!timeline) {
    return false;
  }
  return timeline.items.some(runtimeDisplayTimelineItemHasActiveWork);
}

export function runtimeDisplayTimelineActiveTurnId(
  timeline: RuntimeDisplayTimelineProjection | null | undefined,
): TurnId | null {
  if (!timeline) {
    return null;
  }
  for (let index = timeline.items.length - 1; index >= 0; index -= 1) {
    const item = timeline.items[index];
    if (item && runtimeDisplayTimelineItemHasActiveWork(item) && item.turnId) {
      return item.turnId;
    }
  }
  for (let index = timeline.items.length - 1; index >= 0; index -= 1) {
    const item = timeline.items[index];
    if (item?.turnId) {
      return item.turnId;
    }
  }
  return null;
}

function runtimeDisplayTimelineItemHasActiveWork(item: RuntimeDisplayTimelineItem): boolean {
  switch (item.kind) {
    case "message":
      return item.streaming === true;
    case "tool":
      return (
        item.status === "running" ||
        (item.display.kind === "subagent" &&
          item.display.runs.some((run) => run.state === "running"))
      );
    case "extension-ui-request":
      return item.status === "pending";
    case "proposed-plan":
      return false;
  }
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
  readonly messages: ReadonlyArray<ChatMessage>;
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
    messages: input.messages,
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
      const message =
        existingMessage ??
        ({
          id: messageId,
          role,
          text: item.text ?? "",
          turnId: item.turnId ?? null,
          createdAt: item.createdAt,
          completedAt: item.streaming ? undefined : item.createdAt,
          streaming: item.streaming ?? false,
        } satisfies ChatMessage);
      if (
        existingMessage === undefined &&
        isEquivalentUserMessageAlreadyRendered(message, ctx.messages, {
          createdAtToleranceMs: RUNTIME_USER_ECHO_CREATED_AT_TOLERANCE_MS,
        })
      ) {
        return entries;
      }
      entries.push({
        id:
          role === "assistant" && item.turnId
            ? timelineTurnAssistantEntryId(item.turnId, ctx.nextAssistantIndex(item.turnId))
            : timelineMessageEntryId(messageId),
        kind: "message",
        createdAt: item.createdAt,
        message,
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
  return item.role === "assistant" && (item.thinking?.trim().length ?? 0) > 0;
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
  const committedWorkEntriesByToolCallId = new Map<
    string,
    Extract<TimelineEntry, { kind: "work" }>
  >();
  for (const entry of input.committedEntries) {
    if (entry.kind === "work" && entry.entry.toolCallId) {
      committedWorkEntriesByToolCallId.set(entry.entry.toolCallId, entry);
    }
  }

  const replacedCommittedEntryIds = new Set<string>();
  const runtimeEntries = input.runtimeEntries.map((entry): TimelineEntry => {
    if (entry.kind !== "runtime-tool") {
      return entry;
    }
    const committedEntry = committedWorkEntriesByToolCallId.get(entry.tool.toolCallId);
    if (!committedEntry || !shouldPreferCommittedWorkEntryForRuntimeTool(entry, committedEntry)) {
      return entry;
    }
    replacedCommittedEntryIds.add(committedEntry.id);
    return committedEntry;
  });

  const runtimeToolCallIds = new Set(
    input.runtimeEntries.flatMap((entry) =>
      entry.kind === "runtime-tool" ? [entry.tool.toolCallId] : [],
    ),
  );
  // Tool entries the runtime overlay does not cover always merge in: live tool items exist
  // only while the runtime event stream is connected, so after a renderer reload the
  // committed record is the sole source for the turn's completed tools. Entries without a
  // tool-call id (thinking/status) merge only while running — their settled counterparts
  // already render as runtime display items.
  const supplementalWorkEntries = input.committedEntries.filter(
    (entry): entry is Extract<TimelineEntry, { kind: "work" }> =>
      entry.kind === "work" &&
      !replacedCommittedEntryIds.has(entry.id) &&
      (entry.entry.toolCallId !== undefined
        ? !runtimeToolCallIds.has(entry.entry.toolCallId)
        : entry.entry.status === "running"),
  );
  if (supplementalWorkEntries.length === 0) {
    return runtimeEntries;
  }
  return mergeTransientTimelineEntries(
    runtimeEntries,
    supplementalWorkEntries.toSorted(compareTransientEntries),
  );
}

function shouldPreferCommittedWorkEntryForRuntimeTool(
  runtimeEntry: Extract<TimelineEntry, { kind: "runtime-tool" }>,
  committedEntry: Extract<TimelineEntry, { kind: "work" }>,
): boolean {
  if (runtimeEntry.tool.status !== "completed" || runtimeEntry.tool.isError === true) {
    return false;
  }
  if (committedEntry.entry.status === "running" || committedEntry.entry.tone === "error") {
    return false;
  }
  if (!workEntryHasDiffArtifact(committedEntry.entry)) {
    return false;
  }
  return runtimeEntry.tool.display?.kind === "edit" || isFileChangeWorkEntry(committedEntry.entry);
}

function workEntryHasDiffArtifact(entry: WorkLogEntry): boolean {
  return Boolean(entry.artifacts?.some((artifact) => artifact.type === "diff"));
}

function isFileChangeWorkEntry(entry: WorkLogEntry): boolean {
  return (
    entry.requestKind === "file-change" ||
    entry.itemType === "file_change" ||
    (entry.changedFiles?.length ?? 0) > 0
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
  const existingMessages = input.entries.flatMap((entry) =>
    entry.kind === "message" ? [entry.message] : [],
  );
  const existingMessageIds = new Set(existingMessages.map((message) => message.id));
  const transientEntries: TimelineEntry[] = [];

  if (existingMessageIds.size < input.messages.length) {
    for (const message of input.messages) {
      if (
        existingMessageIds.has(message.id) ||
        isEquivalentUserMessageAlreadyRendered(message, existingMessages)
      ) {
        continue;
      }
      existingMessageIds.add(message.id);
      existingMessages.push(message);
      transientEntries.push({
        id: timelineMessageEntryId(message.id),
        kind: "message",
        createdAt: message.createdAt,
        message,
      });
    }
  }

  for (const intent of input.sendIntents) {
    const message = messageFromThreadSendIntent(intent);
    if (
      existingMessageIds.has(intent.clientMessageId) ||
      isEquivalentUserMessageAlreadyRendered(message, existingMessages)
    ) {
      continue;
    }
    existingMessageIds.add(intent.clientMessageId);
    existingMessages.push(message);
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
  const existingMessages = input.entries.flatMap((entry) =>
    entry.kind === "message" ? [entry.message] : [],
  );
  const existingMessageIds = new Set(existingMessages.map((message) => message.id));
  const missingMessageEntries: TimelineEntry[] = [];
  const nextAssistantIndex = turnOccurrenceCounter();

  for (const message of input.messages) {
    // The runtime branch keys assistant rows by turn + occurrence, so a committed assistant
    // message whose row already exists (under any payload stage) must not be appended again.
    const entryId = committedMessageEntryId(message, nextAssistantIndex);
    if (
      existingEntryIds.has(entryId) ||
      existingMessageIds.has(message.id) ||
      isEquivalentUserMessageAlreadyRendered(message, existingMessages, {
        createdAtToleranceMs: RUNTIME_USER_ECHO_CREATED_AT_TOLERANCE_MS,
      })
    ) {
      continue;
    }
    existingEntryIds.add(entryId);
    existingMessageIds.add(message.id);
    existingMessages.push(message);
    missingMessageEntries.push({
      id: entryId,
      kind: "message",
      createdAt: message.createdAt,
      message,
    });
  }

  for (const intent of input.sendIntents) {
    const message = messageFromThreadSendIntent(intent);
    if (
      existingMessageIds.has(intent.clientMessageId) ||
      isEquivalentUserMessageAlreadyRendered(message, existingMessages)
    ) {
      continue;
    }
    existingMessageIds.add(intent.clientMessageId);
    existingMessages.push(message);
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

function isEquivalentUserMessageAlreadyRendered(
  message: ChatMessage,
  existingMessages: ReadonlyArray<ChatMessage>,
  options?: { readonly createdAtToleranceMs?: number | undefined },
): boolean {
  if (message.role !== "user") {
    return false;
  }
  if (message.richText !== undefined || (message.attachments?.length ?? 0) > 0) {
    return false;
  }
  return existingMessages.some(
    (existingMessage) =>
      existingMessage.role === "user" &&
      existingMessage.text === message.text &&
      isEquivalentUserMessageTimestamp(message, existingMessage, options?.createdAtToleranceMs ?? 0),
  );
}

function isEquivalentUserMessageTimestamp(
  message: ChatMessage,
  existingMessage: ChatMessage,
  createdAtToleranceMs: number,
): boolean {
  if (existingMessage.createdAt === message.createdAt) {
    return true;
  }
  if (message.turnId && existingMessage.turnId && message.turnId === existingMessage.turnId) {
    return true;
  }
  if (createdAtToleranceMs <= 0) {
    return false;
  }
  const messageCreatedAt = Date.parse(message.createdAt);
  const existingCreatedAt = Date.parse(existingMessage.createdAt);
  if (!Number.isFinite(messageCreatedAt) || !Number.isFinite(existingCreatedAt)) {
    return false;
  }
  return Math.abs(messageCreatedAt - existingCreatedAt) <= createdAtToleranceMs;
}

function appendWaitingTimelineEntry(input: {
  entries: ReadonlyArray<TimelineEntry>;
  isWorking: boolean;
  isTurnActive: boolean;
  activeTurnStartedAt: string | null;
}): ReadonlyArray<TimelineEntry> {
  const shouldAppendWaiting =
    input.isWorking || (input.isTurnActive && timelineEntriesEndWithUserMessage(input.entries));
  if (!shouldAppendWaiting || timelineEntriesEndWithStatusSurface(input.entries)) {
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

function timelineEntriesEndWithUserMessage(entries: ReadonlyArray<TimelineEntry>): boolean {
  const lastEntry = entries.at(-1);
  return lastEntry?.kind === "message" && lastEntry.message.role === "user";
}

function timelineEntriesEndWithStatusSurface(entries: ReadonlyArray<TimelineEntry>): boolean {
  const lastEntry = entries.at(-1);
  if (!lastEntry) {
    return false;
  }
  if (lastEntry.kind === "runtime-tool" && lastEntry.tool.display?.kind === "subagent") {
    return lastEntry.tool.status === "running";
  }
  if (lastEntry.kind === "message") {
    return lastEntry.message.role === "assistant" && lastEntry.message.streaming === true;
  }
  return (
    lastEntry.kind === "runtime-extension-ui-request" && lastEntry.request.status === "pending"
  );
}

function mergeTransientTimelineEntries(
  entries: ReadonlyArray<TimelineEntry>,
  transientEntries: ReadonlyArray<TimelineEntry>,
): TimelineEntry[] {
  const result: TimelineEntry[] = [];
  const emittedEntryIds = new Set(entries.map((entry) => entry.id));
  let transientIndex = 0;

  for (const entry of entries) {
    while (
      transientIndex < transientEntries.length &&
      compareTimelineEntryCreatedAt(transientEntries[transientIndex]!.createdAt, entry.createdAt) <
        0
    ) {
      const transientEntry = transientEntries[transientIndex]!;
      if (!emittedEntryIds.has(transientEntry.id)) {
        emittedEntryIds.add(transientEntry.id);
        result.push(transientEntry);
      }
      transientIndex += 1;
    }
    result.push(entry);
  }

  while (transientIndex < transientEntries.length) {
    const transientEntry = transientEntries[transientIndex]!;
    if (!emittedEntryIds.has(transientEntry.id)) {
      emittedEntryIds.add(transientEntry.id);
      result.push(transientEntry);
    }
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
