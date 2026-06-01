import {
  EventId,
  MessageId,
  OrchestrationProposedPlanId,
  ThreadEntryId,
  ThreadId,
  TurnId,
} from "@multi/contracts";
import { deriveChatTimelineRows } from "@multi/shared/chat-timeline-derivation";
import { describe, expect, it } from "vitest";

const THREAD_ID = ThreadId.make("thread-1");
const TURN_ID = TurnId.make("turn-1");

function toolActivity(
  id: string,
  kind: "tool.started" | "tool.updated" | "tool.completed",
  itemId: string,
  createdAt: string,
) {
  return {
    id: EventId.make(id),
    tone: "tool" as const,
    kind,
    summary: "Ran command",
    payload: { itemId, itemType: "command_execution" as const },
    turnId: TURN_ID,
    createdAt,
  };
}

describe("deriveChatTimelineRows", () => {
  it("collapses tool lifecycle activities into one work row", () => {
    const rows = deriveChatTimelineRows({
      messages: [],
      entries: [],
      proposedPlans: [],
      activities: [
        toolActivity("a-1", "tool.started", "tool-call-1", "2026-03-01T00:00:01.000Z"),
        toolActivity("a-2", "tool.updated", "tool-call-1", "2026-03-01T00:00:02.000Z"),
        toolActivity("a-3", "tool.completed", "tool-call-1", "2026-03-01T00:00:03.000Z"),
      ],
    });

    const workRows = rows.filter((row) => row.kind === "work");
    expect(workRows).toHaveLength(1);
    expect(workRows[0]?.kind === "work" && workRows[0].activityIds).toEqual([
      EventId.make("a-1"),
      EventId.make("a-2"),
      EventId.make("a-3"),
    ]);
    expect(workRows[0]?.kind === "work" && workRows[0].toolCallId).toBe("tool-call-1");
  });

  it("keeps real tool summaries as separate work rows", () => {
    const rows = deriveChatTimelineRows({
      messages: [],
      entries: [],
      proposedPlans: [],
      activities: [
        toolActivity("a-1", "tool.started", "tool-call-1", "2026-03-01T00:00:01.000Z"),
        toolActivity("a-2", "tool.completed", "tool-call-1", "2026-03-01T00:00:02.000Z"),
        {
          id: EventId.make("a-3"),
          tone: "info" as const,
          kind: "tool.summary" as const,
          summary: "Updated auth middleware and added tests",
          payload: {
            summary: "Updated auth middleware and added tests",
            precedingToolUseIds: ["tool-call-1"],
          },
          turnId: TURN_ID,
          createdAt: "2026-03-01T00:00:03.000Z",
        },
      ],
    });

    const workRows = rows.filter((row) => row.kind === "work");
    expect(workRows).toHaveLength(2);
    expect(workRows[0]?.kind === "work" && workRows[0].activityIds).toEqual([
      EventId.make("a-1"),
      EventId.make("a-2"),
    ]);
    expect(workRows[1]).toEqual(
      expect.objectContaining({
        kind: "work",
        id: "work:activity:a-3",
        workId: "activity:a-3",
        activityIds: [EventId.make("a-3")],
        turnId: TURN_ID,
      }),
    );
  });

  it("suppresses generic duplicate tool summaries when lifecycle is visible", () => {
    const rows = deriveChatTimelineRows({
      messages: [],
      entries: [],
      proposedPlans: [],
      activities: [
        toolActivity("a-1", "tool.started", "tool-call-1", "2026-03-01T00:00:01.000Z"),
        toolActivity("a-2", "tool.completed", "tool-call-1", "2026-03-01T00:00:02.000Z"),
        {
          id: EventId.make("a-3"),
          tone: "info" as const,
          kind: "tool.summary" as const,
          summary: "Ran command",
          payload: {
            summary: "Ran command",
            precedingToolUseIds: ["tool-call-1"],
          },
          turnId: TURN_ID,
          createdAt: "2026-03-01T00:00:03.000Z",
        },
      ],
    });

    const workRows = rows.filter((row) => row.kind === "work");
    expect(workRows).toHaveLength(1);
    expect(workRows[0]?.kind === "work" && workRows[0].activityIds).toEqual([
      EventId.make("a-1"),
      EventId.make("a-2"),
    ]);
    expect(rows.some((row) => row.id === "work:activity:a-3")).toBe(false);
  });

  it("emits proposed-plan rows from canonical proposed plan state", () => {
    const rows = deriveChatTimelineRows({
      messages: [],
      entries: [],
      activities: [],
      proposedPlans: [
        {
          id: OrchestrationProposedPlanId.make("plan-1"),
          turnId: TURN_ID,
          planMarkdown: "# Plan",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-03-01T00:00:04.000Z",
          updatedAt: "2026-03-01T00:00:04.000Z",
        },
      ],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "proposed-plan",
        planId: OrchestrationProposedPlanId.make("plan-1"),
        turnId: TURN_ID,
      }),
    ]);
  });

  it("emits global work rows for null-turn global activities only", () => {
    const rows = deriveChatTimelineRows({
      messages: [],
      entries: [],
      proposedPlans: [],
      activities: [
        {
          id: EventId.make("global-1"),
          tone: "info" as const,
          kind: "runtime.warning" as const,
          summary: "Provider warning",
          payload: { message: "Provider warning" },
          turnId: null,
          createdAt: "2026-03-01T00:00:05.000Z",
        },
        {
          id: EventId.make("orphan-1"),
          tone: "tool" as const,
          kind: "tool.started" as const,
          summary: "Hidden tool",
          payload: { itemId: "tool-call-orphan" },
          turnId: null,
          createdAt: "2026-03-01T00:00:06.000Z",
        },
      ],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "work",
        id: "work:activity:global-1",
        workId: "activity:global-1",
        activityIds: [EventId.make("global-1")],
        turnId: null,
      }),
    ]);
  });

  it("includes message rows with entry refs", () => {
    const messageId = MessageId.make("message-1");
    const entryId = ThreadEntryId.make("entry-1");
    const rows = deriveChatTimelineRows({
      messages: [
        {
          id: messageId,
          role: "user",
          text: "hello",
          turnId: null,
          streaming: false,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ],
      entries: [
        {
          id: entryId,
          threadId: THREAD_ID,
          parentEntryId: null,
          kind: "message",
          messageId,
          turnId: null,
          createdAt: "2026-03-01T00:00:00.000Z",
        },
      ],
      proposedPlans: [],
      activities: [],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "message",
        messageId,
        entryId,
      }),
    ]);
  });
});
