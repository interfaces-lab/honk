import {
  CommandId,
  EventId,
  MessageId,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  TurnId,
  type AgentRuntimeEvent,
  type SessionTreeProjection,
} from "@multi/contracts";
import { describe, expect, it } from "vitest";

import {
  runtimeAssistantEntryIngestionKey,
  runtimeEventIngestionKey,
  runtimeSessionTreeAssistantCompleteCommand,
  runtimeSessionTreeAssistantCompleteCommands,
  runtimeToolCompletedActivityCommands,
} from "../src/runtime-orchestration-commands";

const threadId = ThreadId.make("thread:persistence");
const runtimeSessionId = RuntimeSessionId.make("runtime:persistence");
const turnId = TurnId.make("turn:persistence");
const createdAt = "2026-06-08T12:00:00.000Z";

function sessionTree(
  entries: SessionTreeProjection["entries"],
): SessionTreeProjection {
  return {
    threadId,
    runtimeSessionId,
    entries,
    leafEntryId: null,
    nodes: [],
  };
}

describe("runtime orchestration commands", () => {
  it("builds assistant complete commands from session tree sidecar ancestry", () => {
    const tree = sessionTree([
      {
        id: RuntimeItemId.make("runtime:user"),
        threadEntryId: ThreadEntryId.make("thread-entry:user"),
        parentId: null,
        parentThreadEntryId: null,
        kind: "message",
        role: "user",
        clientMessageId: MessageId.make("client:send-1"),
        turnId,
        text: "Hello",
        createdAt,
        rawEntry: { type: "message" },
      },
      {
        id: RuntimeItemId.make("runtime:assistant"),
        threadEntryId: ThreadEntryId.make("thread-entry:assistant"),
        parentId: RuntimeItemId.make("runtime:user"),
        parentThreadEntryId: ThreadEntryId.make("thread-entry:user"),
        kind: "message",
        role: "assistant",
        turnId,
        text: "Hi there",
        createdAt: "2026-06-08T12:00:01.000Z",
        rawEntry: { type: "message" },
      },
    ]);

    const commands = runtimeSessionTreeAssistantCompleteCommands({ tree });
    expect(commands).toEqual([
      {
        type: "thread.message.assistant.complete",
        commandId: CommandId.make(
          "runtime-assistant:thread:persistence:runtime:persistence:runtime:assistant",
        ),
        threadId,
        messageId: MessageId.make("runtime:runtime:persistence:runtime:assistant"),
        text: "Hi there",
        turnId,
        parentEntryId: ThreadEntryId.make("thread-entry:user"),
        createdAt: "2026-06-08T12:00:01.000Z",
      },
    ]);
    expect(runtimeAssistantEntryIngestionKey(tree, tree.entries[1]!)).toBe(
      "thread:persistence:runtime:persistence:runtime:assistant",
    );
  });

  it("builds tool completed activity commands", () => {
    const event: AgentRuntimeEvent = {
      id: EventId.make("runtime-event:tool"),
      agentRuntime: "pi",
      threadId,
      runtimeSessionId,
      turnId,
      type: "tool.completed",
      summary: "Ran shell",
      createdAt,
      data: {
        toolName: "shell",
        toolCallId: "toolu-1",
        isError: false,
        result: { output: "ok" },
      },
    };

    expect(runtimeEventIngestionKey(event)).toBe(
      "thread:persistence:runtime:persistence:runtime-event:tool",
    );
    expect(runtimeToolCompletedActivityCommands(event)).toEqual([
      {
        type: "thread.activity.append",
        commandId: CommandId.make(
          "runtime-tool:thread:persistence:runtime:persistence:runtime-activity:runtime-event:tool",
        ),
        threadId,
        activity: {
          id: EventId.make("runtime-activity:runtime-event:tool"),
          tone: "tool",
          kind: "tool.completed",
          summary: "Ran shell",
          payload: {
            itemId: "toolu-1",
            status: "completed",
            title: "shell",
            detail: "Ran shell",
            data: {
              toolCallId: "toolu-1",
              toolName: "shell",
              isError: false,
              result: { output: "ok" },
            },
          },
          turnId,
          createdAt,
        },
        createdAt,
      },
    ]);
  });
});
