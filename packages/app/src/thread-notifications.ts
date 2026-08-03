// Workspace watch subscriber for attention, completion, and failure alerts.
// Install from main.tsx, never from a component effect.

import { openCodeSessionKey, openCodeSessionRef } from "@honk/opencode";
import type { DesktopThreadNotificationTarget } from "@honk/shared/desktop-api";
import { basename } from "@honk/shared/paths";
import { play } from "cuelume";

import {
  actions as appSettingsActions,
  getSnapshot as getAppSettingsSnapshot,
} from "./app-settings-store";
import type { AlertSoundSelection } from "./alert-sound-model";
import { tabStatusFromSummary } from "./command-menu-model";
import { installAlertSoundPlayback, playAlertSound } from "./completion-sound";
import {
  showDesktopThreadNotification,
  subscribeDesktopThreadNotificationActivate,
} from "./desktop-bridge";
import { isWindowForeground, showSystemThreadNotification } from "./notification-permission";
import type { AppSessionSummary } from "./open-code-view";
import { actions as tabActions, getSnapshot as getTabSnapshot } from "./tab-store";
import { actions as toastActions } from "./toast-store";
import { getSessionInventoryWatchSnapshot, subscribeSessionInventoryWatch } from "./watch-registry";

type ThreadSummary = AppSessionSummary;

type TrackedThread = {
  readonly needsAttention: boolean;
  readonly status: ThreadSummary["status"];
  readonly title: string;
};

const MAX_TRACKED = 200;

const previousByKey = new Map<string, TrackedThread>();
let installed = false;
let unsubscribeWatch: (() => void) | null = null;
let unsubscribeNotificationActivate: (() => void) | null = null;
let uninstallAlertSoundPlayback: (() => void) | null = null;

function threadLabel(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : "Untitled thread";
}

// Plain fields only, so a desktop notification click can reopen the thread from
// the main process even after the raising renderer is gone.
function threadTarget(thread: ThreadSummary): DesktopThreadNotificationTarget {
  return {
    key: summaryKey(thread),
    title: thread.title,
    status: tabStatusFromSummary(thread),
    repository:
      thread.worktree?.path === undefined || thread.worktree.path === null
        ? { state: "loading" }
        : { state: "ready", label: basename(thread.worktree.path) },
  };
}

function openThreadTarget(target: DesktopThreadNotificationTarget): void {
  tabActions.open({ kind: "thread", ...target });
}

function openThread(thread: ThreadSummary): void {
  openThreadTarget(threadTarget(thread));
}

// Desktop sends the click through the main process, which survives a hidden or
// recreated window. Web keeps the in-page Web Notification click handler.
function notifyThread(input: {
  readonly title: string;
  readonly body: string;
  readonly thread: ThreadSummary;
}): void {
  const target = threadTarget(input.thread);
  if (
    showDesktopThreadNotification({
      title: input.title,
      body: input.body,
      threadId: input.thread.id,
      target,
    })
  ) {
    return;
  }
  showSystemThreadNotification({
    title: input.title,
    body: input.body,
    threadId: input.thread.id,
    onClick: () => {
      openThreadTarget(target);
    },
  });
}

function summaryKey(summary: Pick<ThreadSummary, "id" | "server">): string {
  return openCodeSessionKey(openCodeSessionRef(summary.server, summary.id));
}

function isActiveThread(thread: ThreadSummary): boolean {
  return getTabSnapshot().activeKey === summaryKey(thread);
}

function trackSummary(summary: ThreadSummary): TrackedThread {
  return Object.freeze({
    needsAttention: summary.needsAttention,
    status: summary.status,
    title: summary.title,
  });
}

function capMemory(nextIds: ReadonlySet<string>): void {
  for (const key of [...previousByKey.keys()]) {
    if (!nextIds.has(key)) {
      previousByKey.delete(key);
    }
  }
  // Map preserves insertion order, so keys().next() drops the oldest.
  while (previousByKey.size > MAX_TRACKED) {
    const oldest = previousByKey.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    previousByKey.delete(oldest);
  }
}

