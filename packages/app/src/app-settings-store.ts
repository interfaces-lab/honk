// App-wide prefs outside mode and preset. null directory defers to the sidecar default.
// Compact density stays default so OpenCode assistant-message seams stay transport detail.

import {
  DEFAULT_CONVERSATION_DENSITY,
  USER_CONVERSATION_DENSITY_VALUES,
  type ConversationDensity,
} from "@honk/shared/conversation-density";
import { useSyncExternalStore } from "react";

export type AppSettings = {
  /** Absolute path for new threads. null uses the sidecar default. */
  readonly defaultProjectDirectory: string | null;
  readonly conversationDensity: ConversationDensity;
};

const STORAGE_KEY = "honk:app:app-settings";
const DEFAULT_SNAPSHOT: AppSettings = Object.freeze({
  defaultProjectDirectory: null,
  conversationDensity: DEFAULT_CONVERSATION_DENSITY,
});

const listeners = new Set<() => void>();

let snapshot = hydrate();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): AppSettings {
  return snapshot;
}

export function getServerSnapshot(): AppSettings {
  return DEFAULT_SNAPSHOT;
}

export function useAppSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useDefaultProjectDirectory(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.defaultProjectDirectory,
    () => DEFAULT_SNAPSHOT.defaultProjectDirectory,
  );
}

export function useConversationDensity(): ConversationDensity {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.conversationDensity,
    () => DEFAULT_SNAPSHOT.conversationDensity,
  );
}

export const actions = {
  setDefaultProjectDirectory(directory: string | null): void {
    const next = directory === null || directory.trim().length === 0 ? null : directory;
    if (next === snapshot.defaultProjectDirectory) {
      return;
    }
    publish({ ...snapshot, defaultProjectDirectory: next });
  },

  clearDefaultProjectDirectory(): void {
    if (snapshot.defaultProjectDirectory === null) {
      return;
    }
    publish({ ...snapshot, defaultProjectDirectory: null });
  },

  setConversationDensity(conversationDensity: ConversationDensity): void {
    if (conversationDensity === snapshot.conversationDensity) {
      return;
    }
    publish({ ...snapshot, conversationDensity });
  },

  resetConversationDensity(): void {
    if (snapshot.conversationDensity === DEFAULT_CONVERSATION_DENSITY) {
      return;
    }
    publish({ ...snapshot, conversationDensity: DEFAULT_CONVERSATION_DENSITY });
  },
} as const;

function publish(next: AppSettings): void {
  snapshot = Object.freeze({ ...next });
  persist(snapshot);
  for (const listener of listeners) {
    listener();
  }
}

function hydrate(): AppSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SNAPSHOT;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_SNAPSHOT;
    }
    const parsed = JSON.parse(raw) as Partial<{
      defaultProjectDirectory: unknown;
      conversationDensity: unknown;
    }>;
    const directory =
      typeof parsed.defaultProjectDirectory === "string" &&
      parsed.defaultProjectDirectory.trim().length > 0
        ? parsed.defaultProjectDirectory
        : null;
    return Object.freeze({
      defaultProjectDirectory: directory,
      conversationDensity: isConversationDensity(parsed.conversationDensity)
        ? parsed.conversationDensity
        : DEFAULT_CONVERSATION_DENSITY,
    });
  } catch {
    return DEFAULT_SNAPSHOT;
  }
}

function isConversationDensity(value: unknown): value is ConversationDensity {
  return USER_CONVERSATION_DENSITY_VALUES.some((density) => density === value);
}

function persist(next: AppSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage failure must not break settings.
  }
}
