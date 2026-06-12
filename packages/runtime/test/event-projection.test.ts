import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { RuntimeSessionId, ThreadId } from "@honk/contracts";
import { describe, expect, it } from "vitest";

import { projectPiAgentSessionEvent } from "../src/event-projection";

const threadId = ThreadId.make("thread:event-projection");
const runtimeSessionId = RuntimeSessionId.make("runtime:event-projection");
const failedAssistantMessage: AssistantMessage = {
  role: "assistant",
  content: [],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-opus-4-8",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  },
  stopReason: "error",
  timestamp: 1781226634337,
  errorMessage: "400 usage limit reached",
};

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

  it("projects provider error assistant messages as visible text", () => {
    const event = {
      type: "message_end",
      message: failedAssistantMessage,
    } satisfies AgentSessionEvent;

    expect(project(event)).toMatchObject({
      type: "message.completed",
      messageRole: "assistant",
      text: "Provider error: 400 usage limit reached",
      summary: "Provider error: 400 usage limit reached",
    });
  });
});
