import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { RuntimeSessionId, ThreadId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { projectPiAgentSessionEvent } from "../src/event-projection";

const threadId = ThreadId.make("thread:event-projection");
const runtimeSessionId = RuntimeSessionId.make("runtime:event-projection");

function project(event: AgentSessionEvent) {
  return projectPiAgentSessionEvent(event, {
    threadId,
    runtimeSessionId,
    sequence: 1,
    now: new Date("2026-06-11T00:00:00.000Z"),
  });
}

describe("Pi runtime event projection", () => {
  it("keeps retrying agent_end events non-terminal", () => {
    const event = {
      type: "agent_end",
      messages: [],
      willRetry: true,
    } satisfies AgentSessionEvent;

    expect(project(event)).toMatchObject({
      type: "session.state.changed",
      threadId,
      runtimeSessionId,
    });
  });

  it("keeps final agent_end events terminal", () => {
    const event = {
      type: "agent_end",
      messages: [],
      willRetry: false,
    } satisfies AgentSessionEvent;

    expect(project(event).type).toBe("agent.completed");
  });

  it("keeps recovered auto retries non-error", () => {
    const event = {
      type: "auto_retry_end",
      success: true,
      attempt: 1,
    } satisfies AgentSessionEvent;

    expect(project(event).type).toBe("session.state.changed");
  });

  it("keeps failed auto retries as runtime errors", () => {
    const event = {
      type: "auto_retry_end",
      success: false,
      attempt: 3,
      finalError: "Retry failed",
    } satisfies AgentSessionEvent;

    expect(project(event)).toMatchObject({
      type: "runtime.error",
      summary: "Retry failed",
    });
  });
});
