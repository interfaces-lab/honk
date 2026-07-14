// Thread attention + completion notifications (WP7). Module-level subscriber on
// the workspace watch — install from main.tsx, never from a component effect.
//
// Matrix shipped (parity rethink on completions + attention scoping fix):
//   needsAttention rising (non-active thread):
//     focused  → warning toast (global, unscoped) + Open action
//     hidden   → same toast + OS Notification
//   running → idle (non-active thread):
//     focused  → info toast (always for non-active — parity open question answer)
//     hidden   → info toast + OS Notification
//   Active thread: suppress both (you're already looking at it).

import type { WorkspaceState } from "./sidecar";

import { tabStatusFromSummary } from "./command-menu-model";
import { isWindowForeground, showSystemThreadNotification } from "./notification-permission";
import { actions as tabActions, getSnapshot as getTabSnapshot } from "./tab-store";
import { actions as toastActions } from "./toast-store";
import { getWorkspaceWatchSnapshot, subscribeWorkspaceWatch } from "./watch-registry";

type ThreadSummary = WorkspaceState["threads"][number];

type TrackedThread = {
  readonly needsAttention: boolean;
  readonly status: ThreadSummary["status"];
  readonly title: string;
};

const MAX_TRACKED = 200;

const previousById = new Map<string, TrackedThread>();
let installed = false;
let unsubscribeWatch: (() => void) | null = null;

function threadLabel(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : "Untitled thread";
}

function openThread(thread: ThreadSummary): void {
  tabActions.open({
    key: thread.id,
    title: thread.title,
    kind: "thread",
    status: tabStatusFromSummary(thread),
    repository:
      thread.worktree?.path === undefined || thread.worktree.path === null
        ? { state: "loading" }
        : { state: "ready", label: basename(thread.worktree.path) },
  });
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const [last = trimmed] = trimmed.split(/[\\/]/).slice(-1);
  return last.length > 0 ? last : path;
}

function isActiveThread(threadId: string): boolean {
  return getTabSnapshot().activeKey === threadId;
}

function trackSummary(summary: ThreadSummary): TrackedThread {
  return Object.freeze({
    needsAttention: summary.needsAttention,
    status: summary.status,
    title: summary.title,
  });
}

function capMemory(nextIds: ReadonlySet<string>): void {
  for (const id of [...previousById.keys()]) {
    if (!nextIds.has(id)) {
      previousById.delete(id);
    }
  }
  // Hard cap if the workspace is huge — drop oldest insertion order.
  while (previousById.size > MAX_TRACKED) {
    const oldest = previousById.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    previousById.delete(oldest);
  }
}

function emitAttention(summary: ThreadSummary): void {
  if (isActiveThread(summary.id)) {
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
  if (isActiveThread(summary.id)) {
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
  const { state } = getWorkspaceWatchSnapshot();
  if (state === null) {
    return;
  }

  const threads = state.threads;
  const nextIds = new Set(threads.map((thread) => thread.id));

  for (const summary of threads) {
    const previous = previousById.get(summary.id);
    if (previous === undefined) {
      // First sighting — seed without alerting (avoid boot storms).
      previousById.set(summary.id, trackSummary(summary));
      continue;
    }

    if (summary.needsAttention && !previous.needsAttention) {
      emitAttention(summary);
    }

    if (previous.status === "running" && summary.status === "idle") {
      emitCompletion(summary);
    }

    previousById.set(summary.id, trackSummary(summary));
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
  unsubscribeWatch = subscribeWorkspaceWatch(onWorkspaceChange);
}

/** Test / hot-reload seam — not used in production boot. */
export function uninstallThreadNotifications(): void {
  unsubscribeWatch?.();
  unsubscribeWatch = null;
  installed = false;
  previousById.clear();
}
