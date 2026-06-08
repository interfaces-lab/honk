import {
  MessageId,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  TurnId,
  type RuntimeDisplayTimelineProjection,
} from "@multi/contracts";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../../../types";
import {
  materializeTimelineEntriesFromRuntimeDisplayTimeline,
  runtimeDisplayTimelineHasResponseItem,
  runtimeDisplayTimelineRenderableUserMessageIds,
  shouldUseRuntimeDisplayTimelineEntries,
} from "./runtime-display-timeline";

const threadId = ThreadId.make("thread:runtime-display-materialize");
const runtimeSessionId = RuntimeSessionId.make("runtime:runtime-display-materialize");
const turnId = TurnId.make("turn:runtime-display-materialize");
const createdAt = "2026-06-05T20:30:00.000Z";

describe("runtime display timeline materialization", () => {
  it("does not treat user-only runtime startup timelines as acknowledged responses", () => {
    expect(
      runtimeDisplayTimelineHasResponseItem({
        threadId,
        runtimeSessionId,
        items: [
          {
            id: "message:runtime-user",
            kind: "message",
            source: "live-event",
            orderKey: `${createdAt}:message:runtime-user`,
            createdAt,
            role: "user",
            clientMessageId: MessageId.make("message:runtime-user"),
            eventIds: [],
            streaming: false,
            text: "Commit and push",
          },
        ],
      }),
    ).toBe(false);
  });

  it("does not treat blank assistant placeholders as acknowledged responses", () => {
    expect(
      runtimeDisplayTimelineHasResponseItem({
        threadId,
        runtimeSessionId,
        items: [
          {
            id: "message:runtime-assistant",
            kind: "message",
            source: "live-event",
            orderKey: `${createdAt}:message:runtime-assistant`,
            createdAt,
            role: "assistant",
            eventIds: [],
            streaming: true,
          },
        ],
      }),
    ).toBe(false);
  });

  it("does not treat blank runtime user echoes as renderable user rows", () => {
    const clientMessageId = MessageId.make("message:pending-user");
    expect(
      runtimeDisplayTimelineRenderableUserMessageIds({
        threadId,
        runtimeSessionId,
        items: [
          {
            id: "message:pending-user",
            kind: "message",
            source: "live-event",
            orderKey: `${createdAt}:message:pending-user`,
            createdAt,
            role: "user",
            clientMessageId,
            eventIds: [],
            streaming: false,
          },
        ],
      }),
    ).toEqual(new Set());
  });

  it("treats text runtime user echoes as renderable user rows", () => {
    const clientMessageId = MessageId.make("message:pending-user");
    expect(
      runtimeDisplayTimelineRenderableUserMessageIds({
        threadId,
        runtimeSessionId,
        items: [
          {
            id: "message:pending-user",
            kind: "message",
            source: "live-event",
            orderKey: `${createdAt}:message:pending-user`,
            createdAt,
            role: "user",
            clientMessageId,
            text: "Commit and push",
            eventIds: [],
            streaming: false,
          },
        ],
      }),
    ).toEqual(new Set([clientMessageId]));
  });

  it("treats materialized runtime response rows as acknowledged responses", () => {
    expect(
      runtimeDisplayTimelineHasResponseItem({
        threadId,
        runtimeSessionId,
        items: [
          {
            id: "tool:runtime",
            kind: "tool",
            orderKey: `${createdAt}:tool:runtime`,
            createdAt,
            toolCallId: "toolu-runtime",
            toolName: "shell",
            status: "running",
            eventIds: [],
            display: {
              kind: "shell",
              command: "git status --short",
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it("does not let an empty runtime timeline replace committed chat rows", () => {
    expect(
      shouldUseRuntimeDisplayTimelineEntries({
        runtimeEntries: [],
        committedEntries: [
          {
            id: "message:committed-assistant",
            kind: "message",
            createdAt,
            message: {
              id: MessageId.make("message:committed-assistant"),
              role: "assistant",
              text: "Committed response",
              createdAt,
              streaming: false,
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it("does not let user-only runtime startup rows replace committed chat rows", () => {
    expect(
      shouldUseRuntimeDisplayTimelineEntries({
        runtimeEntries: [
          {
            id: "message:runtime-user",
            kind: "message",
            createdAt,
            message: {
              id: MessageId.make("message:runtime-user"),
              role: "user",
              text: "Commit and push",
              createdAt,
              streaming: false,
            },
          },
        ],
        committedEntries: [
          {
            id: "message:committed-assistant",
            kind: "message",
            createdAt,
            message: {
              id: MessageId.make("message:committed-assistant"),
              role: "assistant",
              text: "Committed response",
              createdAt,
              streaming: false,
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it("does not let user-only runtime startup rows replace pending user rows", () => {
    expect(
      shouldUseRuntimeDisplayTimelineEntries({
        runtimeEntries: [
          {
            id: "message:runtime-user",
            kind: "message",
            createdAt,
            message: {
              id: MessageId.make("message:runtime-user"),
              role: "user",
              text: "please reply ok",
              createdAt,
              streaming: false,
            },
          },
        ],
        committedEntries: [
          {
            id: "pending-message:runtime-user",
            kind: "message",
            createdAt,
            message: {
              id: MessageId.make("message:runtime-user"),
              role: "user",
              text: "please reply ok",
              createdAt,
              streaming: false,
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it("uses runtime entries once they contain a rendered response row", () => {
    expect(
      shouldUseRuntimeDisplayTimelineEntries({
        runtimeEntries: [
          {
            id: "message:runtime-user",
            kind: "message",
            createdAt,
            message: {
              id: MessageId.make("message:runtime-user"),
              role: "user",
              text: "Commit and push",
              createdAt,
              streaming: false,
            },
          },
          {
            id: "tool:runtime",
            kind: "runtime-tool",
            createdAt,
            tool: {
              id: "tool:runtime",
              kind: "tool",
              orderKey: `${createdAt}:tool:runtime`,
              createdAt,
              toolCallId: "toolu-runtime",
              toolName: "shell",
              status: "running",
              eventIds: [],
              display: {
                kind: "shell",
                command: "git status --short",
              },
            },
          },
        ],
        committedEntries: [
          {
            id: "message:committed-assistant",
            kind: "message",
            createdAt,
            message: {
              id: MessageId.make("message:committed-assistant"),
              role: "assistant",
              text: "Committed response",
              createdAt,
              streaming: false,
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it("materializes runtime display items without activity reconstruction", () => {
    const userMessageId = MessageId.make("message:runtime-user");
    const userMessage = {
      id: userMessageId,
      role: "user",
      text: "Commit and push",
      turnId,
      createdAt,
      completedAt: createdAt,
      streaming: false,
    } satisfies ChatMessage;
    const timeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "message:runtime:user",
          kind: "message",
          source: "session-entry",
          orderKey: `${createdAt}:message:runtime:user`,
          createdAt,
          entryId: RuntimeItemId.make("runtime:user"),
          threadEntryId: ThreadEntryId.make("thread-entry:user"),
          parentEntryId: null,
          parentThreadEntryId: null,
          role: "user",
          clientMessageId: userMessageId,
          eventIds: [],
          streaming: false,
          text: "Commit and push",
        },
        {
          id: "custom-message:runtime:custom",
          kind: "custom-message",
          orderKey: `${createdAt}:custom-message:runtime:custom`,
          createdAt,
          entryId: RuntimeItemId.make("runtime:custom"),
          threadEntryId: ThreadEntryId.make("thread-entry:custom"),
          parentEntryId: RuntimeItemId.make("runtime:user"),
          parentThreadEntryId: ThreadEntryId.make("thread-entry:user"),
          customType: "git-agent-action",
          content: "Queued branch handoff",
          details: { action: "commit-push" },
          display: true,
          text: "Queued branch handoff",
        },
        {
          id: "tool:toolu-1",
          kind: "tool",
          orderKey: `${createdAt}:tool:toolu-1`,
          createdAt,
          toolCallId: "toolu-1",
          toolName: "shell",
          turnId,
          status: "completed",
          eventIds: [],
          args: { command: "git status --short" },
          argsComplete: true,
          executionStarted: true,
          isPartial: false,
          isError: false,
          result: { content: [{ type: "text", text: "M file.ts" }] },
          summary: "Completed shell",
          display: {
            kind: "shell",
            command: "git status --short",
            output: "M file.ts",
          },
        },
        {
          id: "extension-ui:request-1",
          kind: "extension-ui-request",
          orderKey: `${createdAt}:extension-ui:request-1`,
          createdAt,
          requestId: "request-1",
          requestKind: "input",
          status: "pending",
          threadId,
          runtimeSessionId,
          eventIds: [],
          title: "Run command?",
          message: "Allow git status?",
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = materializeTimelineEntriesFromRuntimeDisplayTimeline({
      timeline,
      messages: [userMessage],
      proposedPlans: [],
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "message:message:runtime-user",
        kind: "message",
        message: userMessage,
      }),
      expect.objectContaining({
        id: "custom-message:runtime:custom",
        kind: "custom-message",
        customMessage: expect.objectContaining({
          customType: "git-agent-action",
          content: "Queued branch handoff",
        }),
      }),
      expect.objectContaining({
        id: "tool:toolu-1",
        kind: "runtime-tool",
        tool: expect.objectContaining({
          toolCallId: "toolu-1",
          toolName: "shell",
          status: "completed",
          args: { command: "git status --short" },
          result: { content: [{ type: "text", text: "M file.ts" }] },
        }),
      }),
      expect.objectContaining({
        id: "extension-ui:request-1",
        kind: "runtime-extension-ui-request",
        request: expect.objectContaining({
          requestId: "request-1",
          title: "Run command?",
          message: "Allow git status?",
          status: "pending",
        }),
      }),
    ]);
  });

  it("does not infer a command from generic tool details", () => {
    const timeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "tool:toolu-output-only",
          kind: "tool",
          orderKey: `${createdAt}:tool:toolu-output-only`,
          createdAt,
          toolCallId: "toolu-output-only",
          toolName: "shell",
          status: "completed",
          eventIds: [],
          details: "M file.ts",
          result: { content: [{ type: "text", text: "M file.ts" }] },
          summary: "Completed shell",
          display: {
            kind: "unknown",
            toolName: "shell",
            output: "M file.ts",
          },
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = materializeTimelineEntriesFromRuntimeDisplayTimeline({
      timeline,
      messages: [],
      proposedPlans: [],
    });

    expect(entries).toEqual([
      expect.objectContaining({
        kind: "runtime-tool",
        tool: expect.objectContaining({
          id: "tool:toolu-output-only",
          result: { content: [{ type: "text", text: "M file.ts" }] },
        }),
      }),
    ]);
    expect((entries[0] as Extract<(typeof entries)[number], { kind: "runtime-tool" }>).tool.args).toBe(
      undefined,
    );
  });

  it("uses client message identity for pending runtime user messages", () => {
    const clientMessageId = MessageId.make("message:pending-user");
    const pendingMessage = {
      id: clientMessageId,
      role: "user",
      text: "Commit and push",
      turnId,
      createdAt,
      completedAt: createdAt,
      streaming: false,
    } satisfies ChatMessage;
    const timeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: `message:${turnId}:user`,
          kind: "message",
          source: "live-event",
          orderKey: `${createdAt}:message:${turnId}:user`,
          createdAt,
          role: "user",
          turnId,
          clientMessageId,
          eventIds: [],
          streaming: false,
          text: "Commit and push",
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = materializeTimelineEntriesFromRuntimeDisplayTimeline({
      timeline,
      messages: [pendingMessage],
      proposedPlans: [],
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "message:message:pending-user",
        kind: "message",
        message: pendingMessage,
      }),
    ]);
  });

  it("does not materialize empty runtime message lifecycle placeholders", () => {
    const timeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: `message:${turnId}:assistant`,
          kind: "message",
          source: "live-event",
          orderKey: `${createdAt}:message:${turnId}:assistant`,
          createdAt,
          role: "assistant",
          turnId,
          eventIds: [],
          streaming: true,
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    expect(
      materializeTimelineEntriesFromRuntimeDisplayTimeline({
        timeline,
        messages: [],
        proposedPlans: [],
      }),
    ).toEqual([]);
  });

  it("keeps attachment-only existing runtime messages visible", () => {
    const clientMessageId = MessageId.make("message:attachment-only");
    const attachmentMessage = {
      id: clientMessageId,
      role: "user",
      text: "",
      attachments: [
        {
          id: "attachment:runtime-display",
          type: "image",
          name: "screenshot.png",
          mimeType: "image/png",
          sizeBytes: 128,
        },
      ],
      turnId,
      createdAt,
      completedAt: createdAt,
      streaming: false,
    } satisfies ChatMessage;
    const timeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: `message:${turnId}:user`,
          kind: "message",
          source: "live-event",
          orderKey: `${createdAt}:message:${turnId}:user`,
          createdAt,
          role: "user",
          turnId,
          clientMessageId,
          eventIds: [],
          streaming: false,
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    expect(
      materializeTimelineEntriesFromRuntimeDisplayTimeline({
        timeline,
        messages: [attachmentMessage],
        proposedPlans: [],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "message:message:attachment-only",
        kind: "message",
        message: attachmentMessage,
      }),
    ]);
  });

  it("materializes runtime thinking separately from assistant text", () => {
    const timeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: `message:${turnId}:assistant`,
          kind: "message",
          source: "live-event",
          orderKey: `${createdAt}:message:${turnId}:assistant`,
          createdAt,
          role: "assistant",
          turnId,
          eventIds: [],
          streaming: true,
          thinking: "Inspecting repo state",
        },
        {
          id: "message:runtime:assistant-committed",
          kind: "message",
          source: "session-entry",
          orderKey: `${createdAt}:message:runtime:assistant-committed`,
          createdAt,
          entryId: RuntimeItemId.make("runtime:assistant-committed"),
          threadEntryId: ThreadEntryId.make("thread-entry:assistant-committed"),
          parentEntryId: null,
          parentThreadEntryId: null,
          role: "assistant",
          turnId,
          eventIds: [],
          streaming: false,
          thinking: "Done inspecting",
          text: "Ready.",
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = materializeTimelineEntriesFromRuntimeDisplayTimeline({
      timeline,
      messages: [],
      proposedPlans: [],
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: `message:${turnId}:assistant:thinking`,
        kind: "runtime-thinking",
        message: expect.objectContaining({
          thinking: "Inspecting repo state",
          streaming: true,
        }),
      }),
      expect.objectContaining({
        id: "message:runtime:assistant-committed:thinking",
        kind: "runtime-thinking",
        message: expect.objectContaining({
          thinking: "Done inspecting",
          streaming: false,
        }),
      }),
      expect.objectContaining({
        id: "message:runtime:runtime-display-materialize:runtime:assistant-committed",
        kind: "message",
        message: expect.objectContaining({
          role: "assistant",
          text: "Ready.",
        }),
      }),
    ]);
  });
});
