import { describe, expect, it } from "vitest";

import {
  resolveWaitingStatusLabel,
  resolveWaitingTimelineStatus,
  WAITING_THINKING_TO_PROCESSING_MS,
} from "./waiting-status";

describe("resolveWaitingTimelineStatus", () => {
  it("defaults to thinking with active turn start", () => {
    const startedAt = "2026-06-05T16:00:00.000Z";
    expect(
      resolveWaitingTimelineStatus({
        entries: [],
        activeTurnStartedAt: startedAt,
      }),
    ).toEqual({
      phase: "thinking",
      elapsedStartedAt: startedAt,
    });
  });

  it("switches to processing-tool-calls after completed runtime thinking", () => {
    const thinkingCompletedAt = "2026-06-05T16:00:02.500Z";
    expect(
      resolveWaitingTimelineStatus({
        entries: [
          {
            id: "message:assistant:thinking",
            kind: "runtime-thinking",
            createdAt: thinkingCompletedAt,
            message: {
              id: "message:assistant",
              kind: "message",
              orderKey: `${thinkingCompletedAt}:message:assistant`,
              createdAt: thinkingCompletedAt,
              role: "assistant",
              source: "live-event",
              eventIds: [],
              streaming: false,
              thinking: "Inspecting repo",
            },
          },
        ],
        activeTurnStartedAt: "2026-06-05T16:00:00.000Z",
      }),
    ).toEqual({
      phase: "processing-tool-calls",
      elapsedStartedAt: thinkingCompletedAt,
    });
  });
});

describe("resolveWaitingStatusLabel", () => {
  it("promotes thinking to processing-tool-calls after the cursor delay", () => {
    const startedAtMs = Date.parse("2026-06-05T16:00:00.000Z");
    expect(
      resolveWaitingStatusLabel({
        phase: "thinking",
        elapsedStartedAt: "2026-06-05T16:00:00.000Z",
        nowMs: startedAtMs + WAITING_THINKING_TO_PROCESSING_MS,
      }),
    ).toBe("Processing tool calls");
  });

  it("appends elapsed time after one second", () => {
    const startedAtMs = Date.parse("2026-06-05T16:00:00.000Z");
    expect(
      resolveWaitingStatusLabel({
        phase: "thinking",
        elapsedStartedAt: "2026-06-05T16:00:00.000Z",
        nowMs: startedAtMs + 2_500,
      }),
    ).toBe("Processing tool calls 2.5s");
  });
});
