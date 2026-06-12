import {
  EventId,
  RuntimeSessionId,
  ThreadId,
  TurnId,
  type AgentRuntimeEvent,
} from "@honk/contracts";
import { describe, expect, it } from "vitest";

import { toWireRuntimeEvent } from "../src/runtime-event-wire";

const baseEvent = {
  id: EventId.make("runtime-event:wire-test"),
  type: "message.updated",
  agentRuntime: "pi",
  threadId: ThreadId.make("thread:wire-test"),
  runtimeSessionId: RuntimeSessionId.make("runtime-session:wire-test"),
  turnId: TurnId.make("turn:wire-test"),
  createdAt: "2026-06-12T12:00:00.000Z",
  summary: "Summary",
  messageRole: "assistant",
  text: "hello",
  thinking: "thinking",
  data: { retained: false },
  raw: { raw: true },
} satisfies AgentRuntimeEvent;

describe("toWireRuntimeEvent", () => {
  it.each([
    "context-window.updated",
    "turn.started",
    "turn.completed",
    "turn.proposed.completed",
  ] satisfies AgentRuntimeEvent["type"][])("keeps data for %s", (type) => {
    const event = { ...baseEvent, type, data: { retained: true } } satisfies AgentRuntimeEvent;

    expect(toWireRuntimeEvent(event)).toBe(event);
  });

  it("keeps data for subagent tool updates and completions", () => {
    const updated = {
      ...baseEvent,
      type: "tool.updated",
      data: { toolName: "subagent", partialResult: { details: { activities: [] } } },
    } satisfies AgentRuntimeEvent;
    const completed = {
      ...baseEvent,
      type: "tool.completed",
      data: { toolName: "subagent", result: { details: { activities: [] } } },
    } satisfies AgentRuntimeEvent;

    expect(toWireRuntimeEvent(updated)).toBe(updated);
    expect(toWireRuntimeEvent(completed)).toBe(completed);
  });

  it("drops data for non-allowlisted events while preserving other fields", () => {
    const wireEvent = toWireRuntimeEvent(baseEvent);

    expect(wireEvent).toEqual({
      id: baseEvent.id,
      type: baseEvent.type,
      agentRuntime: baseEvent.agentRuntime,
      threadId: baseEvent.threadId,
      runtimeSessionId: baseEvent.runtimeSessionId,
      turnId: baseEvent.turnId,
      createdAt: baseEvent.createdAt,
      summary: baseEvent.summary,
      messageRole: baseEvent.messageRole,
      text: baseEvent.text,
      thinking: baseEvent.thinking,
      raw: baseEvent.raw,
    });
    expect("data" in wireEvent).toBe(false);
  });

  it("drops data for non-subagent tool events and non-record tool data", () => {
    expect(
      "data" in
        toWireRuntimeEvent({
          ...baseEvent,
          type: "tool.updated",
          data: { toolName: "read" },
        }),
    ).toBe(false);
    expect(
      "data" in
        toWireRuntimeEvent({
          ...baseEvent,
          type: "tool.completed",
          data: "subagent",
        }),
    ).toBe(false);
  });
});
