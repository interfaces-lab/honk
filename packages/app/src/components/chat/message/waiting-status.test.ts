import { describe, expect, it } from "vitest";

import {
  resolveWaitingStatusLabel,
  resolveWaitingTimelineStatus,
  WAITING_SLOW_LABEL_THRESHOLD_MS,
} from "./waiting-status";

describe("resolveWaitingTimelineStatus", () => {
  it("defaults to thinking with active turn start", () => {
    const startedAt = "2026-06-05T16:00:00.000Z";
    expect(
      resolveWaitingTimelineStatus({
        activeTurnStartedAt: startedAt,
      }),
    ).toEqual({
      elapsedStartedAt: startedAt,
    });
  });
});

describe("resolveWaitingStatusLabel", () => {
  it("starts with the planning label", () => {
    expect(resolveWaitingStatusLabel(0)).toBe("Planning next moves");
  });

  it("switches to the slow label past the threshold", () => {
    expect(resolveWaitingStatusLabel(WAITING_SLOW_LABEL_THRESHOLD_MS)).toBe(
      "This is taking a bit longer...",
    );
  });
});
