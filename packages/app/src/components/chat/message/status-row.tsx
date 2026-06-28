"use client";

import { useEffect, useState } from "react";

import { ChatLoader } from "@honk/honkkit/conversation-loader";
import {
  resolveWaitingStatusLabel,
  WAITING_SLOW_LABEL_THRESHOLD_MS,
} from "./waiting-status";

function waitingElapsedMs(elapsedStartedAt: string | null): number {
  if (!elapsedStartedAt) {
    return 0;
  }
  const startedAtMs = Date.parse(elapsedStartedAt);
  return Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : 0;
}

function useWaitingStatusLabel(elapsedStartedAt: string | null): string {
  const [slow, setSlow] = useState(
    () => waitingElapsedMs(elapsedStartedAt) >= WAITING_SLOW_LABEL_THRESHOLD_MS,
  );

  useEffect(() => {
    const remainingMs = WAITING_SLOW_LABEL_THRESHOLD_MS - waitingElapsedMs(elapsedStartedAt);
    if (remainingMs <= 0) {
      setSlow(true);
      return;
    }
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), remainingMs);
    return () => clearTimeout(timer);
  }, [elapsedStartedAt]);

  return resolveWaitingStatusLabel(slow ? WAITING_SLOW_LABEL_THRESHOLD_MS : 0);
}

export function WorkingStatusRow({
  elapsedStartedAt,
}: {
  elapsedStartedAt?: string | null;
}) {
  const label = useWaitingStatusLabel(elapsedStartedAt ?? null);

  return (
    <div className="flex w-full min-w-0 items-center py-0.5">
      <ChatLoader
        className="min-h-6 px-(--conversation-text-inset) py-0 text-conversation"
        label={label}
      />
    </div>
  );
}
