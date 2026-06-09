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
  it("shows a stable thinking label", () => {
    expect(resolveWaitingStatusLabel()).toBe("Thinking...");
  });
});
