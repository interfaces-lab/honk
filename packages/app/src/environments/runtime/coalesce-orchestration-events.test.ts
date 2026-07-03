import {
  EventId,
  TurnId,
} from "@honk/shared/base-schemas";
import type {
  OrchestrationEvent,
  OrchestrationThreadActivity,
} from "@honk/shared/orchestration";
import { ThreadId } from "@honk/shared/base-schemas";
import { describe, expect, it } from "vitest";

import { coalesceOrchestrationUiEvents } from "./coalesce-orchestration-events";

const threadId = ThreadId.make("thread:coalesce-subagent");
const subagentThreadId = "thread:coalesce-subagent:child";
const turnId = TurnId.make("turn:coalesce-subagent");
const createdAt = "2026-06-01T12:00:00.000Z";

describe("coalesceOrchestrationUiEvents", () => {
  it("coalesces subagent content deltas by subagent thread and item", () => {
    const events = coalesceOrchestrationUiEvents([
      threadActivityAppendedEvent(
        1,
        subagentContentDeltaActivity({
          id: "1",
          itemId: "assistant:streaming",
          delta: "first",
          sequence: 1,
        }),
      ),
      threadActivityAppendedEvent(
        2,
        subagentContentDeltaActivity({
          id: "2",
          itemId: "assistant:streaming",
          delta: " second",
          sequence: 2,
        }),
      ),
      threadActivityAppendedEvent(
        3,
        subagentContentDeltaActivity({
          id: "3",
          itemId: "assistant:other",
          delta: "other",
          sequence: 3,
        }),
      ),
    ]);

    expect(events).toHaveLength(2);
    const first = events[0];
    const second = events[1];
    expect(first?.type).toBe("thread.activity-appended");
    expect(second?.type).toBe("thread.activity-appended");
    if (first?.type !== "thread.activity-appended" || second?.type !== "thread.activity-appended") {
      throw new Error("Expected coalesced activity events");
    }
    expect(first.payload.activity).toEqual(
      expect.objectContaining({
        createdAt,
        sequence: 1,
        payload: expect.objectContaining({
          itemId: "assistant:streaming",
          delta: "first second",
        }),
      }),
    );
    expect(second.payload.activity).toEqual(
      expect.objectContaining({
        sequence: 3,
        payload: expect.objectContaining({
          itemId: "assistant:other",
          delta: "other",
        }),
      }),
    );
  });

  it("coalesces subagent item snapshots by subagent thread and item", () => {
    const events = coalesceOrchestrationUiEvents([
      threadActivityAppendedEvent(
        1,
        subagentItemActivity({
          id: "1",
          itemId: "assistant:snapshot",
          detail: "partial snapshot",
          sequence: 1,
        }),
      ),
      threadActivityAppendedEvent(
        2,
        subagentItemActivity({
          id: "2",
          itemId: "assistant:snapshot",
          detail: "latest snapshot",
          sequence: 2,
        }),
      ),
      threadActivityAppendedEvent(
        3,
        subagentItemActivity({
          id: "3",
          itemId: "assistant:other",
          detail: "other snapshot",
          sequence: 3,
        }),
      ),
    ]);

    expect(events).toHaveLength(2);
    const first = events[0];
    const second = events[1];
    expect(first?.type).toBe("thread.activity-appended");
    expect(second?.type).toBe("thread.activity-appended");
    if (first?.type !== "thread.activity-appended" || second?.type !== "thread.activity-appended") {
      throw new Error("Expected coalesced activity events");
    }
    expect(first.payload.activity).toEqual(
      expect.objectContaining({
        id: EventId.make("activity:coalesce-subagent:item:2"),
        createdAt,
        sequence: 1,
        payload: expect.objectContaining({
          itemId: "assistant:snapshot",
          detail: "latest snapshot",
        }),
      }),
    );
    expect(second.payload.activity).toEqual(
      expect.objectContaining({
        sequence: 3,
        payload: expect.objectContaining({
          itemId: "assistant:other",
          detail: "other snapshot",
        }),
      }),
    );
  });
});

function threadActivityAppendedEvent(
  sequence: number,
  activity: OrchestrationThreadActivity,
): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.make(`event:coalesce-subagent:${sequence}`),
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: createdAt,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.activity-appended",
    payload: {
      threadId,
      activity,
    },
  };
}

function subagentContentDeltaActivity(input: {
  id: string;
  itemId: string;
  delta: string;
  sequence: number;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(`activity:coalesce-subagent:${input.id}`),
    kind: "subagent.content.delta",
    tone: "info",
    summary: "Streaming child response",
    turnId,
    sequence: input.sequence,
    createdAt,
    payload: {
      subagentThreadId,
      parentThreadId: threadId,
      parentTurnId: turnId,
      itemId: input.itemId,
      streamKind: "assistant_text",
      delta: input.delta,
    },
  };
}

function subagentItemActivity(input: {
  id: string;
  itemId: string;
  detail: string;
  sequence: number;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(`activity:coalesce-subagent:item:${input.id}`),
    kind: "subagent.item.updated",
    tone: "info",
    summary: "Child response snapshot",
    turnId,
    sequence: input.sequence,
    createdAt,
    payload: {
      subagentThreadId,
      parentThreadId: threadId,
      parentTurnId: turnId,
      itemId: input.itemId,
      itemType: "assistant_message",
      status: "running",
      title: "Assistant",
      detail: input.detail,
    },
  };
}
