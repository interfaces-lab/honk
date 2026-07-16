import * as React from "react";

const STORAGE_KEY_PREFIX = "honk:git-viewed";

type GitViewedState = {
  readonly isViewed: (path: string) => boolean;
  readonly toggleViewed: (path: string) => void;
  readonly setViewed: (path: string, value: boolean) => void;
  readonly viewedCount: number;
  readonly clearViewed: () => void;
};

function storageKey(directory: string): string {
  return `${STORAGE_KEY_PREFIX}:${directory}`;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Access can throw in sandboxed / privacy-restricted contexts.
    return null;
  }
}

function readPersisted(directory: string): readonly string[] {
  const storage = getLocalStorage();
  if (storage === null) return [];
  try {
    const raw = storage.getItem(storageKey(directory));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function writePersisted(directory: string, paths: ReadonlySet<string>): void {
  const storage = getLocalStorage();
  if (storage === null) return;
  const key = storageKey(directory);
  try {
    if (paths.size === 0) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify([...paths]));
  } catch {
    // Quota or serialization failures are non-fatal for viewed state.
  }
}

// Load the persisted set, dropping any entries whose paths are no longer part
// of the current change set so stale files never linger in storage.
function loadPruned(directory: string, filePaths: readonly string[]): Set<string> {
  const allowed = new Set(filePaths);
  const pruned = new Set<string>();
  for (const path of readPersisted(directory)) {
    if (allowed.has(path)) pruned.add(path);
  }
  return pruned;
}

export function useGitViewedState(
  directory: string,
  filePaths: readonly string[],
): GitViewedState {
  const [viewed, setViewedSet] = React.useState<ReadonlySet<string>>(() =>
    loadPruned(directory, filePaths),
  );

  // A content signature over the path set drives re-pruning without depending
  // on the array's referential identity, which changes on every render.
  const filePathsKey = [...filePaths].sort().join("\n");

  // Re-hydrate and prune whenever the directory or its set of files changes.
  React.useEffect(() => {
    const pruned = loadPruned(directory, filePaths);
    setViewedSet(pruned);
    // Persist the pruned view so removed paths are physically evicted.
    if (pruned.size !== readPersisted(directory).length) {
      writePersisted(directory, pruned);
    }
    // filePathsKey stands in for filePaths' contents; directory keys storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directory, filePathsKey]);

  const setViewed = (path: string, value: boolean): void => {
    setViewedSet((prev) => {
      if (value === prev.has(path)) return prev;
      const next = new Set(prev);
      if (value) next.add(path);
      else next.delete(path);
      writePersisted(directory, next);
      return next;
    });
  };

  const toggleViewed = (path: string): void => {
    setViewedSet((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      writePersisted(directory, next);
      return next;
    });
  };

  const clearViewed = (): void => {
    setViewedSet((prev) => {
      if (prev.size === 0) return prev;
      writePersisted(directory, new Set());
      return new Set();
    });
  };

  const isViewed = (path: string): boolean => viewed.has(path);

  return { isViewed, toggleViewed, setViewed, viewedCount: viewed.size, clearViewed };
}
