// Mode is how the agent works. Preset is which models it runs. Mode maps to a generated
// `honk-<mode>` agent. It is soft state, switchable per prompt, unlike the hard-pinned model.

import { honkPairingForFusionAgent } from "@honk/opencode/pairing";
import { useEffect, useSyncExternalStore } from "react";

export type ModeId = "build" | "plan" | "debug" | "ask";

// Build is the resting state, so it is the one mode the "/" menu never offers: it has no glyph
// and no row, and you get back to it by reselecting whichever mode is active.
export type SwitchableModeId = Exclude<ModeId, "build">;

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
    description: "Owns intent and review while implementation continues in the background.",
    tone: "neutral",
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
    description: "Diagnoses the root cause and hands a verified fix to Build.",
    tone: "err",
  },
  {
    id: "ask",
    label: "Ask",
    description: "Answers questions without changing your files.",
    tone: "ok",
  },
]);

export function modeById(id: ModeId): ModeDefinition {
  return MODES.find((mode) => mode.id === id) ?? MODES[0]!;
}

// Must match the agent names authored by @honk/opencode/host.
export function modeAgentName(id: ModeId): string {
  return `honk-${id}`;
}

// Build keeps the thread's per-stop Fusion agent; every other mode overrides it.
export function threadAgentName(mode: ModeId, sessionAgent: string | null): string {
  if (mode !== "build") return modeAgentName(mode);
  return sessionAgent === null || !isBuildAgent(sessionAgent)
    ? modeAgentName("build")
    : sessionAgent;
}

export function modeFromAgent(agent: string | null | undefined): ModeId {
  if (agent === modeAgentName("plan")) return "plan";
  if (agent === modeAgentName("debug")) return "debug";
  if (agent === modeAgentName("ask")) return "ask";
  return "build";
}

// The live session agent is overwritten by every mode switch. Walk back to the
// latest build-family message so temporary Ask/Plan/Debug turns do not erase it.
export function threadBuildAgent(
  messages: readonly { readonly agent?: string | null }[],
  summaryAgent: string | null,
): string | null {
  const match = messages.findLast((message) => isBuildAgent(message.agent ?? null));
  return match?.agent ?? summaryAgent;
}

function isBuildAgent(agent: string | null): boolean {
  if (agent === null) return false;
  return agent === modeAgentName("build") || honkPairingForFusionAgent(agent) !== undefined;
}

export function isModeId(value: unknown): value is ModeId {
  return value === "build" || value === "plan" || value === "debug" || value === "ask";
}

export function nextModeId(id: ModeId): ModeId {
  const index = MODES.findIndex((mode) => mode.id === id);
  const next = MODES[(index + 1) % MODES.length];
  return next === undefined ? "build" : next.id;
}

type ModesSnapshot = {
  readonly defaultMode: ModeId;
  readonly homeMode: ModeId;
  readonly unsentModeByThread: Readonly<Record<string, ModeId>>;
};

const STORAGE_KEY = "honk:app:modes";
const DEFAULT_SNAPSHOT: ModesSnapshot = Object.freeze({
  defaultMode: DEFAULT_MODE,
  homeMode: DEFAULT_MODE,
  unsentModeByThread: {},
});

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

export function useDefaultMode(): ModeId {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.defaultMode,
    () => DEFAULT_SNAPSHOT.defaultMode,
  );
}

// A thread override is an unsent composer choice. Core session state owns the
// current mode and clears the override once it reports the same agent.
export function useThreadMode(threadId: string, coreMode: ModeId): ModeId {
  const override = useSyncExternalStore(
    subscribe,
    () => snapshot.unsentModeByThread[threadId],
    () => undefined,
  );
  useEffect(() => {
    if (override === undefined || override !== coreMode) return;
    actions.clearThreadMode(threadId, override);
  }, [coreMode, override, threadId]);
  return override ?? coreMode;
}

export const actions = {
  setDefaultMode(id: string): void {
    if (!isModeId(id) || (id === snapshot.defaultMode && id === snapshot.homeMode)) {
      return;
    }
    publish({ ...snapshot, defaultMode: id, homeMode: id });
  },

  resetDefaultMode(): void {
    if (
      snapshot.defaultMode === DEFAULT_SNAPSHOT.defaultMode &&
      snapshot.homeMode === DEFAULT_SNAPSHOT.defaultMode
    ) {
      return;
    }
    publish({
      ...snapshot,
      defaultMode: DEFAULT_SNAPSHOT.defaultMode,
      homeMode: DEFAULT_SNAPSHOT.defaultMode,
    });
  },

  setHomeMode(id: string): void {
    if (!isModeId(id) || id === snapshot.homeMode) {
      return;
    }
    publish({ ...snapshot, homeMode: id });
  },

  resetHomeMode(): void {
    if (snapshot.homeMode === snapshot.defaultMode) {
      return;
    }
    publish({ ...snapshot, homeMode: snapshot.defaultMode });
  },

  setThreadMode(threadId: string, id: string): void {
    if (!isModeId(id) || snapshot.unsentModeByThread[threadId] === id) {
      return;
    }
    publish({
      ...snapshot,
      unsentModeByThread: { ...snapshot.unsentModeByThread, [threadId]: id },
    });
  },

  clearThreadMode(threadId: string, expected?: ModeId): void {
    const current = snapshot.unsentModeByThread[threadId];
    if (current === undefined || (expected !== undefined && current !== expected)) return;
    const unsentModeByThread = { ...snapshot.unsentModeByThread };
    delete unsentModeByThread[threadId];
    publish({ ...snapshot, unsentModeByThread });
  },
} as const;

function publish(next: ModesSnapshot): void {
  snapshot = Object.freeze({
    ...next,
    unsentModeByThread: Object.freeze({ ...next.unsentModeByThread }),
  });
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
    const parsed = JSON.parse(raw) as Partial<{
      defaultMode: unknown;
      homeMode: unknown;
    }>;
    const defaultMode = isModeId(parsed.defaultMode) ? parsed.defaultMode : DEFAULT_MODE;
    return Object.freeze({
      defaultMode,
      homeMode: isModeId(parsed.homeMode) ? parsed.homeMode : defaultMode,
      unsentModeByThread: DEFAULT_SNAPSHOT.unsentModeByThread,
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
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ defaultMode: next.defaultMode, homeMode: next.homeMode }),
    );
  } catch {
    // localStorage failure must not break the composer.
  }
}
