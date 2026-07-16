// React bindings for the SDK watch registry (ADR 0025 §2).
// Zero useEffect: subscribe via useSyncExternalStore; list-shaped reads use
// useSyncExternalStoreWithSelector so row memoization rides the registry's
// structural sharing. Only the server-scoped subscription closures are stable;
// the selector hook handles changing selector functions without resubscribing.

import { openCodeSessionRef, type OpenCodeSessionRef } from "@honk/opencode";
import { useCallback, useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import {
  getSessionWatchServerSnapshot,
  getSessionWatchSnapshot,
  getWorkspaceWatchServerSnapshot,
  getWorkspaceWatchSnapshot,
  subscribeSessionWatch,
  subscribeWorkspaceWatch,
  type SessionWatchSnapshot,
  type WorkspaceWatchSnapshot,
} from "./watch-registry";

/** Full session watch wrapper: `{ state, status }` from the registry. */
export function useSessionWatch(ref: OpenCodeSessionRef): SessionWatchSnapshot {
  const { server, sessionID } = ref;
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribeSessionWatch(openCodeSessionRef(server, sessionID), listener),
    [server, sessionID],
  );
  const getSnapshot = useCallback(
    () => getSessionWatchSnapshot(openCodeSessionRef(server, sessionID)),
    [server, sessionID],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSessionWatchServerSnapshot);
}

/**
 * Select a slice of the session watch snapshot. Prefer this for list rows so
 * unchanged item refs from the registry do not re-render siblings.
 */
export function useSessionWatchSelector<Selection>(
  ref: OpenCodeSessionRef,
  selector: (snapshot: SessionWatchSnapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  const { server, sessionID } = ref;
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribeSessionWatch(openCodeSessionRef(server, sessionID), listener),
    [server, sessionID],
  );
  const getSnapshot = useCallback(
    () => getSessionWatchSnapshot(openCodeSessionRef(server, sessionID)),
    [server, sessionID],
  );
  return useSyncExternalStoreWithSelector(
    subscribe,
    getSnapshot,
    getSessionWatchServerSnapshot,
    selector,
    isEqual,
  );
}

/** Workspace / session-inventory watch for the Home list and tab titles. */
export function useWorkspaceWatch(): WorkspaceWatchSnapshot {
  return useSyncExternalStore(
    subscribeWorkspaceWatch,
    getWorkspaceWatchSnapshot,
    getWorkspaceWatchServerSnapshot,
  );
}

export const useSessionInventoryWatch = useWorkspaceWatch;

/**
 * Select a slice of the workspace watch snapshot (e.g. one session row by id
 * for a tab title).
 */
export function useWorkspaceWatchSelector<Selection>(
  selector: (snapshot: WorkspaceWatchSnapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  return useSyncExternalStoreWithSelector(
    subscribeWorkspaceWatch,
    getWorkspaceWatchSnapshot,
    getWorkspaceWatchServerSnapshot,
    selector,
    isEqual,
  );
}

export const useSessionInventoryWatchSelector = useWorkspaceWatchSelector;
