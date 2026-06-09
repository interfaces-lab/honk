import type { MessageId } from "@multi/contracts";

export function timelineMessageEntryId(messageId: MessageId): string {
  return `message:${messageId}`;
}

// Assistant rows are keyed by turn + occurrence so the row id survives every stage of the
// message lifecycle — live streaming item, settled session entry, committed message, reload.
// The payload upgrades in place; the row never re-keys, so the timeline never remounts it.
export function timelineTurnAssistantEntryId(turnId: string, index: number): string {
  return `message:turn:${turnId}:assistant:${index}`;
}

export function timelineTurnThinkingEntryId(turnId: string, index: number): string {
  return `thinking:turn:${turnId}:${index}`;
}
