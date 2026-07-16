export const WAITING_REVEAL_DELAY_MS = 200;
export const WAITING_SLOW_THRESHOLD_MS = 15_000;
export const WAITING_PLANNING_LABEL = "Planning next moves";
export const WAITING_SLOW_LABEL = "Taking longer than expected…";

type TimedMessage = {
  readonly role: "user" | "assistant";
  readonly time: { readonly created: number };
};

export function activeTurnStartedAtMs(messages: readonly TimedMessage[]): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return message.time.created;
    }
  }
  return messages.at(-1)?.time.created ?? null;
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
