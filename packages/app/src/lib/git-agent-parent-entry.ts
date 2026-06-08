import {
  isOrchestrationPersistedMessageId,
  threadEntryIdForMessageId,
  type MessageId,
  type ThreadEntryId,
} from "@multi/contracts";
import type { Thread } from "~/types";

function isPersistedGitAgentParentEntry(
  entry: Thread["entries"][number],
  canonicalMessageIds: ReadonlySet<MessageId>,
  hasValidPath: (entryId: ThreadEntryId) => boolean,
): boolean {
  return (
    entry.kind === "message" &&
    entry.messageId !== null &&
    isOrchestrationPersistedMessageId(entry.messageId) &&
    canonicalMessageIds.has(entry.messageId) &&
    entry.id === threadEntryIdForMessageId(entry.messageId) &&
    hasValidPath(entry.id)
  );
}

export function resolveGitAgentParentEntryId(thread: Thread | null): ThreadEntryId | undefined {
  if (!thread) {
    return undefined;
  }

  const entryById = new Map(thread.entries.map((entry) => [entry.id, entry] as const));
  const hasValidPath = (entryId: ThreadEntryId): boolean => {
    const seen = new Set<ThreadEntryId>();
    let cursor: ThreadEntryId | null = entryId;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        return false;
      }
      seen.add(cursor);
      const entry = entryById.get(cursor);
      if (!entry) {
        return false;
      }
      cursor = entry.parentEntryId;
    }
    return true;
  };

  const canonicalMessageIds = new Set<MessageId>(thread.messages.map((message) => message.id));
  const isPersistedParentEntry = (entry: Thread["entries"][number]) =>
    isPersistedGitAgentParentEntry(entry, canonicalMessageIds, hasValidPath);

  if (thread.leafId !== null) {
    const leafEntry = entryById.get(thread.leafId);
    if (leafEntry && isPersistedParentEntry(leafEntry)) {
      return thread.leafId;
    }
  }

  return thread.entries
    .filter(isPersistedParentEntry)
    .toSorted((left, right) => {
      const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
      return createdAtComparison === 0 ? left.id.localeCompare(right.id) : createdAtComparison;
    })
    .at(-1)?.id;
}
