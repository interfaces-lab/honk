// SDK adapter (ADR 0025 §2): keyed, refcounted watch registry over the opencode
// sidecar client's callback facade (./sidecar). Components never see the raw
// sdk; they subscribe through useSyncExternalStore (see use-sdk-watch.ts). There
// is no extra projection layer — ThreadState / WorkspaceState from the sidecar
// reducer ARE the domain state; this module only wraps them as {state, status}
// and owns subscribe/teardown lifecycle.
//
// Restart policy (closed / unauthorized): the sidecar pump halts its loop on a
// 401. This adapter does NOT auto-recreate. Terminal statuses stay on the
// wrapper until either (a) the entry is torn down (last subscriber + StrictMode
// grace) and a later subscribe opens a fresh watch, or (b) an explicit restart*
// action below closes and re-opens while subscribers remain. Transient
// reconnects stay inside the sidecar pump (`reconnecting` → `live`).

import type {
  HonkClient,
  ThreadState,
  WatchStatus,
  WorkspaceState,
} from "./sidecar";

/** Adapter status: SDK WatchStatus plus the pre-first-snapshot `"connecting"`. */
export type AdapterWatchStatus = "connecting" | WatchStatus;

export type ThreadWatchSnapshot = {
  readonly state: ThreadState | null;
  readonly status: AdapterWatchStatus;
};

export type WorkspaceWatchSnapshot = {
  readonly state: WorkspaceState | null;
  readonly status: AdapterWatchStatus;
};

const FLUSH_MS = 16;
// One macrotask so React StrictMode's sync subscribe→unsubscribe→subscribe
// remount cancels teardown before the underlying watch.close() runs.
const STRICT_MODE_GRACE_MS = 0;

const WORKSPACE_KEY = "workspace" as const;

type EntryKey = `thread:${string}` | typeof WORKSPACE_KEY;

type EntryKind = "thread" | "workspace";

type PendingPatch<State> = {
  state?: State;
  status?: AdapterWatchStatus;
};

type WatchHandle = {
  readonly close: () => void;
};

type Entry<State, Snapshot extends { readonly state: State | null; readonly status: AdapterWatchStatus }> = {
  readonly kind: EntryKind;
  readonly threadId: string | null;
  refCount: number;
  watch: WatchHandle | null;
  snapshot: Snapshot;
  pending: PendingPatch<State> | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  teardownTimer: ReturnType<typeof setTimeout> | null;
  readonly listeners: Set<() => void>;
};

const INITIAL_THREAD_SNAPSHOT: ThreadWatchSnapshot = Object.freeze({
  state: null,
  status: "connecting",
});

const INITIAL_WORKSPACE_SNAPSHOT: WorkspaceWatchSnapshot = Object.freeze({
  state: null,
  status: "connecting",
});

let client: HonkClient | null = null;
const entries = new Map<EntryKey, Entry<ThreadState | WorkspaceState, ThreadWatchSnapshot | WorkspaceWatchSnapshot>>();

function threadKey(threadId: string): EntryKey {
  return `thread:${threadId}`;
}

function requireClient(): HonkClient {
  if (client === null) {
    throw new Error(
      "SDK watch registry has no client — call bindHonkClient(client) after connect()",
    );
  }
  return client;
}

function notify(listeners: ReadonlySet<() => void>): void {
  for (const listener of listeners) {
    listener();
  }
}

function clearFlushTimer(entry: Entry<ThreadState | WorkspaceState, ThreadWatchSnapshot | WorkspaceWatchSnapshot>): void {
  if (entry.flushTimer !== null) {
    clearTimeout(entry.flushTimer);
    entry.flushTimer = null;
  }
}

function clearTeardownTimer(entry: Entry<ThreadState | WorkspaceState, ThreadWatchSnapshot | WorkspaceWatchSnapshot>): void {
  if (entry.teardownTimer !== null) {
    clearTimeout(entry.teardownTimer);
    entry.teardownTimer = null;
  }
}

