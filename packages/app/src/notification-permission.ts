// Browser/OS notification permission store. Remote users need an explicit enable; desktop auto-grants.

import { useSyncExternalStore } from "react";

export type BrowserNotificationPermissionState =
  | NotificationPermission
  | "unsupported"
  | "insecure";

const listeners = new Set<() => void>();

let snapshot: BrowserNotificationPermissionState = readBrowserNotificationPermissionState();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function publish(next: BrowserNotificationPermissionState): void {
  if (snapshot === next) {
    return;
  }
  snapshot = next;
  notify();
}

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

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Re-read on subscribe so a late mount sees the current browser state.
  publish(readBrowserNotificationPermissionState());
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): BrowserNotificationPermissionState {
  return snapshot;
}

export function getServerSnapshot(): BrowserNotificationPermissionState {
  return "unsupported";
}

export function useNotificationPermission(): BrowserNotificationPermissionState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermissionState> {
  const current = readBrowserNotificationPermissionState();
  if (current === "unsupported" || current === "insecure" || current === "denied") {
    publish(current);
    return current;
  }
  if (current === "granted") {
    publish(current);
    return current;
  }
  const next = await Notification.requestPermission();
  publish(next);
  return next;
}

/** Refresh from the browser (e.g. after the user changes site settings in another tab). */
export function refreshNotificationPermission(): BrowserNotificationPermissionState {
  const next = readBrowserNotificationPermissionState();
  publish(next);
  return next;
}

export function buildNotificationSettingsSupportText(
  permissionState: BrowserNotificationPermissionState,
): string {
  switch (permissionState) {
    case "granted":
      return "Desktop notifications are enabled for this app.";
    case "denied":
      return "Notifications are blocked. Re-enable them in your browser site settings.";
    case "insecure":
      return "Notifications need a secure context. Localhost works; plain HTTP does not.";
    case "unsupported":
      return "This browser does not support desktop notifications.";
    case "default":
      return "Allow notifications to get alerts when threads finish or need input in the background.";
  }
}

/**
 * Fire a Web Notification when permission is granted. Tag coalesces per thread.
 * Click focuses the window; the caller supplies the focus/open handler.
 */
export function showSystemThreadNotification(input: {
  readonly title: string;
  readonly body: string;
  readonly threadId: string;
  readonly onClick: () => void;
}): boolean {
  if (readBrowserNotificationPermissionState() !== "granted") {
    return false;
  }
  const notification = new Notification(input.title, {
    body: input.body,
    tag: `thread-notification:${input.threadId}`,
  });
  notification.addEventListener("click", () => {
    window.focus();
    input.onClick();
  });
  return true;
}

export function isWindowForeground(): boolean {
  if (typeof document === "undefined") {
    return true;
  }
  return document.visibilityState === "visible" && document.hasFocus();
}
