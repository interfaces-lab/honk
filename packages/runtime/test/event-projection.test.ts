import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai/base";
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
const { errorMessage: _unusedErrorMessage, ...baseAssistantMessage } = failedAssistantMessage;
const assistantMessage: AssistantMessage = {
  ...baseAssistantMessage,
  content: [],
  stopReason: "stop",
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

  it("projects provider failures without assistant text and with structured data", () => {
    const event = {
      type: "message_end",
      message: failedAssistantMessage,
    } satisfies AgentSessionEvent;

    expect(project(event)).toMatchObject({
      type: "message.completed",
      messageRole: "assistant",
      summary: "400 usage limit reached",
      data: {
        providerFailure: "400 usage limit reached",
      },
    });
    expect(project(event).text).toBeUndefined();
  });

  it("projects synthetic Cursor shell tool updates as display-only command events", () => {
    const toolCall = {
      type: "toolCall",
      id: "cursor-call-1",
      name: "bash",
      arguments: {
        command: "git status --short",
        __honkCursorSyntheticToolEvent: true,
        __honkCursorResult: {
          status: "success",
          value: {
            exitCode: 0,
            signal: "",
            stdout: "M file.ts\n",
            stderr: "",
            executionTime: 12,
          },
        },
      },
    } satisfies ToolCall;
    const partial = {
      ...assistantMessage,
      content: [toolCall],
    } satisfies AssistantMessage;
    const event = {
      type: "message_update",
      message: partial,
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall,
        partial,
      },
    } satisfies AgentSessionEvent;

    expect(project(event)).toMatchObject({
      type: "tool.completed",
      summary: "Ran command",
      data: {
        toolCallId: "cursor-call-1",
        toolName: "bash",
        args: {
          command: "git status --short",
        },
        result: {
          content: [{ type: "text", text: "M file.ts\n" }],
          details: {
            status: "success",
            exitCode: 0,
            signal: "",
            executionTime: 12,
          },
        },
        isError: false,
      },
    });
  });

  it("leaves ordinary Pi tool-call message updates as message updates", () => {
    const toolCall = {
      type: "toolCall",
      id: "toolu-1",
      name: "bash",
      arguments: {
        command: "git status --short",
      },
    } satisfies ToolCall;
    const partial = {
      ...assistantMessage,
      content: [toolCall],
    } satisfies AssistantMessage;
    const event = {
      type: "message_update",
      message: partial,
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 0,
        partial,
      },
    } satisfies AgentSessionEvent;

    expect(project(event)).toMatchObject({
      type: "message.updated",
      messageRole: "assistant",
    });
  });
});
