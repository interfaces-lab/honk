"use client";

import { ChatLoader } from "./chat-loader";
import {
  resolveWaitingStatusLabel,
  type WaitingPhase,
} from "./waiting-status";

export function WorkingStatusRow({
  phase: _phase,
}: {
  phase: WaitingPhase;
  elapsedStartedAt?: string | null;
}) {
  const label = resolveWaitingStatusLabel();

  return (
    <div className="flex w-full min-w-0 items-center gap-2 py-0.5">
      <ChatLoader className="py-0" label={label} />
    </div>
  );
}