function emitAttention(summary: ThreadSummary): void {
  if (isActiveThread(summary)) {
    return;
  }

  const label = threadLabel(summary.title);
  toastActions.addAttention({
    type: "warning",
    title: `Needs you — ${label}`,
    description: "Needs you.",
    action: {
      label: "Open",
      run: () => {
        openThread(summary);
      },
    },
  });

  const appSettings = getAppSettingsSnapshot();
  if (appSettings.alertSoundsEnabled) {
    playConfiguredAlertSound(appSettings.alertSoundSelection, appSettings.customAlertSoundFileName);
  }

  if (!isWindowForeground() && appSettings.notifyWhenThreadNeedsInput) {
    notifyThread({
      title: `Needs you — ${label}`,
      body: "Needs you.",
      thread: summary,
    });
  }
}

function emitCompletion(summary: ThreadSummary): void {
  if (isActiveThread(summary)) {
    return;
  }

  const label = threadLabel(summary.title);
  toastActions.add({
    type: "info",
    title: label,
    description: "Finished working.",
    action: {
      label: "Open",
      run: () => {
        openThread(summary);
      },
    },
  });

  const appSettings = getAppSettingsSnapshot();
  if (appSettings.alertSoundsEnabled) {
    playConfiguredAlertSound(appSettings.alertSoundSelection, appSettings.customAlertSoundFileName);
  }

  if (!isWindowForeground() && appSettings.notifyWhenThreadFinishes) {
    notifyThread({
      title: label,
      body: "Finished working.",
      thread: summary,
    });
  }
}

function emitFailure(summary: ThreadSummary): void {
  if (isActiveThread(summary)) {
    return;
  }

  const label = threadLabel(summary.title);
  toastActions.add({
    type: "error",
    title: `Failed — ${label}`,
    description: "Stopped with an error.",
    action: {
      label: "Open",
      run: () => {
        openThread(summary);
      },
    },
  });

  const appSettings = getAppSettingsSnapshot();
  if (appSettings.alertSoundsEnabled) {
    play("error");
  }

  if (!isWindowForeground() && appSettings.notifyWhenThreadFinishes) {
    notifyThread({
      title: `Failed — ${label}`,
      body: "Stopped with an error.",
      thread: summary,
    });
  }
}

function playConfiguredAlertSound(
  selection: AlertSoundSelection,
  customFileName: string | null,
): void {
  void playAlertSound(selection, customFileName).then((result) => {
    const current = getAppSettingsSnapshot();
    if (
      result !== "built-in" ||
      selection !== "custom" ||
      current.alertSoundSelection !== selection ||
      current.customAlertSoundFileName !== customFileName
    ) {
      return;
    }
    appSettingsActions.clearCustomAlertSound();
  });
}

function onWorkspaceChange(): void {
  const { state } = getSessionInventoryWatchSnapshot();
  if (state === null) {
    return;
  }

  const threads = state.rootSessions;
  const nextIds = new Set(threads.map(summaryKey));

  for (const summary of threads) {
    const key = summaryKey(summary);
    const previous = previousByKey.get(key);
    if (previous === undefined) {
      // Seed on first sighting so a full workspace boot does not alert.
      previousByKey.set(key, trackSummary(summary));
      continue;
    }

    if (summary.status === "failed" && previous.status !== "failed") {
      emitFailure(summary);
      previousByKey.set(key, trackSummary(summary));
      continue;
    }

    if (summary.needsAttention && !previous.needsAttention) {
      emitAttention(summary);
      previousByKey.set(key, trackSummary(summary));
      continue;
    }

    if (previous.status === "running" && summary.status === "idle") {
      emitCompletion(summary);
    }

    previousByKey.set(key, trackSummary(summary));
  }

  capMemory(nextIds);
}

/**
 * Subscribe to the workspace watch and emit attention/completion signals.
 * Idempotent; call once from main.tsx after bindRouter / installDesktopBridge.
 */
export function installThreadNotifications(): void {
  if (installed) {
    return;
  }
  installed = true;
  // Desktop notification clicks arrive from the main process; route them to the tab.
  unsubscribeNotificationActivate = subscribeDesktopThreadNotificationActivate(openThreadTarget);
  uninstallAlertSoundPlayback = installAlertSoundPlayback();
  // Seed from whatever the registry already has (may be connecting/null).
  onWorkspaceChange();
  unsubscribeWatch = subscribeSessionInventoryWatch(onWorkspaceChange);
}

/** Test and hot-reload only. */
export function uninstallThreadNotifications(): void {
  unsubscribeWatch?.();
  unsubscribeWatch = null;
  unsubscribeNotificationActivate?.();
  unsubscribeNotificationActivate = null;
  uninstallAlertSoundPlayback?.();
  uninstallAlertSoundPlayback = null;
  installed = false;
  previousByKey.clear();
}
