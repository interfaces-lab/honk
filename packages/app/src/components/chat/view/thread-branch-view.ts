import {
  formatThreadEntryPathIssue,
  resolveThreadEntryPath,
  type MessageId,
  type OrchestrationChatTimelineRow,
  type OrchestrationThreadActivity,
  type ThreadEntryId,
  type TurnId,
} from "@multi/contracts";

import type { ChatMessage, ProposedPlan, Thread, ThreadTreeEntry } from "../../../types";
import {
  deriveWorkLogEntries,
  type TimelineEntry,
  type WorkLogDerivationOptions,
  type WorkLogEntry,
} from "../../../session-logic";

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
  activities: OrchestrationThreadActivity[],
  branchView: ThreadBranchView,
): OrchestrationThreadActivity[] {
  const turnIds = branchView.turnIds;
  if (branchView.status === "invalid") {
    return [];
  }
  if (!turnIds) {
    return activities;
  }
  return activities.filter((activity) => activity.turnId !== null && turnIds.has(activity.turnId));
}

export function filterChatTimelineRowsToBranch(
  rows: ReadonlyArray<OrchestrationChatTimelineRow>,
  branchView: ThreadBranchView,
): OrchestrationChatTimelineRow[] {
  if (branchView.status === "invalid") {
    return [];
  }
  if (branchView.status === "unfiltered") {
    return [...rows];
  }

  const messageIds = branchView.messageIds;
  const entryIds = branchView.entryIds;
  const turnIds = branchView.turnIds;

  return rows.filter((row) => {
    switch (row.kind) {
      case "message":
        if (row.entryId !== null) {
          return entryIds?.has(row.entryId) ?? false;
        }
        return messageIds?.has(row.messageId) ?? false;
      case "work":
        return row.turnId === null || (turnIds?.has(row.turnId) ?? false);
      case "proposed-plan":
        return row.turnId !== null && (turnIds?.has(row.turnId) ?? false);
    }
  });
}

export function materializeTimelineEntriesFromChatTimelineRows(input: {
  rows: ReadonlyArray<OrchestrationChatTimelineRow>;
  messages: ReadonlyArray<ChatMessage>;
  proposedPlans: ReadonlyArray<ProposedPlan>;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  workLogOptions?: WorkLogDerivationOptions;
}): TimelineEntry[] {
  const messagesById = new Map(input.messages.map((message) => [message.id, message] as const));
  const proposedPlansById = new Map(
    input.proposedPlans.map((proposedPlan) => [proposedPlan.id, proposedPlan] as const),
  );
  const activitiesById = new Map(
    input.activities.map((activity) => [activity.id, activity] as const),
  );
  const workEntriesByRowId = buildWorkEntriesByTimelineRowId({
    rows: input.rows,
    activities: input.activities,
    ...(input.workLogOptions ? { workLogOptions: input.workLogOptions } : {}),
  });
  const entries: TimelineEntry[] = [];

  for (const row of input.rows) {
    switch (row.kind) {
      case "message": {
        const message = messagesById.get(row.messageId);
        if (!message) {
          continue;
        }
        entries.push({
          id: row.id,
          kind: "message",
          createdAt: row.createdAt,
          message,
        });
        break;
      }
      case "proposed-plan": {
        const proposedPlan = proposedPlansById.get(row.planId);
        if (!proposedPlan) {
          continue;
        }
        entries.push({
          id: row.id,
          kind: "proposed-plan",
          createdAt: row.createdAt,
          proposedPlan,
        });
        break;
      }
      case "work": {
        const workEntry = workEntriesByRowId.get(row.id);
        if (!workEntry) {
          continue;
        }
        entries.push({
          id: row.id,
          kind: "work",
          createdAt: row.createdAt,
          entry: workEntry,
        });
        break;
      }
    }
  }

  return entries;
}

function buildWorkEntriesByTimelineRowId(input: {
  rows: ReadonlyArray<OrchestrationChatTimelineRow>;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  workLogOptions?: WorkLogDerivationOptions;
}): Map<string, WorkLogEntry> {
  const relevantActivityIds = new Set<string>();
  const visibleParentItemIds = new Set<string>();
  const visibleProviderThreadIds = new Set<string>();

  for (const row of input.rows) {
    if (row.kind === "work") {
      for (const activityId of row.activityIds) {
        relevantActivityIds.add(activityId);
      }
      if (row.toolCallId) {
        visibleParentItemIds.add(row.toolCallId);
      }
      continue;
    }
  }

  for (const activity of input.activities) {
    if (!isSubagentRuntimeActivity(activity)) {
      continue;
    }
    const payload = asRecord(activity.payload);
    const parentItemId = asTrimmedString(payload?.parentItemId);
    const providerThreadId = asTrimmedString(payload?.providerThreadId);
    if (parentItemId && visibleParentItemIds.has(parentItemId) && providerThreadId) {
      visibleProviderThreadIds.add(providerThreadId);
    }
  }

  const relevantActivities = input.activities.filter((activity) => {
    if (relevantActivityIds.has(activity.id)) {
      return true;
    }
    if (!isSubagentRuntimeActivity(activity)) {
      return false;
    }
    const payload = asRecord(activity.payload);
    const parentItemId = asTrimmedString(payload?.parentItemId);
    const providerThreadId = asTrimmedString(payload?.providerThreadId);
    return (
      (parentItemId !== undefined && visibleParentItemIds.has(parentItemId)) ||
      (providerThreadId !== undefined && visibleProviderThreadIds.has(providerThreadId))
    );
  });

  const workEntries = deriveWorkLogEntries(
    relevantActivities,
    undefined,
    input.workLogOptions ?? {},
  );
  const byRowId = new Map<string, WorkLogEntry>();
  for (const workEntry of workEntries) {
    if (workEntry.isToolSummary) {
      byRowId.set(`tool-summary:${workEntry.id}`, workEntry);
      continue;
    }
    byRowId.set(`work:${workEntry.id}`, workEntry);
    byRowId.set(`work:activity:${workEntry.id}`, workEntry);
    byRowId.set(`global-status:${workEntry.id}`, workEntry);
  }
  return byRowId;
}

function isSubagentRuntimeActivity(activity: OrchestrationThreadActivity): boolean {
  return activity.kind.startsWith("subagent.");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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
