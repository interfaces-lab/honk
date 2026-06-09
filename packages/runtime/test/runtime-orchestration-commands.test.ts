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
  runtimeContextWindowActivityCommands,
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

  it("builds context window activity commands from usage snapshots", () => {
    const snapshot = {
      usedTokens: 60_000,
      maxTokens: 200_000,
      categories: [
        { id: "system_prompt", label: "System prompt", tokens: 850 },
        { id: "conversation", label: "Conversation", tokens: 59_150 },
      ],
      inputTokens: 50_000,
      cachedInputTokens: 8_000,
      outputTokens: 1_500,
      toolUses: 2,
      compactsAutomatically: true,
    };
    const event: AgentRuntimeEvent = {
      id: EventId.make("runtime-event:context-window"),
      agentRuntime: "pi",
      threadId,
      runtimeSessionId,
      turnId,
      type: "context-window.updated",
      summary: "Context usage updated",
      createdAt,
      data: snapshot,
    };

    expect(runtimeContextWindowActivityCommands(event)).toEqual([
      {
        type: "thread.activity.append",
        commandId: CommandId.make(
          "runtime-context-window:thread:persistence:runtime:persistence:runtime-event:context-window",
        ),
        threadId,
        activity: {
          id: EventId.make("runtime-activity:runtime-event:context-window"),
          tone: "info",
          kind: "context-window.updated",
          summary: "Context usage updated",
          payload: snapshot,
          turnId,
          createdAt,
        },
        createdAt,
      },
    ]);
  });

  it("ignores context window events with malformed snapshots", () => {
    const baseEvent: AgentRuntimeEvent = {
      id: EventId.make("runtime-event:context-window-bad"),
      agentRuntime: "pi",
      threadId,
      runtimeSessionId,
      type: "context-window.updated",
      createdAt,
      data: { usedTokens: -5 },
    };

    expect(runtimeContextWindowActivityCommands(baseEvent)).toEqual([]);
    expect(
      runtimeContextWindowActivityCommands({ ...baseEvent, data: undefined }),
    ).toEqual([]);
    expect(
      runtimeContextWindowActivityCommands({
        ...baseEvent,
        type: "tool.completed",
        data: { usedTokens: 100 },
      }),
    ).toEqual([]);
  });
});
