// The chat session store, in the same shape as connection-store and client.ts:
// the watch subscription and the reducer fold live at module level so
// components stay effect-free — surfaces read one stable snapshot through
// useSyncExternalStore. One handle per session, refcounted; the watch closes
// when the last surface lets go.

import * as React from "react";

import type { Session } from "@honk/core/session";

import type { ChatEvent, ChatState } from "./chat-model";
import { initialState, reduce } from "./chat-model";
import {
  describeError,
  getHonkClient,
  getSnapshot as getCoreSnapshot,
  subscribe as subscribeCore,
} from "./client";

interface SessionHandle {
  refs: number;
  state: ChatState;
  readonly listeners: Set<() => void>;
  stop: (() => void) | null;
}

const handles = new Map<string, SessionHandle>();

function handleOf(sessionId: Session.SessionId): SessionHandle {
  let handle = handles.get(sessionId);
  if (handle === undefined) {
    handle = { refs: 0, state: initialState, listeners: new Set(), stop: null };
    handles.set(sessionId, handle);
  }
  return handle;
}

function dispatch(handle: SessionHandle, event: ChatEvent): void {
  const next = reduce(handle.state, event);
  if (next === handle.state) return;
  handle.state = next;
  for (const listener of handle.listeners) listener();
}

/**
 * Consumes the session watch (spec/core.md section 9): one authoritative read
 * at attach, advisory events between, a repair read at each commit point. The
 * store only maps frames to reducer events.
 */
function startWatch(
  handle: SessionHandle,
  sessionId: Session.SessionId,
  client: NonNullable<ReturnType<typeof getHonkClient>>,
): () => void {
  let disposed = false;
  const frames = client.session.watch({ sessionId })[Symbol.asyncIterator]();
  dispatch(handle, { type: "attached", sessionId });
  void (async () => {
    try {
      for (let next = await frames.next(); next.done !== true; next = await frames.next()) {
        if (disposed) return;
        const frame = next.value;
        dispatch(
          handle,
          frame.type === "state"
            ? { type: "state", entries: frame.entries, status: frame.status, turns: frame.turns }
            : { type: "event", event: frame.event },
        );
      }
      if (!disposed) dispatch(handle, { type: "stream_ended" });
    } catch (error) {
      if (!disposed) dispatch(handle, { type: "failed", message: describeError(error) });
    }
  })();
  return () => {
    disposed = true;
    void frames.return?.(undefined);
  };
}

/**
 * Opens the session's watch on first retain and closes it on last release.
 * Waits for the core boot store when the client is still connecting.
 */
export function retainSession(sessionId: Session.SessionId): () => void {
  const handle = handleOf(sessionId);
  handle.refs += 1;
  if (handle.refs === 1) {
    let stopWatch: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;
    const tryStart = (): boolean => {
      const core = getCoreSnapshot();
      if (core.status === "ready") {
        stopWatch = startWatch(handle, sessionId, core.client);
        return true;
      }
      if (core.status === "unavailable") {
        dispatch(handle, { type: "failed", message: "Honk Core is not available in this host." });
        return true;
      }
      return false;
    };
    if (!tryStart()) {
      unsubscribe = subscribeCore(() => {
        if (tryStart()) {
          unsubscribe?.();
          unsubscribe = null;
        }
      });
    }
    handle.stop = () => {
      unsubscribe?.();
      stopWatch?.();
    };
  }
  return () => {
    handle.refs -= 1;
    if (handle.refs === 0) {
      handle.stop?.();
      handles.delete(sessionId);
    }
  };
}

export interface CoreChat {
  readonly state: ChatState;
  readonly prompt: (text: string) => Promise<void>;
  readonly steer: (text: string) => Promise<void>;
  readonly stop: () => Promise<void>;
}

function command(
  sessionId: Session.SessionId,
  run: (client: NonNullable<ReturnType<typeof getHonkClient>>) => Promise<unknown>,
): Promise<void> {
  const client = getHonkClient();
  if (client === null) return Promise.resolve();
  return run(client).then(
    () => undefined,
    (error: unknown) => {
      const handle = handles.get(sessionId);
      if (handle !== undefined) {
        dispatch(handle, { type: "failed", message: describeError(error) });
      }
      throw error;
    },
  );
}

/** Attaches to a session: the store folds, the component only reads. */
export function useCoreSession(sessionId: Session.SessionId): CoreChat {
  React.useEffect(() => retainSession(sessionId), [sessionId]);
  const state = React.useSyncExternalStore(
    (onStoreChange) => {
      const handle = handleOf(sessionId);
      handle.listeners.add(onStoreChange);
      return () => {
        handle.listeners.delete(onStoreChange);
      };
    },
    () => handles.get(sessionId)?.state ?? initialState,
    () => initialState,
  );

  return {
    state,
    prompt: (text) => {
      const handle = handles.get(sessionId);
      if (handle !== undefined) dispatch(handle, { type: "prompted" });
      return command(sessionId, (client) => client.session.prompt({ sessionId, text }));
    },
    steer: (text) => command(sessionId, (client) => client.session.steer({ sessionId, text })),
    stop: () => command(sessionId, (client) => client.session.abort({ sessionId })),
  };
}
