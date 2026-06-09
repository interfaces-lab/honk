import type { WaitingPhase } from "../../../session-logic";

export type { WaitingPhase };

export const WAITING_PHASE_LABEL = "Thinking...";

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

export function resolveWaitingStatusLabel(): string {
  return WAITING_PHASE_LABEL;
}
