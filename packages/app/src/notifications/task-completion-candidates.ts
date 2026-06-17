import type { RuntimeRequestKind } from "@honk/contracts";
import type { Thread } from "../types";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  hasActiveOrchestrationTurn,
  hasLiveLatestTurn,
} from "../session-logic";

export interface CompletedThreadCandidate {
  threadId: Thread["id"];
  projectId: Thread["projectId"];
  environmentId: Thread["environmentId"];
  title: string;
  completedAt: string;
  assistantSummary: string | null;
}

export interface ThreadAttentionCandidate {
  kind: "approval" | "user-input";
  threadId: Thread["id"];
  projectId: Thread["projectId"];
  environmentId: Thread["environmentId"];
  title: string;
  requestId: string;
  createdAt: string;
  requestKind?: RuntimeRequestKind;
  summary?: string;
}

function summarizeLatestAssistantMessage(thread: Thread): string | null {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (!message || message.role !== "assistant") {
      continue;
    }
    const trimmed = message.text.trim().replace(/\s+/g, " ");
    if (trimmed.length === 0) {
      continue;
    }
    return trimmed.length <= 140 ? trimmed : `${trimmed.slice(0, 137)}...`;
  }
  return null;
}

function hadUnsettledTurn(thread: Thread | undefined): boolean {
  if (!thread) {
    return false;
  }
  if (hasLiveLatestTurn(thread.latestTurn, thread.session)) {
    return true;
  }
  return hasActiveOrchestrationTurn(thread.latestTurn, thread.session);
}

function isCompletionNotificationSettled(thread: Thread | undefined): boolean {
  if (!thread?.latestTurn?.startedAt || !thread.latestTurn.completedAt) {
    return false;
  }
  return !hasActiveOrchestrationTurn(thread.latestTurn, thread.session);
}

export function collectCompletedThreadCandidates(
  previousThreads: readonly Thread[],
  nextThreads: readonly Thread[],
): CompletedThreadCandidate[] {
  const previousById = new Map(previousThreads.map((thread) => [thread.id, thread] as const));
  const candidates: CompletedThreadCandidate[] = [];

  for (const thread of nextThreads) {
    const previousThread = previousById.get(thread.id);
    if (!previousThread) {
      continue;
    }

    const completedAt = thread.latestTurn?.completedAt;
    if (!completedAt) {
      continue;
    }
    if (!isCompletionNotificationSettled(thread)) {
      continue;
    }
    if (!previousThread.session && !previousThread.latestTurn?.completedAt) {
      continue;
    }
    if (!hadUnsettledTurn(previousThread) && !previousThread.latestTurn?.completedAt) {
      continue;
    }
    if (
      previousThread.latestTurn?.turnId === thread.latestTurn?.turnId &&
      isCompletionNotificationSettled(previousThread)
    ) {
      continue;
    }

    candidates.push({
      threadId: thread.id,
      projectId: thread.projectId,
      environmentId: thread.environmentId,
      title: thread.title,
      completedAt,
      assistantSummary: summarizeLatestAssistantMessage(thread),
    });
  }

  return candidates;
}

function approvalSummary(requestKind: RuntimeRequestKind): string {
  switch (requestKind) {
    case "command":
      return "Command approval requested.";
    case "file-read":
      return "File-read approval requested.";
    case "file-change":
      return "File-change approval requested.";
    case "permissions":
      return "Permissions approval requested.";
    case "mcp-elicitation":
      return "MCP input requested.";
    case "dynamic-tool":
      return "Tool approval requested.";
    case "auth-refresh":
      return "Auth refresh requested.";
  }
}

export function collectThreadAttentionCandidates(
  previousThreads: readonly Thread[],
  nextThreads: readonly Thread[],
): ThreadAttentionCandidate[] {
  const previousById = new Map(previousThreads.map((thread) => [thread.id, thread] as const));
  const candidates: ThreadAttentionCandidate[] = [];

  for (const thread of nextThreads) {
    const previousThread = previousById.get(thread.id);
    if (!previousThread) {
      continue;
    }

    const previousApprovalIds = new Set(
      derivePendingApprovals(previousThread.activities).map((approval) => approval.requestId),
    );
    const previousUserInputIds = new Set(
      derivePendingUserInputs(previousThread.activities).map((request) => request.requestId),
    );

    for (const approval of derivePendingApprovals(thread.activities)) {
      if (previousApprovalIds.has(approval.requestId)) {
        continue;
      }
      candidates.push({
        kind: "approval",
        threadId: thread.id,
        projectId: thread.projectId,
        environmentId: thread.environmentId,
        title: thread.title,
        requestId: approval.requestId,
        createdAt: approval.createdAt,
        requestKind: approval.requestKind,
      });
    }

    for (const request of derivePendingUserInputs(thread.activities)) {
      if (previousUserInputIds.has(request.requestId)) {
        continue;
      }
      candidates.push({
        kind: "user-input",
        threadId: thread.id,
        projectId: thread.projectId,
        environmentId: thread.environmentId,
        title: thread.title,
        requestId: request.requestId,
        createdAt: request.createdAt,
      });
    }
  }

  return candidates.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function buildTaskCompletionCopy(candidate: CompletedThreadCandidate): {
  title: string;
  body: string;
} {
  const normalizedTitle = candidate.title.trim();
  const threadLabel = normalizedTitle.length > 0 ? normalizedTitle : "Untitled thread";

  return {
    title: threadLabel,
    body: candidate.assistantSummary || "Finished working.",
  };
}

export function buildThreadAttentionCopy(candidate: ThreadAttentionCandidate): {
  title: string;
  body: string;
} {
  const normalizedTitle = candidate.title.trim();
  const threadLabel = normalizedTitle.length > 0 ? normalizedTitle : "Untitled thread";
  const summary =
    candidate.summary ??
    (candidate.kind === "approval"
      ? approvalSummary(candidate.requestKind ?? "command")
      : "User input requested.");

  return {
    title: "Input needed",
    body: `${threadLabel}: ${summary}`,
  };
}

export function shouldSuppressVisibleThreadNotification(input: {
  threadId: Thread["id"];
  visibleThreadIds: ReadonlySet<Thread["id"]>;
  windowForeground: boolean;
}): boolean {
  return input.windowForeground && input.visibleThreadIds.has(input.threadId);
}

export const collectInputNeededThreadCandidates = collectThreadAttentionCandidates;

export const buildInputNeededCopy = buildThreadAttentionCopy;
