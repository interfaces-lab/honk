import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { toastManager } from "~/app/toast";
import { selectThreadsAcrossEnvironments, useStore } from "../store";
import type { Thread } from "../types";
import {
  buildInputNeededCopy,
  buildTaskCompletionCopy,
  collectCompletedThreadCandidates,
  collectInputNeededThreadCandidates,
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
  environmentId: Thread["environmentId"],
  threadId: Thread["id"],
  navigate: ReturnType<typeof useNavigate>,
): void {
  void navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId },
  });
}

async function showSystemThreadNotification(
  copy: ThreadNotificationCopy,
  environmentId: Thread["environmentId"],
  threadId: Thread["id"],
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
  environmentId: Thread["environmentId"],
  threadId: Thread["id"],
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

export function TaskCompletionNotifications() {
  const navigate = useNavigate();
  const threads = useStore(useShallow(selectThreadsAcrossEnvironments));
  const previousThreadsRef = useRef<readonly Thread[]>([]);
  const readyRef = useRef(false);

  useEffect(() => {
    if (!readyRef.current) {
      previousThreadsRef.current = threads;
      readyRef.current = true;
      return;
    }

    const completions = collectCompletedThreadCandidates(previousThreadsRef.current, threads);
    const inputNeededCandidates = collectInputNeededThreadCandidates(
      previousThreadsRef.current,
      threads,
    );
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
