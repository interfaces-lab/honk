import { describe, expect, it } from "vitest";

import { resolveWaitingStatusLabel, resolveWaitingTimelineStatus } from "./waiting-status";

describe("resolveWaitingTimelineStatus", () => {
  it("defaults to thinking with active turn start", () => {
    const startedAt = "2026-06-05T16:00:00.000Z";
    expect(
      resolveWaitingTimelineStatus({
        activeTurnStartedAt: startedAt,
      }),
    ).toEqual({
      phase: "thinking",
      elapsedStartedAt: startedAt,
    });
  });
});

describe("resolveWaitingStatusLabel", () => {
  it("shows thinking without elapsed time under one second", () => {
    const startedAtMs = Date.parse("2026-06-05T16:00:00.000Z");
    expect(
      resolveWaitingStatusLabel({
        elapsedStartedAt: "2026-06-05T16:00:00.000Z",
        nowMs: startedAtMs + 500,
      }),
    ).toBe("Thinking");
  });

  it("appends elapsed time after one second", () => {
    const startedAtMs = Date.parse("2026-06-05T16:00:00.000Z");
    expect(
      resolveWaitingStatusLabel({
        elapsedStartedAt: "2026-06-05T16:00:00.000Z",
        nowMs: startedAtMs + 2_500,
      }),
    ).toBe("Thinking 2.5s");
  });
});