function publishSnapshot(
  entry: Entry<ThreadState | WorkspaceState, ThreadWatchSnapshot | WorkspaceWatchSnapshot>,
  next: ThreadWatchSnapshot | WorkspaceWatchSnapshot,
): void {
  // Structural sharing must survive the wrapper: same state ref + same status
  // keeps the previous snapshot object so React's Object.is bail-out works.
  if (entry.snapshot.state === next.state && entry.snapshot.status === next.status) {
    return;
  }
  entry.snapshot = next;
  notify(entry.listeners);
}

function flushEntry(entry: Entry<ThreadState | WorkspaceState, ThreadWatchSnapshot | WorkspaceWatchSnapshot>): void {
  entry.flushTimer = null;
  const pending = entry.pending;
  if (pending === null) {
    return;
  }
  entry.pending = null;

  const nextState = pending.state !== undefined ? pending.state : entry.snapshot.state;
  const nextStatus = pending.status !== undefined ? pending.status : entry.snapshot.status;

  if (entry.kind === "thread") {
    publishSnapshot(entry, { state: nextState as ThreadState | null, status: nextStatus });
    return;
  }
  publishSnapshot(entry, { state: nextState as WorkspaceState | null, status: nextStatus });
}

function scheduleFlush(entry: Entry<ThreadState | WorkspaceState, ThreadWatchSnapshot | WorkspaceWatchSnapshot>): void {
  if (entry.flushTimer !== null) {
    return;
  }
  entry.flushTimer = setTimeout(() => {
    flushEntry(entry);
  }, FLUSH_MS);
}

function queuePatch(
  entry: Entry<ThreadState | WorkspaceState, ThreadWatchSnapshot | WorkspaceWatchSnapshot>,
  patch: PendingPatch<ThreadState | WorkspaceState>,
): void {
  // Last-write-wins per key: coalesce into one pending buffer, flush at 16ms.
  entry.pending = {
    ...(entry.pending ?? {}),
    ...patch,
  };
  scheduleFlush(entry);
}

function closeWatch(entry: Entry<ThreadState | WorkspaceState, ThreadWatchSnapshot | WorkspaceWatchSnapshot>): void {
  clearFlushTimer(entry);
  entry.pending = null;
  const watch = entry.watch;
  entry.watch = null;
  watch?.close();
}

function openWatch(entry: Entry<ThreadState | WorkspaceState, ThreadWatchSnapshot | WorkspaceWatchSnapshot>): void {
  const honk = requireClient();
  closeWatch(entry);

  if (entry.kind === "thread") {
    const threadId = entry.threadId;
    if (threadId === null) {
      throw new Error("Thread watch entry is missing threadId");
    }
    // ThreadId is a phantom brand at runtime; the SDK accepts the branded string.
    entry.watch = honk.threads.watch(threadId as Parameters<HonkClient["threads"]["watch"]>[0], {
      onChange: (state) => {
        queuePatch(entry, { state });
      },
      onStatus: (status) => {
        queuePatch(entry, { status });
      },
    });
    return;
  }

  entry.watch = honk.workspace.watch({
    onChange: (state) => {
      queuePatch(entry, { state });
    },
    onStatus: (status) => {
      queuePatch(entry, { status });
    },
  });
}

function createThreadEntry(threadId: string): Entry<ThreadState, ThreadWatchSnapshot> {
  return {
    kind: "thread",
    threadId,
    refCount: 0,
    watch: null,
    snapshot: INITIAL_THREAD_SNAPSHOT,
    pending: null,
    flushTimer: null,
    teardownTimer: null,
    listeners: new Set(),
  };
}

function createWorkspaceEntry(): Entry<WorkspaceState, WorkspaceWatchSnapshot> {
  return {
    kind: "workspace",
    threadId: null,
    refCount: 0,
    watch: null,
    snapshot: INITIAL_WORKSPACE_SNAPSHOT,
    pending: null,
    flushTimer: null,
    teardownTimer: null,
    listeners: new Set(),
  };
}

function getOrCreateEntry(key: EntryKey): Entry<ThreadState | WorkspaceState, ThreadWatchSnapshot | WorkspaceWatchSnapshot> {
  const existing = entries.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created =
    key === WORKSPACE_KEY
      ? createWorkspaceEntry()
      : createThreadEntry(key.slice("thread:".length));
  entries.set(key, created);
  return created;
}

