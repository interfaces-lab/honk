import { describe, expect, it } from "vitest";

import { deriveTimelineRenderItems } from "./timeline-render-items";
import { type TimelineEntry, type WorkLogEntry } from "../../../session-logic";

function workEntry(input: {
  id: string;
  tone?: WorkLogEntry["tone"];
  status?: WorkLogEntry["status"];
  createdAt?: string;
}): TimelineEntry {
  const createdAt = input.createdAt ?? "2026-04-13T12:00:00.000Z";
  return {
    id: `timeline-${input.id}`,
    kind: "work",
    createdAt,
    entry: {
      id: input.id,
      createdAt,
      label: input.id,
      tone: input.tone ?? "tool",
      ...(input.status ? { status: input.status } : {}),
    },
  };
}

describe("deriveTimelineRenderItems", () => {
  it("groups adjacent work steps with matching thinking state", () => {
    const items = deriveTimelineRenderItems({
      timelineEntries: [
        workEntry({ id: "tool-1", tone: "tool" }),
        workEntry({ id: "tool-2", tone: "info" }),
        workEntry({ id: "thinking-1", tone: "thinking" }),
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      editableUserMessageIds: new Set(),
    });

    expect(items.map((item) => item.kind)).toEqual(["group", "group"]);
    expect(items[0]?.kind === "group" && items[0].group.steps.map((step) => step.entry.id)).toEqual(
      ["tool-1", "tool-2"],
    );
    expect(items[1]?.kind === "group" && items[1].group.steps.map((step) => step.entry.id)).toEqual(
      ["thinking-1"],
    );
  });

  it("emits single items for message and proposed plan steps", () => {
    const items = deriveTimelineRenderItems({
      timelineEntries: [
        {
          id: "message:user-1",
          kind: "message",
          createdAt: "2026-04-13T12:00:00.000Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Ship it",
            turnId: null,
            createdAt: "2026-04-13T12:00:00.000Z",
            streaming: false,
          },
        },
        {
          id: "proposed-plan:plan-1",
          kind: "proposed-plan",
          createdAt: "2026-04-13T12:00:01.000Z",
          proposedPlan: {
            id: "plan-1",
            turnId: null,
            planMarkdown: "# Plan",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-04-13T12:00:01.000Z",
            updatedAt: "2026-04-13T12:00:01.000Z",
          },
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      editableUserMessageIds: new Set(["user-1" as never]),
    });

    expect(items.map((item) => item.kind)).toEqual(["single", "single"]);
    expect(items[0]?.kind === "single" && items[0].step.kind).toBe("message");
    expect(
      items[0]?.kind === "single" &&
        items[0].step.kind === "message" &&
        items[0].step.editAvailable,
    ).toBe(true);
    expect(items[1]?.kind === "single" && items[1].step.kind).toBe("proposed-plan");
  });

  it("emits a waiting group for the transient working indicator", () => {
    const items = deriveTimelineRenderItems({
      timelineEntries: [],
      isWorking: true,
      activeTurnStartedAt: "2026-04-13T12:00:02.000Z",
      editableUserMessageIds: new Set(),
    });

    expect(items).toEqual([
      {
        kind: "waitingGroup",
        id: "working-indicator-row",
        createdAt: "2026-04-13T12:00:02.000Z",
        group: {
          id: "working-indicator-row",
          createdAt: "2026-04-13T12:00:02.000Z",
          steps: [
            {
              kind: "waiting",
              id: "working-indicator-row",
              createdAt: "2026-04-13T12:00:02.000Z",
            },
          ],
        },
      },
    ]);
  });
});
