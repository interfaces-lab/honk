import type { MessageId } from "@multi/contracts";

export function timelineMessageEntryId(messageId: MessageId): string {
  return `message:${messageId}`;
}
