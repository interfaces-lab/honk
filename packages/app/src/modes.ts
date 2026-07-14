// Modes — the WAY the agent works (ask / plan / debug / build), orthogonal to the preset
// selector (WHICH models it runs). A mode maps to a generated opencode agent (`honk-<mode>`,
// authored by the desktop config generator) carrying the system prompt + permissions; the
// preset supplies model+variant separately on every prompt. Mode is SOFT state: switchable
// per prompt (unlike the hard-pinned model), so the store tracks the home composer's mode
// and a per-thread override seeded from it at birth. Plain {subscribe, snapshot, actions}
// module — tab-store idiom.

import { useSyncExternalStore } from "react";

export type ModeId = "build" | "ask" | "plan" | "debug";

// The mode a thread is born in (and the composer's resting state). `build` is the full-permission
// working agent; the constrained modes are deliberate opt-ins the user picks per prompt. This is
// the SINGLE source of the default — the store snapshot and the useThreadMode fallback both read it,
// so a thread never floats on whatever the home pill last happened to be.
export const DEFAULT_MODE: ModeId = "build";

// The visual tone a mode paints in the footer chip and its tray. `neutral` is the default (build) —
// a bare, low-emphasis trigger that stays out of the way; the others each carry a distinct hue so an
// active constrained mode is impossible to miss: `blue` (plan, progressive-blue tray), `violet`
// (debug, diagnosis tray), `muted` (ask, calm read-only). Style call sites map tone → StyleX variant.
export type ModeTone = "neutral" | "muted" | "blue" | "violet";

export type ModeDefinition = {
  readonly id: ModeId;
  readonly label: string;
  readonly description: string;
  readonly tone: ModeTone;
};

export const MODES: readonly ModeDefinition[] = Object.freeze([
  {
    id: "build",
    label: "Build",
    description: "Edits files and runs commands with full access.",
    tone: "neutral",
  },
  {
    id: "ask",
    label: "Ask",
    description: "Answers questions without changing your files.",
    tone: "muted",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Drafts an implementation plan without changing your files.",
    tone: "blue",
  },
  {
    id: "debug",
    label: "Debug",
    description: "Investigates and runs commands, but asks before editing.",
    tone: "violet",
  },
]);

export function modeById(id: ModeId): ModeDefinition {
  return MODES.find((mode) => mode.id === id) ?? MODES[0]!;
}

// The generated opencode agent a mode selects — MUST match the desktop config generator
// (packages/desktop/src/backend/opencode-config.ts mode agents).
export function modeAgentName(id: ModeId): string {
  return `honk-${id}`;
}

export function isModeId(value: unknown): value is ModeId {
  return value === "build" || value === "ask" || value === "plan" || value === "debug";
}

// Shift+Tab in the composer rotates the mode pill through MODES in declared order.
export function nextModeId(id: ModeId): ModeId {
  const index = MODES.findIndex((mode) => mode.id === id);
  const next = MODES[(index + 1) % MODES.length];
  return next === undefined ? "build" : next.id;
}

type ModesSnapshot = {
  readonly homeMode: ModeId;
  readonly byThread: Readonly<Record<string, ModeId>>;
};

const STORAGE_KEY = "honk:app-next:modes";
const DEFAULT_SNAPSHOT: ModesSnapshot = Object.freeze({ homeMode: DEFAULT_MODE, byThread: {} });

const listeners = new Set<() => void>();

let snapshot = hydrate();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ModesSnapshot {
  return snapshot;
}

export function useHomeMode(): ModeId {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.homeMode,
    () => DEFAULT_SNAPSHOT.homeMode,
  );
}

// A thread's mode is its OWN per-thread override, seeded once at birth from the home pill
// (tab-store.createAndOpenThread → setThreadMode). The fallback is the fixed DEFAULT_MODE, never
// the live homeMode — otherwise flipping the home pill to plan would retroactively coerce every
// thread that never set its own mode into plan (the "plan mode treats everything as plan" bug).
export function useThreadMode(threadId: string): ModeId {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.byThread[threadId] ?? DEFAULT_SNAPSHOT.homeMode,
    () => DEFAULT_SNAPSHOT.homeMode,
  );
}

export const actions = {
  setHomeMode(id: string): void {
    if (!isModeId(id) || id === snapshot.homeMode) {
      return;
    }
    publish({ ...snapshot, homeMode: id });
  },

  setThreadMode(threadId: string, id: string): void {
    if (!isModeId(id) || snapshot.byThread[threadId] === id) {
      return;
    }
    publish({ ...snapshot, byThread: { ...snapshot.byThread, [threadId]: id } });
  },
} as const;

function publish(next: ModesSnapshot): void {
  snapshot = Object.freeze({ ...next, byThread: Object.freeze({ ...next.byThread }) });
  persist(snapshot);
  for (const listener of listeners) {
    listener();
  }
}

function hydrate(): ModesSnapshot {
  if (typeof window === "undefined") {
    return DEFAULT_SNAPSHOT;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_SNAPSHOT;
    }
    const parsed = JSON.parse(raw) as Partial<{ homeMode: unknown; byThread: unknown }>;
    const byThread: Record<string, ModeId> = {};
    if (typeof parsed.byThread === "object" && parsed.byThread !== null) {
      for (const [key, value] of Object.entries(parsed.byThread)) {
        if (isModeId(value)) {
          byThread[key] = value;
        }
      }
    }
    return Object.freeze({
      homeMode: isModeId(parsed.homeMode) ? parsed.homeMode : DEFAULT_SNAPSHOT.homeMode,
      byThread: Object.freeze(byThread),
    });
  } catch {
    return DEFAULT_SNAPSHOT;
  }
}

function persist(next: ModesSnapshot): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Persistence must never break the composer.
  }
}
