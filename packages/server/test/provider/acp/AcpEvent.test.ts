import { describe, expect, it } from "vitest";

import { Effect, Queue, Ref, Stream } from "effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  handleSessionUpdate,
  initialAcpAssistantSegmentState,
  parseSessionUpdateEvent,
  type AcpParsedSessionEvent,
} from "../../../src/provider/acp/AcpEvent.ts";
import type { AcpSessionModeState } from "../../../src/provider/acp/AcpSession.ts";
import { mergeAcpToolCallState, type AcpToolCallState } from "../../../src/provider/acp/AcpTool.ts";

describe("AcpEvent", () => {
  it("projects typed ACP tool call updates into runtime events", () => {
    const created = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Terminal",
        kind: "execute",
        status: "pending",
        rawInput: {
          executable: "bun",
          args: ["run", "typecheck"],
        },
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Running checks",
            },
          },
        ],
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(created.events).toEqual([
      {
        _tag: "ToolCallUpdated",
        toolCall: {
          toolCallId: "tool-1",
          kind: "execute",
          title: "Ran command",
          status: "pending",
          command: "bun run typecheck",
          detail: "bun run typecheck",
          data: {
            toolCallId: "tool-1",
            kind: "execute",
            command: "bun run typecheck",
            rawInput: {
              executable: "bun",
              args: ["run", "typecheck"],
            },
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: "Running checks",
                },
              },
            ],
          },
        },
        rawPayload: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            title: "Terminal",
            kind: "execute",
            status: "pending",
            rawInput: {
              executable: "bun",
              args: ["run", "typecheck"],
            },
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: "Running checks",
                },
              },
            ],
          },
        },
      },
    ]);

    const updated = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: { exitCode: 0 },
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(updated.events).toHaveLength(1);
    expect(updated.events[0]?._tag).toBe("ToolCallUpdated");
    const createdEvent = created.events[0];
    const updatedEvent = updated.events[0];
    if (createdEvent?._tag === "ToolCallUpdated" && updatedEvent?._tag === "ToolCallUpdated") {
      expect(mergeAcpToolCallState(createdEvent.toolCall, updatedEvent.toolCall)).toMatchObject({
        toolCallId: "tool-1",
        status: "completed",
        title: "Ran command",
        detail: "bun run typecheck",
        command: "bun run typecheck",
      });
    }
  });

  it("trims padded current mode updates before emitting a mode change", () => {
    const result = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: " code ",
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(result.modeId).toBe("code");
    expect(result.events).toEqual([
      {
        _tag: "ModeChanged",
        modeId: "code",
      },
    ]);
  });

  it("projects typed ACP plan and content updates", () => {
    const planResult = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: " Inspect state ", priority: "high", status: "completed" },
          { content: "", priority: "medium", status: "in_progress" },
        ],
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(planResult.events).toEqual([
      {
        _tag: "PlanUpdated",
        payload: {
          plan: [
            { step: "Inspect state", status: "completed" },
            { step: "Step 2", status: "inProgress" },
          ],
        },
        rawPayload: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "plan",
            entries: [
              { content: " Inspect state ", priority: "high", status: "completed" },
              { content: "", priority: "medium", status: "in_progress" },
            ],
          },
        },
      },
    ]);

    const contentResult = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "hello from acp",
        },
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(contentResult.events).toEqual([
      {
        _tag: "ContentDelta",
        text: "hello from acp",
        rawPayload: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: "hello from acp",
            },
          },
        },
      },
    ]);
  });

  it("closes assistant content segments before tool calls and opens the next segment afterward", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<AcpParsedSessionEvent>();
        const modeStateRef = yield* Ref.make<AcpSessionModeState | undefined>(undefined);
        const toolCallsRef = yield* Ref.make(new Map<string, AcpToolCallState>());
        const assistantSegmentRef = yield* Ref.make(initialAcpAssistantSegmentState());

        yield* handleSessionUpdate({
          queue,
          modeStateRef,
          toolCallsRef,
          assistantSegmentRef,
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "before" },
            },
          } satisfies EffectAcpSchema.SessionNotification,
        });
        yield* handleSessionUpdate({
          queue,
          modeStateRef,
          toolCallsRef,
          assistantSegmentRef,
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-1",
              title: "Terminal",
              kind: "execute",
              status: "pending",
              rawInput: { command: "pnpm run typecheck" },
            },
          } satisfies EffectAcpSchema.SessionNotification,
        });
        yield* handleSessionUpdate({
          queue,
          modeStateRef,
          toolCallsRef,
          assistantSegmentRef,
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "after" },
            },
          } satisfies EffectAcpSchema.SessionNotification,
        });

        return yield* Stream.runCollect(Stream.take(Stream.fromQueue(queue), 6));
      }),
    );

    expect(Array.from(events).map((event) => event._tag)).toEqual([
      "AssistantItemStarted",
      "ContentDelta",
      "AssistantItemCompleted",
      "ToolCallUpdated",
      "AssistantItemStarted",
      "ContentDelta",
    ]);
    expect(Array.from(events)).toMatchObject([
      { itemId: "assistant:session-1:segment:0" },
      { itemId: "assistant:session-1:segment:0", text: "before" },
      { itemId: "assistant:session-1:segment:0" },
      { toolCall: { toolCallId: "tool-1", command: "pnpm run typecheck" } },
      { itemId: "assistant:session-1:segment:1" },
      { itemId: "assistant:session-1:segment:1", text: "after" },
    ]);
  });
});
