// Mode is how the agent works. Preset is which models it runs. Mode maps to a generated
// `honk-<mode>` agent. It is soft state, switchable per prompt, unlike the hard-pinned model.

import { useSyncExternalStore } from "react";

export type ModeId = "build" | "ask" | "plan" | "debug";

// Shared default for birth and fallback. Threads must not inherit the live home pill.
export const DEFAULT_MODE: ModeId = "build";

export type ModeTone = "neutral" | "ok" | "warn" | "err";

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
    description: "Owns intent and review while a paired sidekick executes the work.",
    tone: "neutral",
  },
  {
    id: "ask",
    label: "Ask",
    description: "Answers questions without changing your files.",
    tone: "ok",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Drafts an implementation plan without changing your files.",
    tone: "warn",
  },
  {
    id: "debug",
    label: "Debug",
    description: "Investigates and runs commands, but asks before editing.",
    tone: "err",
  },
]);

export function modeById(id: ModeId): ModeDefinition {
  return MODES.find((mode) => mode.id === id) ?? MODES[0]!;
}

// Must match the agent names authored by @honk/opencode/host.
export function modeAgentName(id: ModeId): string {
  return `honk-${id}`;
}

export function isModeId(value: unknown): value is ModeId {
  return value === "build" || value === "ask" || value === "plan" || value === "debug";
}

export function nextModeId(id: ModeId): ModeId {
  const index = MODES.findIndex((mode) => mode.id === id);
  const next = MODES[(index + 1) % MODES.length];
  return next === undefined ? "build" : next.id;
}

type ModesSnapshot = {
  readonly homeMode: ModeId;
  readonly byThread: Readonly<Record<string, ModeId>>;
};

const STORAGE_KEY = "honk:app:modes";
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

// Per-thread override seeded at birth. Fallback is DEFAULT_MODE, never live homeMode.
// Otherwise flipping the home pill would coerce every unset thread into that mode.
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
    // localStorage failure must not break the composer.
  }
}
