// React bindings for the SDK watch registry (ADR 0025 §2).
// Zero useEffect: subscribe via useSyncExternalStore; list-shaped reads use
// useSyncExternalStoreWithSelector so row memoization rides the reducer's
// structural sharing. Selectors are held in refs so an inline `(s) => …`
// does not change the store subscribe identity every render (which would
// churn the registry's refcount).

import { useCallback, useRef, useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import {
  getThreadWatchServerSnapshot,
  getThreadWatchSnapshot,
  getWorkspaceWatchServerSnapshot,
  getWorkspaceWatchSnapshot,
  subscribeThreadWatch,
  subscribeWorkspaceWatch,
  type ThreadWatchSnapshot,
  type WorkspaceWatchSnapshot,
} from "./watch-registry";

function useStableSelector<Snapshot, Selection>(
  selector: (snapshot: Snapshot) => Selection,
): (snapshot: Snapshot) => Selection {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  return useCallback((snapshot: Snapshot) => selectorRef.current(snapshot), []);
}

function useStableEqual<Selection>(
  isEqual: ((a: Selection, b: Selection) => boolean) | undefined,
): ((a: Selection, b: Selection) => boolean) | undefined {
  const isEqualRef = useRef(isEqual);
  isEqualRef.current = isEqual;
  return useCallback((a: Selection, b: Selection) => {
    const compare = isEqualRef.current;
    return compare === undefined ? Object.is(a, b) : compare(a, b);
  }, []);
}

/** Full thread watch wrapper: `{ state, status }` from the registry. */
export function useThreadWatch(threadId: string): ThreadWatchSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => subscribeThreadWatch(threadId, listener),
    [threadId],
  );
  const getSnapshot = useCallback(
    () => getThreadWatchSnapshot(threadId),
    [threadId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getThreadWatchServerSnapshot);
}

/**
 * Select a slice of the thread watch snapshot. Prefer this for list rows so
 * unchanged item refs from the reducer do not re-render siblings.
 */
export function useThreadWatchSelector<Selection>(
  threadId: string,
  selector: (snapshot: ThreadWatchSnapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  const subscribe = useCallback(
    (listener: () => void) => subscribeThreadWatch(threadId, listener),
    [threadId],
  );
  const getSnapshot = useCallback(
    () => getThreadWatchSnapshot(threadId),
    [threadId],
  );
  const stableSelector = useStableSelector(selector);
  const stableEqual = useStableEqual(isEqual);
  return useSyncExternalStoreWithSelector(
    subscribe,
    getSnapshot,
    getThreadWatchServerSnapshot,
    stableSelector,
    stableEqual,
  );
}

/** Workspace / thread-summary watch — Home list and tab titles. */
export function useWorkspaceWatch(): WorkspaceWatchSnapshot {
  return useSyncExternalStore(
    subscribeWorkspaceWatch,
    getWorkspaceWatchSnapshot,
    getWorkspaceWatchServerSnapshot,
  );
}

/**
 * Select a slice of the workspace watch snapshot (e.g. one ThreadSummary by id
 * for a tab title).
 */
export function useWorkspaceWatchSelector<Selection>(
  selector: (snapshot: WorkspaceWatchSnapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  const stableSelector = useStableSelector(selector);
  const stableEqual = useStableEqual(isEqual);
  return useSyncExternalStoreWithSelector(
    subscribeWorkspaceWatch,
    getWorkspaceWatchSnapshot,
    getWorkspaceWatchServerSnapshot,
    stableSelector,
    stableEqual,
  );
}
