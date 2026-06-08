import type { MessageId, ThreadEntryId } from "@multi/contracts";

import type { TimelineEntry } from "../../../session-logic";
import type { ChatMessage, PendingTimelineRow } from "../../../types";
import type { ThreadBranchView } from "./thread-branch-view";
import { timelineMessageEntryId } from "./timeline-entry-ids";

export function createPendingTimelineRow(input: {
  messageId: MessageId;
  text: string;
  richText?: ChatMessage["richText"] | undefined;
  attachments?: ChatMessage["attachments"] | undefined;
  createdAt: string;
  parentEntryId: ThreadEntryId | null;
}): PendingTimelineRow {
  return createPendingTimelineRowFromMessage({
    parentEntryId: input.parentEntryId,
    message: {
      id: input.messageId,
      role: "user",
      text: input.text,
      ...(input.richText !== undefined ? { richText: input.richText } : {}),
      ...(input.attachments !== undefined && input.attachments.length > 0
        ? { attachments: input.attachments }
        : {}),
      createdAt: input.createdAt,
      streaming: false,
    },
  });
}

export function createPendingTimelineRowFromMessage(input: {
  message: ChatMessage & { role: "user" };
  parentEntryId: ThreadEntryId | null;
}): PendingTimelineRow {
  return {
    id: timelineMessageRowId(input.message.id),
    clientSendKey: input.message.id,
    parentEntryId: input.parentEntryId,
    message: {
      ...input.message,
      role: "user",
      streaming: false,
    },
  };
}

export function filterPendingTimelineRowsToBranch(
  rows: ReadonlyArray<PendingTimelineRow>,
  branchView: ThreadBranchView,
): ReadonlyArray<PendingTimelineRow> {
  if (branchView.status === "invalid") {
    return [];
  }
  if (branchView.status === "unfiltered") {
    return rows;
  }

  return rows.filter((row) => {
    if (row.parentEntryId === null) {
      return true;
    }
    return branchView.entryIds?.has(row.parentEntryId) ?? false;
  });
}

export function appendPendingTimelineRowsToMessages(
  messages: ReadonlyArray<ChatMessage>,
  pendingRows: ReadonlyArray<PendingTimelineRow>,
): ReadonlyArray<ChatMessage> {
  if (pendingRows.length === 0) {
    return messages;
  }

  const committedMessageIds = new Set(messages.map((message) => message.id));
  const pendingMessages = pendingRows.flatMap((row) =>
    committedMessageIds.has(row.clientSendKey) ? [] : [row.message],
  );
  return pendingMessages.length === 0 ? messages : [...messages, ...pendingMessages];
}

