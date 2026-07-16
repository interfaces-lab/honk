import { describe, expect, it } from "vitest";

import {
  activeTurnStartedAtMs,
  WAITING_PLANNING_LABEL,
  WAITING_SLOW_LABEL,
  waitingStatusLabel,
} from "./waiting-status";

describe("waiting status", () => {
  it("uses the latest user message as the stable generation epoch", () => {
    expect(
      activeTurnStartedAtMs([
        { role: "user", time: { created: 10 } },
        { role: "assistant", time: { created: 20 } },
        { role: "user", time: { created: 30 } },
        { role: "assistant", time: { created: 40 } },
      ]),
    ).toBe(30);
  });

  it("falls back to the latest assistant for an assistant-led transcript", () => {
    expect(
      activeTurnStartedAtMs([
        { role: "assistant", time: { created: 10 } },
        { role: "assistant", time: { created: 20 } },
      ]),
    ).toBe(20);
  });

  it("reveals planning after 200ms and escalates after 15 seconds", () => {
    const base = {
      isRunning: true,
      hasVisibleActivity: false,
      turnStartedAtMs: 1_000,
    } as const;

    expect(waitingStatusLabel({ ...base, nowMs: 1_199 })).toBeNull();
    expect(waitingStatusLabel({ ...base, nowMs: 1_200 })).toBe(WAITING_PLANNING_LABEL);
    expect(waitingStatusLabel({ ...base, nowMs: 15_999 })).toBe(WAITING_PLANNING_LABEL);
    expect(waitingStatusLabel({ ...base, nowMs: 16_000 })).toBe(WAITING_SLOW_LABEL);
  });

  it("stays absent when real activity owns the row or the turn has stopped", () => {
    expect(
      waitingStatusLabel({
        isRunning: true,
        hasVisibleActivity: true,
        turnStartedAtMs: 1_000,
        nowMs: 20_000,
      }),
    ).toBeNull();
    expect(
      waitingStatusLabel({
        isRunning: false,
        hasVisibleActivity: false,
        turnStartedAtMs: 1_000,
        nowMs: 20_000,
      }),
    ).toBeNull();
  });
});
