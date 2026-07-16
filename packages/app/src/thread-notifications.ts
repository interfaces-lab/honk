// Workspace watch subscriber for attention/completion toasts.
// Install from main.tsx, never from a component effect.

import { openCodeSessionKey, openCodeSessionRef } from "@honk/opencode";
import { basename } from "@honk/shared/paths";

import { tabStatusFromSummary } from "./command-menu-model";
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

function threadLabel(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : "Untitled thread";
}

function openThread(thread: ThreadSummary): void {
  tabActions.open({
    key: summaryKey(thread),
    title: thread.title,
    kind: "thread",
    status: tabStatusFromSummary(thread),
    repository:
      thread.worktree?.path === undefined || thread.worktree.path === null
        ? { state: "loading" }
        : { state: "ready", label: basename(thread.worktree.path) },
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
    title: `Input needed — ${label}`,
    description: "User input requested.",
    action: {
      label: "Open",
      run: () => {
        openThread(summary);
      },
    },
  });

  if (!isWindowForeground()) {
    showSystemThreadNotification({
      title: `Input needed — ${label}`,
      body: "User input requested.",
      threadId: summary.id,
      onClick: () => {
        openThread(summary);
      },
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

  if (!isWindowForeground()) {
    showSystemThreadNotification({
      title: label,
      body: "Finished working.",
      threadId: summary.id,
      onClick: () => {
        openThread(summary);
      },
    });
  }
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

    if (summary.needsAttention && !previous.needsAttention) {
      emitAttention(summary);
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
  // Seed from whatever the registry already has (may be connecting/null).
  onWorkspaceChange();
  unsubscribeWatch = subscribeSessionInventoryWatch(onWorkspaceChange);
}

/** Test and hot-reload only. */
export function uninstallThreadNotifications(): void {
  unsubscribeWatch?.();
  unsubscribeWatch = null;
  installed = false;
  previousByKey.clear();
}
