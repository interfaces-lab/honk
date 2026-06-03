import type { MessageId, ThreadEntryId } from "@multi/contracts";

import type { TimelineEntry } from "../../../session-logic";
import type { ChatMessage, PendingTimelineRow } from "../../../types";
import type { ThreadBranchView } from "./thread-branch-view";

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
): PendingTimelineRow[] {
  if (branchView.status === "invalid") {
    return [];
  }
  if (branchView.status === "unfiltered") {
    return [...rows];
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
): ChatMessage[] {
  if (pendingRows.length === 0) {
    return [...messages];
  }

  const committedMessageIds = new Set(messages.map((message) => message.id));
  const pendingMessages = pendingRows.flatMap((row) =>
    committedMessageIds.has(row.clientSendKey) ? [] : [row.message],
  );
  return pendingMessages.length === 0 ? [...messages] : [...messages, ...pendingMessages];
}

export function appendTransientTimelineEntries(input: {
  entries: ReadonlyArray<TimelineEntry>;
  liveMessages: ReadonlyArray<ChatMessage>;
  pendingRows: ReadonlyArray<PendingTimelineRow>;
}): TimelineEntry[] {
  const existingMessageIds = new Set(
    input.entries.flatMap((entry) => (entry.kind === "message" ? [entry.message.id] : [])),
  );
  const transientEntries: TimelineEntry[] = [];

  for (const message of input.liveMessages) {
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
    return [...input.entries];
  }

  return [...input.entries, ...transientEntries].toSorted(compareTimelineEntries);
}

export function acknowledgedPendingTimelineRows(input: {
  pendingRows: ReadonlyArray<PendingTimelineRow>;
  committedMessages: ReadonlyArray<ChatMessage>;
}): PendingTimelineRow[] {
  const committedMessageIds = new Set(input.committedMessages.map((message) => message.id));
  return input.pendingRows.filter((row) => committedMessageIds.has(row.clientSendKey));
}

export function unacknowledgedPendingTimelineRows(input: {
  pendingRows: ReadonlyArray<PendingTimelineRow>;
  committedMessages: ReadonlyArray<ChatMessage>;
}): PendingTimelineRow[] {
  const acknowledgedRows = new Set(acknowledgedPendingTimelineRows(input));
  return input.pendingRows.filter((row) => !acknowledgedRows.has(row));
}

export function pendingTimelineRowMessages(
  rows: ReadonlyArray<PendingTimelineRow>,
): ChatMessage[] {
  return rows.map((row) => row.message);
}

function compareTimelineEntries(left: TimelineEntry, right: TimelineEntry): number {
  const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
  return createdAtOrder === 0 ? left.id.localeCompare(right.id) : createdAtOrder;
}

function timelineMessageRowId(messageId: MessageId): string {
  return `message:${messageId}`;
}
