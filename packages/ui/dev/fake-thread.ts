// A tiny module store that fakes a streaming agent run, so the gallery's tab statuses and the
// no-useEffect perf story are exercised by REAL update traffic instead of static fixtures.
// Every started thread ticks on a 300ms interval and walks the board's status vocabulary:
//   working (8 ticks, one structured activity row per tick) → needs-you (3 ticks) → done.
// Each tick settles the previous running row (its object is replaced; every already-settled
// row keeps its reference — the structural sharing the SDK adapter copies) and appends the
// next step as running.
//
// Doctrine (ADR 0025): timers live HERE, in the store — never in a component. Components read
// through useFakeThread (useSyncExternalStore); each tick that changes anything replaces that
// thread's snapshot object wholesale (frozen) — no-change ticks (the needs-you dwell) publish
// nothing — so React's Object.is check sees exactly one change per visible tick and only the
// subscribed story re-renders. The provided onStatus callback is how status reaches the tab
// store — dev/main.tsx passes tabActions.setStatus directly (the store no-ops writes that
// change nothing).

import { useSyncExternalStore } from "react";

// The walk only ever visits these three words — a strict subset of the tab-store vocabulary,
// so an onStatus handler typed against TabStatus plugs in directly.
export type FakeStatus = "working" | "needs-you" | "done";

// Row states mirror the tool line's vocabulary (@honk/ui ToolCallState).
export type FakeRowState = "running" | "done" | "failed";

// One structured activity row, shaped like the recon memo's tool-line anatomy. `tool` is the
// wire's icon ROLE — carried as data for consumers that key on it, but never drawn by the
// locked thread surface (locked.html §5: no status icons on tool calls, ever).
export type FakeRow = {
  id: number;
  tool: "read" | "search" | "edit" | "run";
  verb: string;
  detail: string;
  state: FakeRowState;
  added?: number;
  removed?: number;
};

export type FakeThreadSnapshot = {
  key: string;
  title: string;
  status: FakeStatus;
  rows: readonly FakeRow[];
};

const TICK_MS = 300;
const WORKING_TICKS = 8;
const NEEDS_YOU_TICKS = 3;

// The step script, one seed per working tick. Verb pairs follow the app's own grammar
// (tool-renderer TOOL_ACTION_LABELS: Reading/Read, Editing/Edited, Running/Ran, error rows use
// the bare form); one step fails so the red state streams by.
type StepSeed = {
  tool: FakeRow["tool"];
  runningVerb: string;
  settledVerb: string;
  detail: string;
  settledState: Exclude<FakeRowState, "running">;
  added?: number;
  removed?: number;
};

const STEP_SCRIPT: readonly StepSeed[] = [
  { tool: "read", runningVerb: "Reading", settledVerb: "Read", detail: "src/tabs.tsx · 687 lines", settledState: "done" },
  { tool: "search", runningVerb: "Grepping", settledVerb: "Grepped", detail: "useSyncExternalStore · 14 hits", settledState: "done" },
  { tool: "edit", runningVerb: "Editing", settledVerb: "Edited", detail: "src/shell.tsx", settledState: "done", added: 12, removed: 4 },
  { tool: "run", runningVerb: "Running", settledVerb: "Ran", detail: "pnpm typecheck · clean", settledState: "done" },
  { tool: "run", runningVerb: "Running", settledVerb: "Command", detail: "pnpm run lint:design · exit 1", settledState: "failed" },
  { tool: "read", runningVerb: "Reading", settledVerb: "Read", detail: "docs/adr/0025-react-doctrine.md", settledState: "done" },
  { tool: "edit", runningVerb: "Editing", settledVerb: "Edited", detail: "src/matrix.tsx", settledState: "done", added: 3, removed: 1 },
  { tool: "run", runningVerb: "Running", settledVerb: "Ran", detail: "pnpm run lint:design · 0 violations", settledState: "done" },
];

function seedFor(id: number): StepSeed | undefined {
  return STEP_SCRIPT[(id - 1) % STEP_SCRIPT.length];
}

function runningRow(id: number, seed: StepSeed): FakeRow {
  return Object.freeze({
    id,
    tool: seed.tool,
    verb: seed.runningVerb,
    detail: seed.detail,
    state: "running" as const,
  });
}

