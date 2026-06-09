"use client";

import { useMemo, useSyncExternalStore } from "react";

import { ChatLoader } from "./chat-loader";
import {
  resolveWaitingStatusLabel,
  type WaitingPhase,
} from "./waiting-status";

export function WorkingStatusRow({
  elapsedStartedAt,
}: {
  phase: WaitingPhase;
  elapsedStartedAt: string | null;
}) {
  const nowMs = useNowMs(500);
  const label = useMemo(
    () => resolveWaitingStatusLabel({ elapsedStartedAt, nowMs }),
    [elapsedStartedAt, nowMs],
  );

  return (
    <div className="flex w-full min-w-0 items-center gap-2 py-0.5">
      <ChatLoader className="py-0" label={label} />
    </div>
  );
}

function useNowMs(intervalMs: number): number {
  const store = useMemo(() => createNowMsStore(intervalMs), [intervalMs]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function createNowMsStore(intervalMs: number) {
  let nowMs = Date.now();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();

  const tick = () => {
    nowMs = Date.now();
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getSnapshot: () => nowMs,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      intervalId ??= setInterval(tick, intervalMs);

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
      };
    },
  };
}