function teardownEntry(key: EntryKey): void {
  const entry = entries.get(key);
  if (entry === undefined) {
    return;
  }
  if (entry.refCount > 0) {
    return;
  }
  clearTeardownTimer(entry);
  closeWatch(entry);
  entries.delete(key);
}

function subscribeKey(key: EntryKey, listener: () => void): () => void {
  const entry = getOrCreateEntry(key);
  clearTeardownTimer(entry);
  entry.listeners.add(listener);
  entry.refCount += 1;

  // Pre-connect subscribers sit at "connecting" — bindHonkClient() opens the
  // watch for every live entry once a client arrives, so don't throw here.
  if (entry.watch === null && client !== null) {
    openWatch(entry);
  }

  return () => {
    entry.listeners.delete(listener);
    entry.refCount -= 1;
    if (entry.refCount > 0) {
      return;
    }
    clearTeardownTimer(entry);
    entry.teardownTimer = setTimeout(() => {
      entry.teardownTimer = null;
      teardownEntry(key);
    }, STRICT_MODE_GRACE_MS);
  };
}

function restartKey(key: EntryKey): void {
  const entry = entries.get(key);
  if (entry === undefined || entry.refCount === 0) {
    return;
  }
  clearTeardownTimer(entry);
  clearFlushTimer(entry);
  entry.pending = null;
  closeWatch(entry);
  entry.snapshot =
    entry.kind === "thread"
      ? { state: entry.snapshot.state as ThreadState | null, status: "connecting" }
      : { state: entry.snapshot.state as WorkspaceState | null, status: "connecting" };
  notify(entry.listeners);
  openWatch(entry);
}

/**
 * Bind the connected HonkClient. Call once after `connect()`; replacing the
 * client tears down every live watch so the next subscribe opens against the
 * new client. Pass `null` on logout / disconnect.
 */
export function bindHonkClient(next: HonkClient | null): void {
  if (client === next) {
    return;
  }
  // Assign before reopen — openWatch reads `client` via requireClient().
  client = next;
  for (const key of [...entries.keys()]) {
    const entry = entries.get(key);
    if (entry === undefined) {
      continue;
    }
    clearTeardownTimer(entry);
    closeWatch(entry);
    entry.snapshot =
      entry.kind === "thread" ? INITIAL_THREAD_SNAPSHOT : INITIAL_WORKSPACE_SNAPSHOT;
    if (entry.refCount === 0) {
      entries.delete(key);
    } else {
      notify(entry.listeners);
      if (next !== null) {
        openWatch(entry);
      }
    }
  }
}

export function getBoundHonkClient(): HonkClient | null {
  return client;
}

export function subscribeThreadWatch(threadId: string, listener: () => void): () => void {
  return subscribeKey(threadKey(threadId), listener);
}

export function getThreadWatchSnapshot(threadId: string): ThreadWatchSnapshot {
  const entry = entries.get(threadKey(threadId));
  return entry === undefined
    ? INITIAL_THREAD_SNAPSHOT
    : (entry.snapshot as ThreadWatchSnapshot);
}

export function getThreadWatchServerSnapshot(): ThreadWatchSnapshot {
  return INITIAL_THREAD_SNAPSHOT;
}

export function subscribeWorkspaceWatch(listener: () => void): () => void {
  return subscribeKey(WORKSPACE_KEY, listener);
}

export function getWorkspaceWatchSnapshot(): WorkspaceWatchSnapshot {
  const entry = entries.get(WORKSPACE_KEY);
  return entry === undefined
    ? INITIAL_WORKSPACE_SNAPSHOT
    : (entry.snapshot as WorkspaceWatchSnapshot);
}

export function getWorkspaceWatchServerSnapshot(): WorkspaceWatchSnapshot {
  return INITIAL_WORKSPACE_SNAPSHOT;
}

/** Explicit retry after a terminal `closed` / `unauthorized` status. */
export function restartThreadWatch(threadId: string): void {
  restartKey(threadKey(threadId));
}

/** Explicit retry after a terminal `closed` / `unauthorized` status. */
export function restartWorkspaceWatch(): void {
  restartKey(WORKSPACE_KEY);
}
