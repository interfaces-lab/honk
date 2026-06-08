import {
  formatThreadEntryPathIssue,
  resolveThreadEntryPath,
  type MessageId,
  type OrchestrationThreadActivity,
  type ThreadEntryId,
  type TurnId,
} from "@multi/contracts";

import type { ChatMessage, Thread, ThreadTreeEntry } from "../../../types";

/**
 * Result of projecting a thread tree onto a single branch path. When `status`
 * is `"unfiltered"` the timeline should render the thread as-is. `"valid"`
 * carries the messages and turns to include. `"invalid"` reports a structural
 * problem so the caller can show an error banner instead of silently dropping
 * messages.
 */
export interface ThreadBranchView {
  status: "unfiltered" | "valid" | "invalid";
  entryId: ThreadEntryId | null;
  entryIds: ReadonlySet<ThreadEntryId> | null;
  messageIds: ReadonlySet<MessageId> | null;
  turnIds: ReadonlySet<TurnId> | null;
  issue: string | null;
}

export function deriveThreadBranchView(
  thread: Thread | null,
  targetEntryId: ThreadEntryId | null | undefined,
): ThreadBranchView {
  const unfiltered: ThreadBranchView = {
    status: "unfiltered",
    entryId: null,
    entryIds: null,
    messageIds: null,
    turnIds: null,
    issue: null,
  };
  if (!thread) {
    return unfiltered;
  }

  const entries = thread.entries;
  const entryId = targetEntryId ?? thread.leafId ?? null;
  if (entryId === null || entries.length === 0) {
    return unfiltered;
  }

  const path = resolveThreadEntryPath({ entries, entryId });
  if (!path.ok) {
    return {
      status: "invalid",
      entryId,
      entryIds: null,
      messageIds: null,
      turnIds: null,
      issue: formatThreadEntryPathIssue(path),
    };
  }

  const messageById = new Map(thread.messages.map((message) => [message.id, message] as const));
  const entryIds = new Set<ThreadEntryId>();
  const messageIds = new Set<MessageId>();
  const turnIds = new Set<TurnId>();
  for (const entry of path.entries) {
    entryIds.add(entry.id);
    if (entry.turnId !== null) {
      turnIds.add(entry.turnId);
    }
    if (entry.kind !== "message" || entry.messageId === null) {
      continue;
    }
    messageIds.add(entry.messageId);
    const message = messageById.get(entry.messageId);
    if (!message) {
      return {
        status: "invalid",
        entryId,
        entryIds: null,
        messageIds: null,
        turnIds: null,
        issue: `Thread entry '${entry.id}' points to missing message '${entry.messageId}'.`,
      };
    }
    if (message?.turnId) {
      turnIds.add(message.turnId);
    }
  }

  return {
    status: "valid",
    entryId,
    entryIds,
    messageIds,
    turnIds,
    issue: null,
  };
}

export function filterMessagesToBranch(
  messages: ChatMessage[],
  branchView: ThreadBranchView,
): ChatMessage[] {
  const messageIds = branchView.messageIds;
  if (branchView.status === "invalid") {
    return [];
  }
  if (!messageIds) {
    return messages;
  }
  return messages.filter((message) => messageIds.has(message.id));
}

export function filterActivitiesToBranch(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  branchView: ThreadBranchView,
): ReadonlyArray<OrchestrationThreadActivity> {
  const turnIds = branchView.turnIds;
  if (branchView.status === "invalid") {
    return [];
  }
  if (!turnIds) {
    return activities;
  }
  return activities.filter((activity) => activity.turnId !== null && turnIds.has(activity.turnId));
}

export function containsThreadEntry(
  thread: Thread | null,
  entryId: ThreadEntryId | null | undefined,
): entryId is ThreadEntryId {
  if (!thread || !entryId) {
    return false;
  }
  return resolveThreadEntryPath({ entries: thread.entries, entryId }).ok;
}

export function findThreadMessageEntry(
  thread: Thread | null,
  messageId: MessageId | null | undefined,
): ThreadTreeEntry | null {
  if (!thread || !messageId) {
    return null;
  }
  return (
    thread.entries.find((entry) => entry.kind === "message" && entry.messageId === messageId) ??
    null
  );
}
