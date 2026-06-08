import {
  MessageId,
  RuntimeSessionId,
  ThreadId,
  type RuntimeDisplayTimelineProjection,
} from "@multi/contracts";
import { describe, expect, it } from "vitest";

import type { WorkLogEntry } from "../../../session-logic";
import type { ChatMessage, ThreadSendIntent } from "../../../types";
import { timelineMessageEntryId } from "./timeline-entry-ids";
import { projectThreadTimeline } from "./thread-timeline-projector";

const threadId = ThreadId.make("thread:timeline-projector");
const runtimeSessionId = RuntimeSessionId.make("runtime:timeline-projector");
const userMessageId = MessageId.make("message:timeline-projector:user");
const pendingSendMessageId = MessageId.make("message:timeline-projector:pending");
const userCreatedAt = "2026-06-05T16:00:00.000Z";
const pendingSendCreatedAt = "2026-06-05T16:00:01.500Z";
const turnStartedAt = "2026-06-05T16:00:01.000Z";

const userMessage = {
  id: userMessageId,
  role: "user",
  text: "Start",
  createdAt: userCreatedAt,
  streaming: false,
} satisfies ChatMessage;

const pendingSendIntent = {
  clientMessageId: pendingSendMessageId,
  parentEntryId: null,
  text: "Follow up",
  createdAt: pendingSendCreatedAt,
} satisfies ThreadSendIntent;

function project(input: Partial<Parameters<typeof projectThreadTimeline>[0]> = {}) {
  return projectThreadTimeline({
    committedMessages: [userMessage],
    proposedPlans: [],
    workLogEntries: [],
    sendIntents: [],
    activeRuntimeDisplayTimeline: null,
    isWorking: false,
    isTurnActive: false,
    activeTurnStartedAt: null,
    ...input,
  });
}

describe("projectThreadTimeline", () => {
  it("appends the waiting row while work is in flight without a status surface", () => {
    const entries = project({
      isWorking: true,
      isTurnActive: true,
      activeTurnStartedAt: turnStartedAt,
    });

    expect(entries.at(-1)).toEqual({
      id: "working-indicator-row",
      kind: "waiting",
      createdAt: turnStartedAt,
    });
  });

  it("does not append a waiting row after a running runtime tool", () => {
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "tool:timeline-projector:shell",
          kind: "tool",
          orderKey: "2026-06-05T16:00:02.000Z:tool:timeline-projector:shell",
          createdAt: "2026-06-05T16:00:02.000Z",
          toolCallId: "toolu-timeline-projector-shell",
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

    const entries = project({
      committedMessages: [],
      activeRuntimeDisplayTimeline: runtimeTimeline,
      isWorking: true,
      isTurnActive: true,
      activeTurnStartedAt: turnStartedAt,
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "tool:timeline-projector:shell",
        kind: "runtime-tool",
      }),
    ]);
  });

  it("does not append a waiting row after a running runtime subagent task", () => {
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "tool:timeline-projector:subagent",
          kind: "tool",
          orderKey: "2026-06-05T16:00:02.000Z:tool:timeline-projector:subagent",
          createdAt: "2026-06-05T16:00:02.000Z",
          toolCallId: "toolu-timeline-projector-subagent",
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
                subagentThreadId: "thread:timeline-projector:subagent",
                agentId: "agent:timeline-projector:subagent",
                nickname: "Review",
                role: "general-purpose",
                model: "gpt-5.5",
                prompt: "Review",
                state: "running",
                finalText: null,
                errorMessage: null,
              },
            ],
            activities: [],
          },
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = project({
      committedMessages: [],
      activeRuntimeDisplayTimeline: runtimeTimeline,
      isWorking: true,
      isTurnActive: true,
      activeTurnStartedAt: turnStartedAt,
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "tool:timeline-projector:subagent",
        kind: "runtime-tool",
      }),
    ]);
  });

  it("does not append a waiting row after a pending runtime extension UI request", () => {
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "extension-ui:timeline-projector:request",
          kind: "extension-ui-request",
          orderKey: "2026-06-05T16:00:02.000Z:extension-ui:timeline-projector:request",
          createdAt: "2026-06-05T16:00:02.000Z",
          requestId: "request:timeline-projector",
          requestKind: "select",
          status: "pending",
          threadId,
          runtimeSessionId,
          eventIds: [],
          title: "Allow?",
          message: "Run command?",
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = project({
      committedMessages: [],
      activeRuntimeDisplayTimeline: runtimeTimeline,
      isWorking: true,
      isTurnActive: true,
      activeTurnStartedAt: turnStartedAt,
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "extension-ui:timeline-projector:request",
        kind: "runtime-extension-ui-request",
      }),
    ]);
  });

  it("appends the waiting row after stale running work when the turn is no longer active", () => {
    const staleWorkEntry = {
      id: "work:timeline-projector:stale-running",
      label: "Stale running command",
      tone: "tool",
      status: "running",
      createdAt: "2026-06-05T16:00:02.000Z",
      itemType: "command_execution",
      artifacts: [{ type: "command", durationMs: 1_000 }],
    } satisfies WorkLogEntry;

    const entries = project({
      workLogEntries: [staleWorkEntry],
      isWorking: true,
      isTurnActive: false,
      activeTurnStartedAt: turnStartedAt,
    });

    expect(entries.at(-1)).toEqual({
      id: "working-indicator-row",
      kind: "waiting",
      createdAt: turnStartedAt,
    });
  });

  it("materializes unacknowledged send intents as message rows", () => {
    const entries = project({
      sendIntents: [pendingSendIntent],
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: timelineMessageEntryId(userMessageId),
        kind: "message",
        message: userMessage,
      }),
      expect.objectContaining({
        id: timelineMessageEntryId(pendingSendMessageId),
        kind: "message",
        message: expect.objectContaining({
          id: pendingSendMessageId,
          role: "user",
          text: "Follow up",
          createdAt: pendingSendCreatedAt,
          streaming: false,
        }),
      }),
    ]);
  });

  it("does not duplicate send intents already present in committed messages", () => {
    const committedPendingMessage = {
      id: pendingSendMessageId,
      role: "user",
      text: "Follow up",
      createdAt: pendingSendCreatedAt,
      streaming: false,
    } satisfies ChatMessage;

    const entries = project({
      committedMessages: [userMessage, committedPendingMessage],
      sendIntents: [pendingSendIntent],
    });

    const pendingEntries = entries.filter(
      (entry) => entry.kind === "message" && entry.message.id === pendingSendMessageId,
    );
    expect(pendingEntries).toHaveLength(1);
  });

  it("does not append transient send intent rows once runtime acknowledges the message", () => {
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "message:timeline-projector:pending",
          kind: "message",
          orderKey: `${pendingSendCreatedAt}:message:timeline-projector:pending`,
          createdAt: pendingSendCreatedAt,
          clientMessageId: pendingSendMessageId,
          role: "user",
          text: "Follow up",
          streaming: false,
          source: "live-event",
          eventIds: [],
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = project({
      sendIntents: [pendingSendIntent],
      runtimeAcknowledgedMessageIds: new Set([pendingSendMessageId]),
      activeRuntimeDisplayTimeline: runtimeTimeline,
      isWorking: true,
      isTurnActive: true,
      activeTurnStartedAt: turnStartedAt,
    });

    const pendingEntries = entries.filter(
      (entry) => entry.kind === "message" && entry.message.id === pendingSendMessageId,
    );
    expect(pendingEntries).toHaveLength(1);
  });
});
