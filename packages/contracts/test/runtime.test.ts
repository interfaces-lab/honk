import { EventId, RuntimeSessionId, ThreadId } from "@honk/contracts";
import { describe, expect, it } from "vitest";

import { decodeHonkRuntimeHostEvent, decodeHonkRuntimeHostSnapshot } from "../src/runtime";

const threadId = ThreadId.make("thread:runtime-contracts");
const runtimeSessionId = RuntimeSessionId.make("runtime:runtime-contracts");
const createdAt = "2026-06-14T17:00:00.000Z";

function legacyShellTimeline() {
  return {
    threadId,
    runtimeSessionId,
    items: [
      {
        id: "tool:legacy-shell",
        kind: "tool",
        orderKey: `${createdAt}:tool:legacy-shell`,
        createdAt,
        toolCallId: "toolu-legacy-shell",
        toolName: "bash",
        status: "completed",
        eventIds: [EventId.make("runtime-event:legacy-shell")],
        display: {
          kind: "shell",
          command: "git status --short",
          output: "M file.ts",
        },
      },
    ],
  };
}

describe("runtime contracts", () => {
  it("migrates legacy shell display timeline snapshots to bash", () => {
    const snapshot = decodeHonkRuntimeHostSnapshot({
      preferences: {},
      displayTimelines: [legacyShellTimeline()],
    });

    expect(snapshot.displayTimelines[0]?.items[0]).toMatchObject({
      kind: "tool",
      display: {
        kind: "bash",
        command: "git status --short",
      },
    });
  });

  it("migrates legacy shell display timeline events to bash", () => {
    const event = decodeHonkRuntimeHostEvent({
      type: "display-timeline",
      timeline: legacyShellTimeline(),
    });

    expect(event).toMatchObject({
      type: "display-timeline",
      timeline: {
        items: [
          {
            kind: "tool",
            display: {
              kind: "bash",
            },
          },
        ],
      },
    });
  });
});
