import {
  MessageId,
  RuntimeSessionId,
  ThreadId,
  type RuntimeDisplayTimelineProjection,
} from "@multi/contracts";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../../../types";
import { createPendingTimelineRow } from "./pending-timeline-rows";
import { buildChatDisplayTimeline } from "./chat-display-timeline";
import { deriveMessagesTimelineRows } from "../timeline/timeline-rows";

const threadId = ThreadId.make("thread:chat-display");
const runtimeSessionId = RuntimeSessionId.make("runtime:chat-display");
const createdAt = "2026-06-06T20:58:00.000Z";

function userMessage(id: string | MessageId, text = "Do the thing"): ChatMessage {
  return {
    id: typeof id === "string" ? MessageId.make(id) : id,
    role: "user",
    text,
    createdAt,
    streaming: false,
  };
}

function assistantMessage(id: string, text = "Done."): ChatMessage {
  return {
    id: MessageId.make(id),
    role: "assistant",
    text,
    createdAt,
    streaming: false,
  };
}

function buildTimeline(input: {
  messages?: readonly ChatMessage[] | undefined;
  pendingMessageId?: MessageId | undefined;
  runtimeTimeline?: RuntimeDisplayTimelineProjection | null | undefined;
  runtimeDisplayRegressedToUserOnly?: boolean | undefined;
}) {
  const messages = input.messages ?? [];
  return buildChatDisplayTimeline({
    visibleChatTimelineRows: messages.map((message) => ({
      id: `row:${message.id}`,
      kind: "message",
      messageId: message.id,
      entryId: null,
      orderKey: `${message.createdAt}:row:${message.id}`,
      turnId: null,
      createdAt: message.createdAt,
    })),
    timelineMessages: messages,
    proposedPlans: [],
    threadActivities: [],
    timelineWorkLogEntries: [],
    activeRunningTurnId: null,
    transientPendingTimelineRows: input.pendingMessageId
      ? [
          createPendingTimelineRow({
            messageId: input.pendingMessageId,
            text: "Do the thing",
            createdAt,
            parentEntryId: null,
          }),
        ]
      : [],
    activeRuntimeDisplayTimeline: input.runtimeTimeline ?? null,
    runtimeDisplayRegressedToUserOnly: input.runtimeDisplayRegressedToUserOnly ?? false,
  });
}