export function appendTransientTimelineEntries(input: {
  entries: ReadonlyArray<TimelineEntry>;
  messages: ReadonlyArray<ChatMessage>;
  pendingRows: ReadonlyArray<PendingTimelineRow>;
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
        id: timelineMessageRowId(message.id),
        kind: "message",
        createdAt: message.createdAt,
        message,
      });
    }
  }

  for (const row of input.pendingRows) {
    if (existingMessageIds.has(row.clientSendKey)) {
      continue;
    }
    existingMessageIds.add(row.clientSendKey);
    transientEntries.push({
      id: row.id,
      kind: "message",
      createdAt: row.message.createdAt,
      message: row.message,
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

export function materializePendingUserTimelineEntries(
  pendingRows: ReadonlyArray<PendingTimelineRow>,
): TimelineEntry[] {
  return pendingRows.map((row) => ({
    id: row.id,
    kind: "message",
    createdAt: row.message.createdAt,
    message: row.message,
  }));
}

export function appendPendingUserTimelineEntries(input: {
  entries: ReadonlyArray<TimelineEntry>;
  pendingRows: ReadonlyArray<PendingTimelineRow>;
}): ReadonlyArray<TimelineEntry> {
  if (input.pendingRows.length === 0) {
    return input.entries;
  }
  const existingMessageIds = new Set(
    input.entries.flatMap((entry) => (entry.kind === "message" ? [entry.message.id] : [])),
  );
  const pendingEntries = materializePendingUserTimelineEntries(
    input.pendingRows.filter((row) => !existingMessageIds.has(row.clientSendKey)),
  );
  if (pendingEntries.length === 0) {
    return input.entries;
  }
  return mergeTransientTimelineEntries(
    input.entries,
    pendingEntries.toSorted(compareTransientEntries),
  );
}

export function appendMissingRuntimeTimelineMessageEntries(input: {
  entries: ReadonlyArray<TimelineEntry>;
  messages: ReadonlyArray<ChatMessage>;
  pendingRows: ReadonlyArray<PendingTimelineRow>;
}): ReadonlyArray<TimelineEntry> {
  const coverage = runtimeTimelineMessageCoverage(input.entries);
  const missingMessageEntries: TimelineEntry[] = [];

  for (const message of input.messages) {
    if (runtimeTimelineCoversMessage(coverage, message)) {
      continue;
    }
    coverage.messageIds.add(message.id);
    missingMessageEntries.push({
      id: timelineMessageRowId(message.id),
      kind: "message",
      createdAt: message.createdAt,
      message,
    });
  }

  for (const row of input.pendingRows) {
    if (coverage.messageIds.has(row.clientSendKey)) {
      continue;
    }
    coverage.messageIds.add(row.clientSendKey);
    missingMessageEntries.push({
      id: row.id,
      kind: "message",
      createdAt: row.message.createdAt,
      message: row.message,
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

function runtimeTimelineMessageCoverage(entries: ReadonlyArray<TimelineEntry>): {
  messageIds: Set<MessageId>;
  nonUserTurnKeys: Set<string>;
} {
  const messageIds = new Set<MessageId>();
  const nonUserTurnKeys = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "message") {
      continue;
    }
    messageIds.add(entry.message.id);
    const turnKey = nonUserTurnCoverageKey(entry.message);
    if (turnKey) {
      nonUserTurnKeys.add(turnKey);
    }
  }
  return { messageIds, nonUserTurnKeys };
}

function runtimeTimelineCoversMessage(
  coverage: ReturnType<typeof runtimeTimelineMessageCoverage>,
  message: ChatMessage,
): boolean {
  if (coverage.messageIds.has(message.id)) {
    return true;
  }
  const turnKey = nonUserTurnCoverageKey(message);
  return turnKey !== null && coverage.nonUserTurnKeys.has(turnKey);
}

function nonUserTurnCoverageKey(message: ChatMessage): string | null {
  if (message.role === "user" || !message.turnId) {
    return null;
  }
  return `${message.role}:${message.turnId}`;
}

export function acknowledgedPendingTimelineRows(input: {
  pendingRows: ReadonlyArray<PendingTimelineRow>;
  committedMessages: ReadonlyArray<ChatMessage>;
  acknowledgedMessageIds?: ReadonlySet<MessageId> | undefined;
}): PendingTimelineRow[] {
  const committedMessageIds = new Set(input.committedMessages.map((message) => message.id));
  for (const messageId of input.acknowledgedMessageIds ?? []) {
    committedMessageIds.add(messageId);
  }
  return input.pendingRows.filter((row) => committedMessageIds.has(row.clientSendKey));
}

export function unacknowledgedPendingTimelineRows(input: {
  pendingRows: ReadonlyArray<PendingTimelineRow>;
  committedMessages: ReadonlyArray<ChatMessage>;
  acknowledgedMessageIds?: ReadonlySet<MessageId> | undefined;
}): PendingTimelineRow[] {
  const acknowledgedRows = new Set(acknowledgedPendingTimelineRows(input));
  return input.pendingRows.filter((row) => !acknowledgedRows.has(row));
}

export function pendingTimelineRowMessages(
  rows: ReadonlyArray<PendingTimelineRow>,
): ChatMessage[] {
  return rows.map((row) => row.message);
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
      transientEntries[transientIndex]!.createdAt.localeCompare(entry.createdAt) < 0
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
  const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
  return createdAtOrder === 0 ? left.id.localeCompare(right.id) : createdAtOrder;
}

function timelineMessageRowId(messageId: MessageId): string {
  return timelineMessageEntryId(messageId);
}
