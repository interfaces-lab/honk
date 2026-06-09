import type { TimelineEntry, WaitingPhase } from "../../../session-logic";

export type { WaitingPhase };

export const WAITING_PHASE_LABELS: Record<WaitingPhase, string> = {
  thinking: "Thinking",
  "processing-tool-calls": "Processing tool calls",
};

/** Cursor agent-loop: after 500ms in thinking with no new activity, show processing. */
export const WAITING_THINKING_TO_PROCESSING_MS = 500;

export interface WaitingTimelineStatus {
  phase: WaitingPhase;
  elapsedStartedAt: string | null;
}

export function resolveWaitingTimelineStatus(input: {
  readonly entries: ReadonlyArray<TimelineEntry>;
  readonly activeTurnStartedAt: string | null;
}): WaitingTimelineStatus {
  const lastEntry = input.entries.at(-1);
  if (lastEntry && isCompletedActivityTimelineEntry(lastEntry)) {
    return {
      phase: "processing-tool-calls",
      elapsedStartedAt: lastEntry.createdAt ?? input.activeTurnStartedAt,
    };
  }

  return {
    phase: "thinking",
    elapsedStartedAt: input.activeTurnStartedAt,
  };
}

function isCompletedActivityTimelineEntry(entry: TimelineEntry): boolean {
  switch (entry.kind) {
    case "runtime-thinking":
      return entry.message.streaming !== true;
    case "runtime-tool":
      return entry.tool.status !== "running";
    case "work":
      return entry.entry.status !== "running";
    default:
      return false;
  }
}

export function resolveWaitingStatusLabel(input: {
  readonly phase: WaitingPhase;
  readonly elapsedStartedAt: string | null;
  readonly nowMs: number;
}): string {
  const elapsedMs = resolveWaitingElapsedMs(input.elapsedStartedAt, input.nowMs);
  const effectivePhase =
    input.phase === "thinking" && elapsedMs >= WAITING_THINKING_TO_PROCESSING_MS
      ? "processing-tool-calls"
      : input.phase;
  const label = WAITING_PHASE_LABELS[effectivePhase];
  const elapsedLabel = formatWaitingElapsedLabel(elapsedMs);
  return elapsedLabel ? `${label} ${elapsedLabel}` : label;
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
