// App settings — persisted, app-wide preferences that are neither modes (WAY the agent works) nor
// presets (WHICH models). Plain {subscribe, snapshot, actions} module in the tab-store idiom
// (mirrors modes.ts / presets.ts): timers/persistence live here, React only reads via hooks.
//
// defaultProjectDirectory is the folder new threads open in when the composer does not pick one
// explicitly. `null` means "let the sidecar's own default directory govern" (client.path.get()),
// so we distinguish "unset" from any real path. The folder-picker bridge (window.desktopBridge
// .pickFolder) writes an absolute path here; the home composer reads it into OpenNewThreadInput.

import { useSyncExternalStore } from "react";

export type AppSettings = {
  /** Absolute path new threads open in; null → use the sidecar's default directory. */
  readonly defaultProjectDirectory: string | null;
};

const STORAGE_KEY = "honk:app-next:app-settings";
const DEFAULT_SNAPSHOT: AppSettings = Object.freeze({
  defaultProjectDirectory: null,
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

export const actions = {
  /** Pin a default project directory. A blank string clears it back to the sidecar default. */
  setDefaultProjectDirectory(directory: string | null): void {
    const next = directory === null || directory.trim().length === 0 ? null : directory;
    if (next === snapshot.defaultProjectDirectory) {
      return;
    }
    publish({ ...snapshot, defaultProjectDirectory: next });
  },

  /** Clear the pinned directory (revert to the sidecar's default). */
  clearDefaultProjectDirectory(): void {
    if (snapshot.defaultProjectDirectory === null) {
      return;
    }
    publish({ ...snapshot, defaultProjectDirectory: null });
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
    }>;
    const directory =
      typeof parsed.defaultProjectDirectory === "string" &&
      parsed.defaultProjectDirectory.trim().length > 0
        ? parsed.defaultProjectDirectory
        : null;
    return Object.freeze({
      defaultProjectDirectory: directory,
    });
  } catch {
    return DEFAULT_SNAPSHOT;
  }
}

function persist(next: AppSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Persistence must never break the settings surface.
  }
}
