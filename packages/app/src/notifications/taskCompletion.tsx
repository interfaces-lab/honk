import { type EnvironmentId, type ThreadId } from "@multi/contracts";
import { useRouter } from "@tanstack/react-router";
import { useRef } from "react";
import { toastManager } from "~/app/toast";
import { openThread } from "~/app/chat-navigation";
import { scopeThreadRef } from "~/lib/environment-scope";
import { useRouteTarget } from "~/routes/-thread-route-targets";
import { useComposerDraftStore } from "~/stores/chat-drafts";
import { selectSidebarThreadsAcrossEnvironments, useStore } from "../stores/thread-store";
import type { SidebarThreadSummary } from "../types";
import { useMountEffect } from "~/hooks/use-mount-effect";
import {
  buildInputNeededCopy,
  buildTaskCompletionCopy,
  shouldSuppressVisibleThreadNotification,
  type CompletedThreadCandidate,
  type ThreadAttentionCandidate,
} from "./task-completion-candidates";

export type BrowserNotificationPermissionState =
  | NotificationPermission
  | "unsupported"
  | "insecure";

function isBrowserNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function readBrowserNotificationPermissionState(): BrowserNotificationPermissionState {
  if (typeof window === "undefined") {
    return "unsupported";
  }
  if (!isBrowserNotificationSupported()) {
    return "unsupported";
  }
  if (!window.isSecureContext) {
    return "insecure";
  }
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermissionState> {
  const current = readBrowserNotificationPermissionState();
  if (current === "unsupported" || current === "insecure" || current === "denied") {
    return current;
  }
  if (current === "granted") {
    return current;
  }
  return Notification.requestPermission();
}

function isWindowForeground(): boolean {
  if (typeof document === "undefined") {
    return true;
  }
  return document.visibilityState === "visible" && document.hasFocus();
}

interface ThreadNotificationCopy {
  title: string;
  body: string;
}

const SEEN_ATTENTION_NOTIFICATION_IDS_KEY = "multi.seenAttentionNotificationIds.v1";
const MAX_SEEN_ATTENTION_NOTIFICATION_IDS = 200;

function readSeenAttentionNotificationIds(): Set<string> {
  if (typeof window === "undefined") {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(SEEN_ATTENTION_NOTIFICATION_IDS_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function markAttentionNotificationSeen(requestId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const ids = [...readSeenAttentionNotificationIds(), requestId].slice(
      -MAX_SEEN_ATTENTION_NOTIFICATION_IDS,
    );
    window.localStorage.setItem(SEEN_ATTENTION_NOTIFICATION_IDS_KEY, JSON.stringify(ids));
  } catch {
    // Notification de-duplication is best effort.
  }
}

function focusThread(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  router: ReturnType<typeof useRouter>,
): void {
  void openThread(router, scopeThreadRef(environmentId, threadId));
}

async function showSystemThreadNotification(
  copy: ThreadNotificationCopy,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  router: ReturnType<typeof useRouter>,
): Promise<boolean> {
  const { body, title } = copy;

  if (readBrowserNotificationPermissionState() !== "granted") {
    return false;
  }

  const notification = new Notification(title, {
    body,
    tag: `thread-notification:${threadId}`,
  });
  notification.addEventListener("click", () => {
    window.focus();
    focusThread(environmentId, threadId, router);
  });
  return true;
}

function showThreadToast(
  copy: ThreadNotificationCopy,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  tone: "success" | "warning",
  router: ReturnType<typeof useRouter>,
): void {
  const { body, title } = copy;
  toastManager.add({
    type: tone,
    title,
    description: body,
    data: {
      threadId,
      dismissAfterVisibleMs: 8000,
    },
    actionProps: {
      children: "Open",
      onClick: () => focusThread(environmentId, threadId, router),
    },
  });
}

function isPlanReviewAttentionSummary(summary: SidebarThreadSummary): boolean {
  return summary.hasActionableProposedPlan;
}

function isRunningSummary(summary: SidebarThreadSummary | undefined): boolean {
  const status = summary?.session?.status;
  return status === "running" || status === "connecting";
}

function hadUnsettledSummary(summary: SidebarThreadSummary | undefined): boolean {
  if (!summary) {
    return false;
  }
  const latestTurn = summary.latestTurn;
  if (latestTurn?.state === "running") {
    return true;
  }
  return !latestTurn?.completedAt && isRunningSummary(summary);
}

function isCompletionSummarySettled(summary: SidebarThreadSummary | undefined): boolean {
  if (!summary?.latestTurn?.startedAt || !summary.latestTurn.completedAt) {
    return false;
  }
  return summary.session?.orchestrationStatus !== "running";
}

function collectCompletedSummaryCandidates(
  previousSummaries: readonly SidebarThreadSummary[],
  nextSummaries: readonly SidebarThreadSummary[],
): CompletedThreadCandidate[] {
  const previousById = new Map(previousSummaries.map((summary) => [summary.id, summary] as const));
  const candidates: CompletedThreadCandidate[] = [];

  for (const summary of nextSummaries) {
    const previousSummary = previousById.get(summary.id);
    if (!previousSummary) {
      continue;
    }

    const completedAt = summary.latestTurn?.completedAt;
    if (!completedAt || !isCompletionSummarySettled(summary)) {
      continue;
    }
    if (!previousSummary.session && !previousSummary.latestTurn?.completedAt) {
      continue;
    }
    if (!hadUnsettledSummary(previousSummary) && !previousSummary.latestTurn?.completedAt) {
      continue;
    }
    if (
      previousSummary.latestTurn?.turnId === summary.latestTurn?.turnId &&
      isCompletionSummarySettled(previousSummary)
    ) {
      continue;
    }

    candidates.push({
      threadId: summary.id,
      projectId: summary.projectId,
      environmentId: summary.environmentId,
      title: summary.title,
      completedAt,
      assistantSummary: null,
    });
  }

  return candidates;
}

function collectInputNeededSummaryCandidates(
  previousSummaries: readonly SidebarThreadSummary[],
  nextSummaries: readonly SidebarThreadSummary[],
): ThreadAttentionCandidate[] {
  const previousById = new Map(previousSummaries.map((summary) => [summary.id, summary] as const));
  const candidates: ThreadAttentionCandidate[] = [];

  for (const summary of nextSummaries) {
    const previousSummary = previousById.get(summary.id);
    if (!previousSummary) {
      continue;
    }

    if (summary.hasPendingApprovals && !previousSummary.hasPendingApprovals) {
      candidates.push({
        kind: "approval",
        threadId: summary.id,
        projectId: summary.projectId,
        environmentId: summary.environmentId,
        title: summary.title,
        requestId: `approval:${summary.id}:${
          summary.latestTurn?.turnId ?? summary.updatedAt ?? summary.createdAt
        }`,
        createdAt: summary.updatedAt ?? summary.createdAt,
        summary: "Approval requested.",
      });
    }

    if (
      summary.hasPendingUserInput &&
      !previousSummary.hasPendingUserInput &&
      !isPlanReviewAttentionSummary(summary)
    ) {
      candidates.push({
        kind: "user-input",
        threadId: summary.id,
        projectId: summary.projectId,
        environmentId: summary.environmentId,
        title: summary.title,
        requestId: `user-input:${summary.id}:${
          summary.latestTurn?.turnId ?? summary.updatedAt ?? summary.createdAt
        }`,
        createdAt: summary.updatedAt ?? summary.createdAt,
        summary: "User input requested.",
      });
    }
  }

  return candidates.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function useVisibleThreadIdsFromRoute(): ReadonlySet<ThreadId> {
  const routeTarget = useRouteTarget();
  const activeDraftSession = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );

  if (routeTarget?.kind === "server") {
    return new Set([routeTarget.threadRef.threadId]);
  }
  if (routeTarget?.kind === "draft" && activeDraftSession) {
    return new Set([activeDraftSession.threadId]);
  }
  return new Set<ThreadId>();
}

export function TaskCompletionNotifications() {
  const router = useRouter();
  const routerRef = useRef(router);
  const visibleThreadIds = useVisibleThreadIdsFromRoute();
  const visibleThreadIdsRef = useRef(visibleThreadIds);
  routerRef.current = router;
  visibleThreadIdsRef.current = visibleThreadIds;

  useMountEffect(() => {
    let previousThreads = selectSidebarThreadsAcrossEnvironments(useStore.getState());

    return useStore.subscribe((state) => {
      const threads = selectSidebarThreadsAcrossEnvironments(state);
      emitTaskCompletionNotifications(
        previousThreads,
        threads,
        routerRef.current,
        visibleThreadIdsRef.current,
      );
      previousThreads = threads;
    });
  });

  return null;
}

function emitTaskCompletionNotifications(
  previousThreads: readonly SidebarThreadSummary[],
  threads: readonly SidebarThreadSummary[],
  router: ReturnType<typeof useRouter>,
  visibleThreadIds: ReadonlySet<ThreadId>,
): void {
  const completions = collectCompletedSummaryCandidates(previousThreads, threads);
  const inputNeededCandidates = collectInputNeededSummaryCandidates(previousThreads, threads);

  if (completions.length === 0 && inputNeededCandidates.length === 0) {
    return;
  }

  const windowForeground = isWindowForeground();
  const shouldAttemptSystemNotification = !windowForeground;
  const seenAttentionNotificationIds = readSeenAttentionNotificationIds();

  for (const completion of completions) {
    const copy = buildTaskCompletionCopy(completion);
    if (shouldAttemptSystemNotification) {
      void showSystemThreadNotification(
        copy,
        completion.environmentId,
        completion.threadId,
        router,
      );
    }
  }

  for (const candidate of inputNeededCandidates) {
    if (seenAttentionNotificationIds.has(candidate.requestId)) {
      continue;
    }

    markAttentionNotificationSeen(candidate.requestId);

    const suppressVisibleThreadNotification = shouldSuppressVisibleThreadNotification({
      threadId: candidate.threadId,
      visibleThreadIds,
      windowForeground,
    });
    if (suppressVisibleThreadNotification) {
      continue;
    }

    const copy = buildInputNeededCopy(candidate);
    showThreadToast(copy, candidate.environmentId, candidate.threadId, "warning", router);

    if (shouldAttemptSystemNotification) {
      void showSystemThreadNotification(
        copy,
        candidate.environmentId,
        candidate.threadId,
        router,
      );
    }
  }
}

export function buildNotificationSettingsSupportText(
  permissionState: BrowserNotificationPermissionState,
): string {
  switch (permissionState) {
    case "granted":
      return "Browser notifications are enabled for this app.";
    case "denied":
      return "Browser notifications are blocked. Re-enable them in your browser site settings.";
    case "insecure":
      return "Browser notifications need a secure context. Localhost works; plain HTTP does not.";
    case "unsupported":
      return "This browser does not support desktop notifications.";
    case "default":
      return "Allow browser notifications to get alerts when chats or terminal agents finish or need input in the background.";
  }
}
