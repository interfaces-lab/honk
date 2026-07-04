import {
  MessageId,
  RuntimeSessionId,
  TurnId,
} from "@honk/shared/base-schemas";
import type { RuntimeDisplayTimelineProjection } from "@honk/shared/runtime";
import { ThreadId } from "@honk/shared/base-schemas";
import { describe, expect, it } from "vitest";

import type { WorkLogEntry } from "../../../session-logic";
import type { ChatMessage, ThreadSendIntent } from "../../../types";
import {
  timelineExtensionUiRequestEntryId,
  timelineMessageEntryId,
  timelineRuntimeThinkingFallbackEntryId,
  timelineWorkEntryId,
} from "./timeline-entry-ids";
import {
  projectThreadTimeline,
  runtimeDisplayTimelineActiveTurnId,
  runtimeDisplayTimelineHasActiveWork,
  runtimeDisplayTimelineHasResponseItem,
} from "./thread-timeline-projector";

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
      elapsedStartedAt: turnStartedAt,
    });
  });

  it("namespaces fallback work ids before row derivation", () => {
    const collidingId = timelineMessageEntryId(userMessageId);
    const workEntry = {
      id: collidingId,
      label: "Read files",
      tone: "tool",
      status: "running",
      createdAt: "2026-06-05T16:00:02.000Z",
    } satisfies WorkLogEntry;

    const entries = project({
      workLogEntries: [workEntry],
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      collidingId,
      timelineWorkEntryId(collidingId),
    ]);
  });

  it("stamps user messages with turnFailure and suppresses provider-failure assistant rows", () => {
    const turnId = TurnId.make("turn:timeline-projector:failure");
    const userWithFailure = {
      ...userMessage,
      turnId,
    } satisfies ChatMessage;
    const failures = new Map([[userMessageId, "The usage limit has been reached"]]);
    const entries = project({
      committedMessages: [
        userWithFailure,
        {
          id: MessageId.make("message:timeline-projector:assistant-failure"),
          role: "assistant",
          text: "Provider error: Codex error: overloaded",
          turnId,
          createdAt: "2026-06-05T16:00:01.000Z",
          streaming: false,
        },
      ],
      turnFailuresByUserMessageId: failures,
    });

    const messageEntries = entries.filter((entry) => entry.kind === "message");
    expect(messageEntries).toHaveLength(1);
    expect(messageEntries[0]).toMatchObject({
      kind: "message",
      message: {
        id: userMessageId,
        role: "user",
        turnFailure: "The usage limit has been reached",
      },
    });
  });

  it("appends the waiting row while a follow-up turn is active before work is visible", () => {
    const entries = project({
      committedMessages: [
        userMessage,
        {
          id: MessageId.make("message:timeline-projector:assistant"),
          role: "assistant",
          text: "Done.",
          createdAt: "2026-06-05T16:00:01.000Z",
          completedAt: "2026-06-05T16:00:01.000Z",
          streaming: false,
        },
        {
          id: pendingSendMessageId,
          role: "user",
          text: "Follow up",
          createdAt: pendingSendCreatedAt,
          streaming: false,
        },
      ],
      isWorking: false,
      isTurnActive: true,
      activeTurnStartedAt: pendingSendCreatedAt,
    });

    expect(entries.at(-1)).toEqual({
      id: "working-indicator-row",
      kind: "waiting",
      createdAt: pendingSendCreatedAt,
      elapsedStartedAt: pendingSendCreatedAt,
    });
  });

  it("does not append a waiting row after completed assistant text while only turn-active", () => {
    const assistantMessage = {
      id: MessageId.make("message:timeline-projector:assistant"),
      role: "assistant",
      text: "Done.",
      createdAt: "2026-06-05T16:00:01.000Z",
      completedAt: "2026-06-05T16:00:01.000Z",
      streaming: false,
    } satisfies ChatMessage;

    const entries = project({
      committedMessages: [userMessage, assistantMessage],
      isWorking: false,
      isTurnActive: true,
      activeTurnStartedAt: turnStartedAt,
    });

    expect(entries.at(-1)).toEqual(
      expect.objectContaining({
        kind: "message",
        message: assistantMessage,
      }),
    );
  });

  it("appends a waiting row after a running non-subagent runtime tool", () => {
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
          toolName: "bash",
          status: "running",
          eventIds: [],
          display: {
            kind: "bash",
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
        id: "tool-call:toolu-timeline-projector-shell",
        kind: "runtime-tool",
      }),
      expect.objectContaining({
        id: "working-indicator-row",
        kind: "waiting",
      }),
    ]);
  });

  it("materializes streaming runtime assistant thinking without exposing thinking text", () => {
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "message:timeline-projector:assistant-thinking",
          kind: "message",
          orderKey: "2026-06-05T16:00:02.000Z:message:timeline-projector:assistant-thinking",
          createdAt: "2026-06-05T16:00:02.000Z",
          role: "assistant",
          thinking: "Inspecting repo",
          streaming: true,
          source: "live-event",
          eventIds: [],
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = project({
      activeRuntimeDisplayTimeline: runtimeTimeline,
      isWorking: true,
      isTurnActive: true,
      activeTurnStartedAt: turnStartedAt,
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: timelineMessageEntryId(userMessageId),
        kind: "message",
      }),
      expect.objectContaining({
        id: timelineRuntimeThinkingFallbackEntryId("message:timeline-projector:assistant-thinking"),
        kind: "runtime-thinking",
        message: expect.objectContaining({
          role: "assistant",
          streaming: true,
        }),
      }),
      expect.objectContaining({
        id: "working-indicator-row",
        kind: "waiting",
      }),
    ]);
    const thinkingEntry = entries.find((entry) => entry.kind === "runtime-thinking");
    expect(thinkingEntry?.message.thinking).toBeUndefined();
    expect(runtimeDisplayTimelineHasResponseItem(runtimeTimeline)).toBe(true);
  });

  it("streams assistant response text without exposing thinking text", () => {
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "message:timeline-projector:assistant",
          kind: "message",
          orderKey: "2026-06-05T16:00:02.000Z:message:timeline-projector:assistant",
          createdAt: "2026-06-05T16:00:02.000Z",
          role: "assistant",
          text: "Working on it.",
          thinking: "Inspecting repo",
          streaming: true,
          source: "live-event",
          eventIds: [],
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
        id: timelineRuntimeThinkingFallbackEntryId("message:timeline-projector:assistant"),
        kind: "runtime-thinking",
        message: expect.objectContaining({
          role: "assistant",
          streaming: true,
        }),
      }),
      expect.objectContaining({
        id: timelineMessageEntryId(MessageId.make("message:timeline-projector:assistant")),
        kind: "message",
        message: expect.objectContaining({
          role: "assistant",
          text: "Working on it.",
          streaming: true,
        }),
      }),
    ]);
    const thinkingEntry = entries.find((entry) => entry.kind === "runtime-thinking");
    expect(thinkingEntry?.message.thinking).toBeUndefined();
    expect(runtimeDisplayTimelineHasResponseItem(runtimeTimeline)).toBe(true);
  });

  it("detects active runtime work from display timeline items", () => {
    const activeTurnId = TurnId.make("turn:timeline-projector:active");
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "tool:timeline-projector:completed",
          kind: "tool",
          orderKey: "2026-06-05T16:00:02.000Z:tool:timeline-projector:completed",
          createdAt: "2026-06-05T16:00:02.000Z",
          toolCallId: "toolu-timeline-projector-completed",
          toolName: "read",
          turnId: TurnId.make("turn:timeline-projector:completed"),
          status: "completed",
          eventIds: [],
          display: { kind: "read", path: "README.md" },
        },
        {
          id: "tool:timeline-projector:running",
          kind: "tool",
          orderKey: "2026-06-05T16:00:03.000Z:tool:timeline-projector:running",
          createdAt: "2026-06-05T16:00:03.000Z",
          toolCallId: "toolu-timeline-projector-running",
          toolName: "bash",
          turnId: activeTurnId,
          status: "running",
          eventIds: [],
          display: { kind: "bash", command: "pnpm run typecheck" },
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    expect(runtimeDisplayTimelineHasActiveWork(runtimeTimeline)).toBe(true);
    expect(runtimeDisplayTimelineActiveTurnId(runtimeTimeline)).toBe(activeTurnId);
  });

  it("does not treat a completed runtime timeline as active work", () => {
    const completedTurnId = TurnId.make("turn:timeline-projector:completed");
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "message:timeline-projector:assistant-completed",
          kind: "message",
          orderKey: "2026-06-05T16:00:02.000Z:message:timeline-projector:assistant-completed",
          createdAt: "2026-06-05T16:00:02.000Z",
          role: "assistant",
          text: "Done.",
          streaming: false,
          source: "session-entry",
          turnId: completedTurnId,
          eventIds: [],
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    expect(runtimeDisplayTimelineHasActiveWork(runtimeTimeline)).toBe(false);
    expect(runtimeDisplayTimelineActiveTurnId(runtimeTimeline)).toBe(completedTurnId);
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
        id: "tool-call:toolu-timeline-projector-subagent",
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
        id: timelineExtensionUiRequestEntryId("request:timeline-projector"),
        kind: "runtime-extension-ui-request",
      }),
    ]);
  });

  it("does not duplicate a committed extension UI row when the runtime timeline has the same request", () => {
    const requestId = "timeline-projector:request";
    const entryId = timelineExtensionUiRequestEntryId(requestId);
    const createdAt = "2026-06-05T16:00:02.000Z";
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: entryId,
          kind: "extension-ui-request",
          orderKey: `${createdAt}:${entryId}`,
          createdAt,
          requestId,
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
    const committedEntry = {
      id: entryId,
      label: "Allow?",
      tone: "info",
      status: "running",
      createdAt,
      extensionUiRequestId: requestId,
      extensionUiRequestKind: "select",
    } satisfies WorkLogEntry;

    const entries = project({
      committedMessages: [],
      workLogEntries: [committedEntry],
      activeRuntimeDisplayTimeline: runtimeTimeline,
      isWorking: true,
      isTurnActive: true,
      activeTurnStartedAt: turnStartedAt,
    });

    expect(entries.filter((entry) => entry.id === entryId)).toEqual([
      expect.objectContaining({
        id: entryId,
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
      elapsedStartedAt: turnStartedAt,
    });
  });

  it("appends a waiting row after completed runtime thinking before the first tool", () => {
    const thinkingCompletedAt = "2026-06-05T16:00:02.500Z";
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "message:timeline-projector:assistant-thinking",
          kind: "message",
          orderKey: `${thinkingCompletedAt}:message:timeline-projector:assistant-thinking`,
          createdAt: thinkingCompletedAt,
          role: "assistant",
          thinking: "Inspecting repo",
          streaming: false,
          source: "live-event",
          eventIds: [],
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = project({
      activeRuntimeDisplayTimeline: runtimeTimeline,
      isWorking: true,
      isTurnActive: true,
      activeTurnStartedAt: turnStartedAt,
    });

    expect(entries.at(-2)).toEqual(
      expect.objectContaining({
        kind: "runtime-thinking",
      }),
    );
    expect(entries.at(-1)).toEqual(
      expect.objectContaining({
        id: "working-indicator-row",
        kind: "waiting",
      }),
    );
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

  it("does not duplicate a committed followup saved with a different id than its pending send", () => {
    const committedFollowupMessage = {
      id: MessageId.make("message:timeline-projector:saved-followup"),
      role: "user",
      text: "Follow up",
      createdAt: pendingSendCreatedAt,
      streaming: false,
    } satisfies ChatMessage;

    const entries = project({
      committedMessages: [userMessage, committedFollowupMessage],
      sendIntents: [pendingSendIntent],
    });

    const followupEntries = entries.filter(
      (entry) =>
        entry.kind === "message" &&
        entry.message.role === "user" &&
        entry.message.text === "Follow up",
    );
    expect(followupEntries).toEqual([
      expect.objectContaining({
        id: timelineMessageEntryId(committedFollowupMessage.id),
        message: committedFollowupMessage,
      }),
    ]);
  });

  it("keeps running committed work entries until runtime projects the same tool", () => {
    const runningWorkEntry = {
      id: "tool:turn:timeline-projector:shell",
      label: "git status --short",
      tone: "tool",
      status: "running",
      createdAt: "2026-06-05T16:00:02.000Z",
      itemType: "command_execution",
      toolCallId: "toolu-timeline-projector-shell",
      command: "git status --short",
      artifacts: [{ type: "command", output: " M file.ts", isPartial: true }],
    } satisfies WorkLogEntry;
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "message:timeline-projector:user",
          kind: "message",
          orderKey: `${userCreatedAt}:message:timeline-projector:user`,
          createdAt: userCreatedAt,
          clientMessageId: userMessageId,
          role: "user",
          text: "Start",
          streaming: false,
          source: "live-event",
          eventIds: [],
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = project({
      workLogEntries: [runningWorkEntry],
      activeRuntimeDisplayTimeline: runtimeTimeline,
      isWorking: true,
      isTurnActive: true,
      activeTurnStartedAt: turnStartedAt,
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: timelineMessageEntryId(userMessageId),
        kind: "message",
      }),
      expect.objectContaining({
        id: "tool-call:toolu-timeline-projector-shell",
        kind: "work",
        entry: runningWorkEntry,
      }),
      expect.objectContaining({
        id: "working-indicator-row",
        kind: "waiting",
      }),
    ]);
  });

  it("drops superseded running work entries once runtime projects the same tool", () => {
    const runningWorkEntry = {
      id: "tool:turn:timeline-projector:shell",
      label: "git status --short",
      tone: "tool",
      status: "running",
      createdAt: "2026-06-05T16:00:02.000Z",
      itemType: "command_execution",
      toolCallId: "toolu-timeline-projector-shell",
      command: "git status --short",
      artifacts: [{ type: "command", output: " M file.ts", isPartial: true }],
    } satisfies WorkLogEntry;
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
          toolName: "bash",
          status: "running",
          eventIds: [],
          display: {
            kind: "bash",
            command: "git status --short",
            output: " M file.ts",
          },
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = project({
      committedMessages: [],
      workLogEntries: [runningWorkEntry],
      activeRuntimeDisplayTimeline: runtimeTimeline,
      isWorking: true,
      isTurnActive: true,
      activeTurnStartedAt: turnStartedAt,
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "tool-call:toolu-timeline-projector-shell",
        kind: "runtime-tool",
        tool: expect.objectContaining({
          toolCallId: "toolu-timeline-projector-shell",
          display: expect.objectContaining({
            kind: "bash",
            output: " M file.ts",
          }),
        }),
      }),
      expect.objectContaining({
        id: "working-indicator-row",
        kind: "waiting",
      }),
    ]);
  });

  it("prefers committed edit work entries with diff artifacts over completed runtime edit rows", () => {
    const committedEditEntry = {
      id: "tool:turn:timeline-projector:edit",
      label: "Edited packages/app/src/file.ts",
      tone: "tool",
      status: "completed",
      createdAt: "2026-06-05T16:00:02.000Z",
      itemType: "file_change",
      toolCallId: "toolu-timeline-projector-edit",
      changedFiles: ["packages/app/src/file.ts"],
      artifacts: [
        {
          type: "diff",
          format: "unified",
          source: "result",
          files: [{ path: "packages/app/src/file.ts", additions: 2, deletions: 1 }],
          unifiedDiff: "@@ -1,2 +1,3 @@\n-old\n+new\n+line\n",
        },
      ],
    } satisfies WorkLogEntry;
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "tool:timeline-projector:edit",
          kind: "tool",
          orderKey: "2026-06-05T16:00:02.000Z:tool:timeline-projector:edit",
          createdAt: "2026-06-05T16:00:02.000Z",
          toolCallId: "toolu-timeline-projector-edit",
          toolName: "edit",
          status: "completed",
          eventIds: [],
          display: {
            kind: "edit",
            path: "packages/app/src/file.ts",
          },
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = project({
      committedMessages: [],
      workLogEntries: [committedEditEntry],
      activeRuntimeDisplayTimeline: runtimeTimeline,
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "tool-call:toolu-timeline-projector-edit",
        kind: "work",
        entry: committedEditEntry,
      }),
    ]);
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

  it("does not append a send intent row when runtime renders the same user text under its own id", () => {
    const runtimeEchoCreatedAt = "2026-06-05T16:00:01.900Z";
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "message:timeline-projector:runtime-user-echo",
          kind: "message",
          orderKey: `${runtimeEchoCreatedAt}:message:timeline-projector:runtime-user-echo`,
          createdAt: runtimeEchoCreatedAt,
          role: "user",
          text: "Follow up",
          streaming: false,
          source: "live-event",
          eventIds: [],
        },
        {
          id: "message:timeline-projector:runtime-thinking",
          kind: "message",
          orderKey: "2026-06-05T16:00:02.000Z:message:timeline-projector:runtime-thinking",
          createdAt: "2026-06-05T16:00:02.000Z",
          turnId: TurnId.make("turn:timeline-projector"),
          role: "assistant",
          text: "",
          thinking: "Thinking",
          streaming: true,
          source: "live-event",
          eventIds: [],
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = project({
      sendIntents: [pendingSendIntent],
      activeRuntimeDisplayTimeline: runtimeTimeline,
      isWorking: true,
      isTurnActive: true,
      activeTurnStartedAt: turnStartedAt,
    });

    const followUpUserEntries = entries.filter(
      (entry) =>
        entry.kind === "message" &&
        entry.message.role === "user" &&
        entry.message.text === "Follow up",
    );
    expect(followUpUserEntries).toHaveLength(1);
  });

  it("does not duplicate a committed user message with attachments when runtime renders a text-only echo", () => {
    const committedMessageWithAttachments = {
      id: pendingSendMessageId,
      role: "user",
      text: "remove these two sections",
      attachments: [
        {
          type: "image",
          id: "attachment:first",
          name: "first.png",
          mimeType: "image/png",
          sizeBytes: 1,
        },
        {
          type: "image",
          id: "attachment:second",
          name: "second.png",
          mimeType: "image/png",
          sizeBytes: 1,
        },
      ],
      createdAt: pendingSendCreatedAt,
      streaming: false,
    } satisfies ChatMessage;
    const runtimeTimeline = {
      threadId,
      runtimeSessionId,
      items: [
        {
          id: "message:timeline-projector:runtime-user-echo",
          kind: "message",
          orderKey: `${pendingSendCreatedAt}:message:timeline-projector:runtime-user-echo`,
          createdAt: pendingSendCreatedAt,
          role: "user",
          text: "remove these two sections",
          streaming: false,
          source: "live-event",
          eventIds: [],
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    const entries = project({
      committedMessages: [committedMessageWithAttachments],
      activeRuntimeDisplayTimeline: runtimeTimeline,
      isWorking: true,
      isTurnActive: true,
      activeTurnStartedAt: turnStartedAt,
    });

    const userEntries = entries.filter(
      (entry) =>
        entry.kind === "message" &&
        entry.message.role === "user" &&
        entry.message.text === "remove these two sections",
    );
    expect(userEntries).toEqual([
      expect.objectContaining({
        id: timelineMessageEntryId(committedMessageWithAttachments.id),
        message: committedMessageWithAttachments,
      }),
    ]);
  });
});