describe("buildChatDisplayTimeline", () => {
  it("uses committed entries when runtime display regresses to user-only", () => {
    const committedAssistant = assistantMessage("message:committed-assistant");
    const runtimeTimeline = {
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
          text: "Do the thing",
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    expect(
      buildTimeline({
        messages: [committedAssistant],
        runtimeTimeline,
        runtimeDisplayRegressedToUserOnly: true,
      }),
    ).toEqual([
      expect.objectContaining({
        id: "message:message:committed-assistant",
        kind: "message",
        message: committedAssistant,
      }),
    ]);
  });

  it("uses runtime entries once runtime display contains a response", () => {
    const committedAssistant = assistantMessage("message:committed-assistant");
    const runtimeTimeline = {
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
    } satisfies RuntimeDisplayTimelineProjection;

    expect(
      buildTimeline({
        messages: [committedAssistant],
        runtimeTimeline,
      }),
    ).toEqual([
      expect.objectContaining({
        id: "tool:runtime",
        kind: "runtime-tool",
        tool: expect.objectContaining({ toolCallId: "toolu-runtime" }),
      }),
    ]);
  });

  it("keeps pending user rows visible while runtime display has no response", () => {
    const pendingMessageId = MessageId.make("message:pending-user");
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [],
    } satisfies RuntimeDisplayTimelineProjection;

    expect(
      buildTimeline({
        pendingMessageId,
        runtimeTimeline,
      }),
    ).toEqual([
      expect.objectContaining({
        id: "message:message:pending-user",
        kind: "message",
        message: expect.objectContaining({ id: pendingMessageId }),
      }),
    ]);
  });

  it("keeps committed user rows visible when runtime response does not include them", () => {
    const committedUser = userMessage("message:committed-user");
    const runtimeTimeline = {
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
    } satisfies RuntimeDisplayTimelineProjection;

    expect(
      buildTimeline({
        messages: [committedUser],
        runtimeTimeline,
      }).map((entry) => entry.id),
    ).toEqual(["tool:runtime", "message:message:committed-user"]);
  });

  it("replays a full runtime turn without duplicate user rows and with grouped runtime work", () => {
    const clientMessageId = MessageId.make("message:golden-user");
    const pendingMessage = userMessage(clientMessageId, "Inspect and fix");
    const timeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "message:golden-user-runtime",
          kind: "message",
          source: "live-event",
          orderKey: `${createdAt}:message:golden-user-runtime`,
          createdAt,
          role: "user",
          clientMessageId,
          eventIds: [],
          streaming: false,
          text: "Inspect and fix",
        },
        {
          id: "message:golden-assistant",
          kind: "message",
          source: "live-event",
          orderKey: `${createdAt}:message:golden-assistant`,
          createdAt: "2026-06-06T20:58:01.000Z",
          role: "assistant",
          eventIds: [],
          streaming: true,
          thinking: "Inspecting project state",
          text: "I am checking the files.",
        },
        {
          id: "tool:golden-shell",
          kind: "tool",
          orderKey: `${createdAt}:tool:golden-shell`,
          createdAt: "2026-06-06T20:58:02.000Z",
          toolCallId: "toolu-golden-shell",
          toolName: "shell",
          status: "completed",
          eventIds: [],
          display: {
            kind: "shell",
            command: "git status --short",
            output: "M file.ts",
          },
        },
        {
          id: "tool:golden-subagent",
          kind: "tool",
          orderKey: `${createdAt}:tool:golden-subagent`,
          createdAt: "2026-06-06T20:58:03.000Z",
          toolCallId: "toolu-golden-subagent",
          toolName: "subagent",
          status: "running",
          eventIds: [],
          display: {
            kind: "subagent",
            mode: "single",
            agentScope: "project",
            projectAgentsDir: null,
            runs: [
              {
                subagentThreadId: "thread:subagent-golden",
                agentId: "agent:subagent-golden",
                nickname: "Reviewer",
                role: "general-purpose",
                model: "composer-2.5",
                prompt: "Review the change",
                state: "running",
                finalText: null,
                errorMessage: null,
              },
            ],
            activities: [
              {
                id: "subagent-activity:started",
                kind: "subagent.thread.started",
                tone: "tool",
                summary: "Reviewer started",
                sequence: 1,
                createdAt: "2026-06-06T20:58:03.000Z",
                payload: {
                  subagentThreadId: "thread:subagent-golden",
                  parentThreadId: String(threadId),
                  parentItemId: "toolu-golden-subagent",
                  agentId: "agent:subagent-golden",
                  nickname: "Reviewer",
                  role: "general-purpose",
                  model: "composer-2.5",
                  prompt: "Review the change",
                  state: "running",
                  itemType: null,
                  itemId: null,
                  status: null,
                  title: null,
                  detail: null,
                  data: null,
                },
              },
            ],
          },
        },
        {
          id: "extension-ui:golden",
          kind: "extension-ui-request",
          orderKey: `${createdAt}:extension-ui:golden`,
          createdAt: "2026-06-06T20:58:04.000Z",
          requestId: "request-golden",
          requestKind: "confirm",
          status: "pending",
          threadId,
          runtimeSessionId,
          eventIds: [],
          title: "Allow command?",
          message: "Run git status?",
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = buildChatDisplayTimeline({
      visibleChatTimelineRows: [],
      timelineMessages: [pendingMessage],
      proposedPlans: [],
      threadActivities: [],
      timelineWorkLogEntries: [],
      activeRunningTurnId: null,
      transientPendingTimelineRows: [
        createPendingTimelineRow({
          messageId: clientMessageId,
          text: "Inspect and fix",
          createdAt,
          parentEntryId: null,
        }),
      ],
      activeRuntimeDisplayTimeline: timeline,
      runtimeDisplayRegressedToUserOnly: false,
    });
    const rows = deriveMessagesTimelineRows({
      timelineEntries: entries,
      isWorking: true,
      activeTurnStartedAt: createdAt,
      editableUserMessageIds: new Set(),
    });

    expect(entries.filter((entry) => entry.kind === "message" && entry.message.role === "user")).toHaveLength(1);
    expect(rows.map((row) => row.id)).toEqual([
      "message:message:golden-user",
      "message:golden-assistant:thinking",
      "message:message:golden-assistant",
      "tool:golden-shell",
      "extension-ui:golden",
      "working-indicator-row",
    ]);
    expect(rows[3]).toEqual(
      expect.objectContaining({
        kind: "work",
        isRunning: true,
        steps: [
          expect.objectContaining({
            kind: "runtime-tool",
            tool: expect.objectContaining({ toolCallId: "toolu-golden-shell" }),
          }),
          expect.objectContaining({
            kind: "runtime-tool",
            tool: expect.objectContaining({ toolCallId: "toolu-golden-subagent" }),
          }),
        ],
      }),
    );
    expect(rows[4]).toEqual(
      expect.objectContaining({
        kind: "runtime-extension-ui-request",
        request: expect.objectContaining({ requestId: "request-golden" }),
      }),
    );
  });
});