function settledRow(row: FakeRow): FakeRow {
  const seed = seedFor(row.id);

  if (seed === undefined) {
    return Object.freeze({ ...row, state: "done" as const });
  }

  const settled: FakeRow = {
    id: row.id,
    tool: seed.tool,
    verb: seed.settledVerb,
    detail: seed.detail,
    state: seed.settledState,
  };

  if (seed.added !== undefined) {
    settled.added = seed.added;
  }
  if (seed.removed !== undefined) {
    settled.removed = seed.removed;
  }

  return Object.freeze(settled);
}

// Settle a trailing running row; settled rows keep their references (structural sharing).
function withTailSettled(rows: readonly FakeRow[]): readonly FakeRow[] {
  const last = rows[rows.length - 1];

  if (last === undefined || last.state !== "running") {
    return rows;
  }

  return Object.freeze([...rows.slice(0, -1), settledRow(last)]);
}

// Per-key snapshots. The Map mutates in place; the per-key snapshot objects are immutable and
// replaced wholesale — getSnapshot(key) stays referentially stable between ticks.
const snapshots = new Map<string, FakeThreadSnapshot>();
const timers = new Map<string, ReturnType<typeof setInterval>>();
// The onStatus callback per run, so stopFake can report the final transition too.
const statusCallbacks = new Map<string, (key: string, status: FakeStatus) => void>();
const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getFakeThread(key: string): FakeThreadSnapshot | undefined {
  return snapshots.get(key);
}

// Register a thread and start its tick loop. Restarting an existing key resets the run
// (the old timer is cleared first, so no two loops ever drive one key).
export function startFake(
  key: string,
  title: string,
  onStatus: (key: string, status: FakeStatus) => void,
): void {
  clearTimer(key);
  statusCallbacks.set(key, onStatus);

  publish(key, { key, title, status: "working", rows: Object.freeze([]) });
  onStatus(key, "working");

  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    const current = snapshots.get(key);

    if (current === undefined) {
      // defensive: the snapshot vanished (dev hot-reload edge) — stop the orphaned loop
      clearTimer(key);
      statusCallbacks.delete(key);
      return;
    }

    let next: FakeThreadSnapshot;

    if (tick <= WORKING_TICKS) {
      const seed = seedFor(tick);
      const settled = withTailSettled(current.rows);
      next = {
        ...current,
        status: "working",
        rows:
          seed === undefined
            ? settled
            : Object.freeze([...settled, runningRow(tick, seed)]),
      };
    } else if (tick <= WORKING_TICKS + NEEDS_YOU_TICKS) {
      next = { ...current, status: "needs-you", rows: withTailSettled(current.rows) };
    } else {
      next = { ...current, status: "done", rows: withTailSettled(current.rows) };
      clearTimer(key);
    }

    // The needs-you dwell ticks change nothing after the first — no publish, no re-render, so
    // "one visual change per tick" stays literally true for subscribers.
    if (next.status === current.status && next.rows === current.rows) {
      return;
    }

    publish(key, next);
    onStatus(key, next.status);

    if (next.status === "done") {
      statusCallbacks.delete(key); // the run is over; don't hold the caller's channel forever
    }
  }, TICK_MS);

  timers.set(key, timer);
}

// Stop a live run — the work act behind the group header's Stop affordance (locked §5): the
// timer dies, the tail row settles, and the thread lands on "done" (reported through the same
// onStatus channel the run started with).
export function stopFake(key: string): void {
  const current = snapshots.get(key);

  if (current === undefined || current.status === "done") {
    return;
  }

  clearTimer(key);
  publish(key, { ...current, status: "done", rows: withTailSettled(current.rows) });
  statusCallbacks.get(key)?.(key, "done");
  statusCallbacks.delete(key);
}

export function useFakeThread(key: string): FakeThreadSnapshot | undefined {
  return useSyncExternalStore(
    subscribe,
    // stable per call: Map.get returns the same frozen snapshot until the next tick
    () => snapshots.get(key),
    () => undefined,
  );
}

function clearTimer(key: string): void {
  const timer = timers.get(key);

  if (timer !== undefined) {
    clearInterval(timer);
    timers.delete(key);
  }
}

function publish(key: string, next: FakeThreadSnapshot): void {
  snapshots.set(key, Object.freeze(next));

  for (const listener of listeners) {
    listener();
  }
}
