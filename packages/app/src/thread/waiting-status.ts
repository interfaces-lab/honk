export const WAITING_REVEAL_DELAY_MS = 200;
export const WAITING_SLOW_THRESHOLD_MS = 15_000;
export const WAITING_PLANNING_LABEL = "Planning next moves";
export const WAITING_SLOW_LABEL = "Taking longer than expected…";

type TimedMessage = {
  readonly role: "user" | "assistant";
  readonly time: { readonly created: number };
};

type TimedPart =
  | {
      readonly type: "text" | "reasoning";
      readonly time?: { readonly start?: number; readonly end?: number };
    }
  | {
      readonly type: "tool";
      readonly state: {
        readonly status: string;
        readonly time?: { readonly start?: number; readonly end?: number };
      };
    }
  | { readonly type: "retry"; readonly time: { readonly created: number } }
  | {
      readonly type:
        | "subtask"
        | "file"
        | "step-start"
        | "step-finish"
        | "snapshot"
        | "patch"
        | "agent"
        | "compaction";
    };

// The waiting indicator counts from the most recent activity, not the whole
// turn. A single turn produces many "moves" (tool call, then plan the next
// step); each gap between them should read as planning and restart its own
// slow-escalation clock. Anchoring to the user message would make every gap in
// a long turn read as "taking longer than expected" the moment the turn crossed
// 15s. So the epoch is the latest of the turn start and any completed part.
export function activeTurnStartedAtMs(
  messages: readonly TimedMessage[],
  parts: readonly TimedPart[] = [],
): number | null {
  const turnStart = turnStartMs(messages);
  if (turnStart === null) {
    return null;
  }
  let anchor = turnStart;
  for (const part of parts) {
    const activityMs = latestPartActivityMs(part);
    if (activityMs !== null && activityMs > anchor) {
      anchor = activityMs;
    }
  }
  return anchor;
}

function turnStartMs(messages: readonly TimedMessage[]): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return message.time.created;
    }
  }
  return messages.at(-1)?.time.created ?? null;
}

function latestPartActivityMs(part: TimedPart): number | null {
  switch (part.type) {
    case "text":
    case "reasoning":
      return part.time?.end ?? part.time?.start ?? null;
    case "tool":
      return part.state.time?.end ?? part.state.time?.start ?? null;
    case "retry":
      return part.time.created;
    default:
      return null;
  }
}

export function waitingStatusLabel(input: {
  readonly isRunning: boolean;
  readonly hasVisibleActivity: boolean;
  readonly turnStartedAtMs: number | null;
  readonly nowMs: number;
}): string | null {
  if (!input.isRunning || input.hasVisibleActivity || input.turnStartedAtMs === null) {
    return null;
  }
  const elapsedMs = Math.max(0, input.nowMs - input.turnStartedAtMs);
  if (elapsedMs < WAITING_REVEAL_DELAY_MS) {
    return null;
  }
  return elapsedMs >= WAITING_SLOW_THRESHOLD_MS ? WAITING_SLOW_LABEL : WAITING_PLANNING_LABEL;
}
