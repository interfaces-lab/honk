import { type EnvironmentId, type ThreadId } from "@multi/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { toastManager } from "~/app/toast";
import { selectSidebarThreadsAcrossEnvironments, useStore } from "../store";
import type { SidebarThreadSummary } from "../types";
import {
  buildInputNeededCopy,
  buildTaskCompletionCopy,
  type CompletedThreadCandidate,
  type ThreadAttentionCandidate,
} from "./taskCompletion.logic";

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

function focusThread(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  navigate: ReturnType<typeof useNavigate>,
): void {
  void navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId },
  });
}

async function showSystemThreadNotification(
  copy: ThreadNotificationCopy,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  navigate: ReturnType<typeof useNavigate>,
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
    focusThread(environmentId, threadId, navigate);
  });
  return true;
}

function showThreadToast(
  copy: ThreadNotificationCopy,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  tone: "success" | "warning",
  navigate: ReturnType<typeof useNavigate>,
): void {
  const { body, title } = copy;
  toastManager.add({
    type: tone,
    title,
    description: body,
    data: {
      allowCrossThreadVisibility: true,
      threadId,
      dismissAfterVisibleMs: 8000,
    },
    actionProps: {
      children: "Open",
      onClick: () => focusThread(environmentId, threadId, navigate),
    },
  });
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

    if (summary.hasPendingUserInput && !previousSummary.hasPendingUserInput) {
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

export function TaskCompletionNotifications() {
  const navigate = useNavigate();
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const previousThreadsRef = useRef<readonly SidebarThreadSummary[]>([]);
  const readyRef = useRef(false);

  useEffect(() => {
    if (!readyRef.current) {
      previousThreadsRef.current = threads;
      readyRef.current = true;
      return;
    }

    const previousThreads = previousThreadsRef.current;
    const completions = collectCompletedSummaryCandidates(previousThreads, threads);
    const inputNeededCandidates = collectInputNeededSummaryCandidates(previousThreads, threads);
    previousThreadsRef.current = threads;

    if (completions.length === 0 && inputNeededCandidates.length === 0) {
      return;
    }

    const shouldAttemptSystemNotification = window.desktopBridge ? true : !isWindowForeground();

    for (const completion of completions) {
      const copy = buildTaskCompletionCopy(completion);
      if (shouldAttemptSystemNotification) {
        void showSystemThreadNotification(
          copy,
          completion.environmentId,
          completion.threadId,
          navigate,
        );
      }
    }

    for (const candidate of inputNeededCandidates) {
      const copy = buildInputNeededCopy(candidate);
      showThreadToast(copy, candidate.environmentId, candidate.threadId, "warning", navigate);

      if (shouldAttemptSystemNotification) {
        void showSystemThreadNotification(
          copy,
          candidate.environmentId,
          candidate.threadId,
          navigate,
        );
      }
    }
  }, [navigate, threads]);

  return null;
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
