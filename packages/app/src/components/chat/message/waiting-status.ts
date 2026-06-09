import type { WaitingPhase } from "../../../session-logic";

export type { WaitingPhase };

export const WAITING_PHASE_LABEL = "Thinking";

export interface WaitingTimelineStatus {
  phase: WaitingPhase;
  elapsedStartedAt: string | null;
}

export function resolveWaitingTimelineStatus(input: {
  readonly activeTurnStartedAt: string | null;
}): WaitingTimelineStatus {
  return {
    phase: "thinking",
    elapsedStartedAt: input.activeTurnStartedAt,
  };
}

export function resolveWaitingStatusLabel(input: {
  readonly elapsedStartedAt: string | null;
  readonly nowMs: number;
}): string {
  const elapsedMs = resolveWaitingElapsedMs(input.elapsedStartedAt, input.nowMs);
  const elapsedLabel = formatWaitingElapsedLabel(elapsedMs);
  return elapsedLabel ? `${WAITING_PHASE_LABEL} ${elapsedLabel}` : WAITING_PHASE_LABEL;
}

function resolveWaitingElapsedMs(
  elapsedStartedAt: string | null,
  nowMs: number,
): number {
  if (!elapsedStartedAt) {
    return 0;
  }
  const startedAtMs = Date.parse(elapsedStartedAt);
  if (!Number.isFinite(startedAtMs)) {
    return 0;
  }
  return Math.max(0, nowMs - startedAtMs);
}

function formatWaitingElapsedLabel(elapsedMs: number): string | null {
  if (elapsedMs < 1_000) {
    return null;
  }
  if (elapsedMs < 60_000) {
    return `${(elapsedMs / 1_000).toFixed(1)}s`;
  }
  const minutes = Math.floor(elapsedMs / 60_000);
  const seconds = Math.round((elapsedMs % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}
