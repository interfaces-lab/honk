import type { WaitingPhase } from "../../../session-logic";

export type { WaitingPhase };

export const WAITING_PHASE_LABEL = "Planning next move";
export const WAITING_PHASE_SLOW_LABEL = "This is taking a bit longer...";
export const WAITING_SLOW_LABEL_THRESHOLD_MS = 15_000;

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

export function resolveWaitingStatusLabel(elapsedMs: number): string {
  return elapsedMs >= WAITING_SLOW_LABEL_THRESHOLD_MS
    ? WAITING_PHASE_SLOW_LABEL
    : WAITING_PHASE_LABEL;
}
