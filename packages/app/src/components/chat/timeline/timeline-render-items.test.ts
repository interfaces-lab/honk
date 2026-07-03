import {
  MessageId,
  RuntimeSessionId,
  TurnId,
} from "@honk/shared/base-schemas";
import { ThreadId } from "@honk/shared/base-schemas";
import { describe, expect, it } from "vitest";

import type { TimelineEntry, TimelineEntryId, WorkLogEntry } from "../../../session-logic";
import {
  deriveTimelineRenderItems,
  finalizeGroupAssistantMessagesForTest,
  isGroupedNarrationMessageStep,
  isPreviewableWorkGroupStep,
  isShortPlainText,
  runtimeToolHasPendingApproval,
  workEntryHasPendingApproval,
  type PendingApprovalRequestKind,
  type TimelineGroupedStep,
} from "./timeline-render-items";
import {
  countRenderableWorkGroupPreviewSteps,
  isRenderableWorkGroupPreviewStep,
  runningWorkGroupPreviewOutputStripExtraPx,
  WORK_GROUP_PREVIEW_ENTRY_PX,
  WORK_GROUP_PREVIEW_OUTPUT_STRIP_PX,
  WORK_GROUP_STEP_GAP_PX,
} from "./step-renderer";

const userId = MessageId.make("message:user");
const assistantId = MessageId.make("message:assistant");
const followUpId = MessageId.make("message:follow-up");
const userCreatedAt = "2026-06-05T16:00:00.000Z";
const assistantCreatedAt = "2026-06-05T16:00:03.000Z";
const assistantCompletedAt = "2026-06-05T16:00:08.000Z";
const followUpCreatedAt = "2026-06-05T16:00:12.000Z";

function testTimelineEntryId(value: string): TimelineEntryId {
  return value as TimelineEntryId;
}

function workEntry(
  input: Partial<WorkLogEntry> & Pick<WorkLogEntry, "id" | "createdAt">,
): WorkLogEntry {
  return {
    label: input.id,
    tone: "tool",
    status: "completed",
    ...input,
  };
}

function runtimeReadTool(input: {
  id: string;
  createdAt: string;
  status: "running" | "completed" | "error";
  path?: string;
}): Extract<TimelineEntry, { kind: "runtime-tool" }> {
  return {
    kind: "runtime-tool",
    id: testTimelineEntryId(input.id),
    createdAt: input.createdAt,
    tool: {
      id: input.id,
      kind: "tool",
      orderKey: `${input.createdAt}:${input.id}`,
      createdAt: input.createdAt,
      toolCallId: input.id,
      toolName: "read",
      status: input.status,
      eventIds: [],
      isError: input.status === "error",
      display: {
        kind: "read",
        path: input.path ?? "/repo/src/app.ts",
      },
    },
  };
}

function runtimeAwaitTool(input: {
  id: string;
  createdAt: string;
  status: "running" | "completed";
  taskId?: string;
}): Extract<TimelineEntry, { kind: "runtime-tool" }> {
  return {
    kind: "runtime-tool",
    id: testTimelineEntryId(input.id),
    createdAt: input.createdAt,
    tool: {
      id: input.id,
      kind: "tool",
      orderKey: `${input.createdAt}:${input.id}`,
      createdAt: input.createdAt,
      toolCallId: input.id,
      toolName: "await",
      status: input.status,
      eventIds: [],
      args: input.taskId ? { taskId: input.taskId } : {},
      display: {
        kind: "unknown",
        toolName: "await",
      },
    },
  };
}

function runtimeBrowserMcpTool(input: {
  id: string;
  createdAt: string;
  status: "running" | "completed";
}): Extract<TimelineEntry, { kind: "runtime-tool" }> {
  return {
    kind: "runtime-tool",
    id: testTimelineEntryId(input.id),
    createdAt: input.createdAt,
    tool: {
      id: input.id,
      kind: "tool",
      orderKey: `${input.createdAt}:${input.id}`,
      createdAt: input.createdAt,
      toolCallId: input.id,
      toolName: "browser_navigate",
      status: input.status,
      eventIds: [],
      display: {
        kind: "mcp",
        providerIdentifier: "cursor-ide-browser",
      },
    },
  };
}

function runtimeShellTool(input: {
  id: string;
  createdAt: string;
  status: "running" | "completed";
  turnId?: string;
}): Extract<TimelineEntry, { kind: "runtime-tool" }> {
  return {
    kind: "runtime-tool",
    id: testTimelineEntryId(input.id),
    createdAt: input.createdAt,
    tool: {
      id: input.id,
      kind: "tool",
      orderKey: `${input.createdAt}:${input.id}`,
      createdAt: input.createdAt,
      toolCallId: input.id,
      toolName: "bash",
      status: input.status,
      eventIds: [],
      ...(input.turnId ? { turnId: TurnId.make(input.turnId) } : {}),
      display: {
        kind: "bash",
        command: "pnpm test",
        output: input.status === "running" ? "running" : "done",
      },
    },
  };
}

function runtimeEditTool(input: {
  id: string;
  createdAt: string;
  status: "running" | "completed";
  path: string;
}): Extract<TimelineEntry, { kind: "runtime-tool" }> {
  return {
    kind: "runtime-tool",
    id: testTimelineEntryId(input.id),
    createdAt: input.createdAt,
    tool: {
      id: input.id,
      kind: "tool",
      orderKey: `${input.createdAt}:${input.id}`,
      createdAt: input.createdAt,
      toolCallId: input.id,
      toolName: "edit",
      status: input.status,
      eventIds: [],
      display: {
        kind: "edit",
        path: input.path,
        additions: 3,
        deletions: 1,
      },
    },
  };
}

function runtimeThinkingEntry(input: {
  id: string;
  createdAt: string;
  thinking: string;
  streaming?: boolean;
}): Extract<TimelineEntry, { kind: "runtime-thinking" }> {
  return {
    kind: "runtime-thinking",
    id: testTimelineEntryId(input.id),
    createdAt: input.createdAt,
    message: {
      id: input.id,
      kind: "message",
      source: "live-event",
      orderKey: `${input.createdAt}:${input.id}`,
      createdAt: input.createdAt,
      role: "assistant",
      eventIds: [],
      streaming: input.streaming ?? false,
      thinking: input.thinking,
    },
  };
}

function assistantTextEntry(input: {
  id: string;
  createdAt: string;
  text: string;
  streaming?: boolean;
  turnId?: string;
}): TimelineEntry {
  return {
    kind: "message",
    id: testTimelineEntryId(input.id),
    createdAt: input.createdAt,
    message: {
      id: MessageId.make(input.id),
      role: "assistant",
      text: input.text,
      createdAt: input.createdAt,
      streaming: input.streaming ?? false,
      ...(input.turnId ? { turnId: TurnId.make(input.turnId) } : {}),
    },
  };
}

describe("deriveTimelineRenderItems", () => {
  it("derives message duration boundaries in the main timeline order", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "message",
          id: testTimelineEntryId("message:user"),
          createdAt: userCreatedAt,
          message: {
            id: userId,
            role: "user",
            text: "Start",
            createdAt: userCreatedAt,
            streaming: false,
          },
        },
        {
          kind: "message",
          id: testTimelineEntryId("message:assistant"),
          createdAt: assistantCreatedAt,
          message: {
            id: assistantId,
            role: "assistant",
            text: "Done",
            createdAt: assistantCreatedAt,
            completedAt: assistantCompletedAt,
            streaming: false,
          },
        },
        {
          kind: "message",
          id: testTimelineEntryId("message:follow-up"),
          createdAt: followUpCreatedAt,
          message: {
            id: followUpId,
            role: "user",
            text: "Next",
            createdAt: followUpCreatedAt,
            streaming: false,
          },
        },
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set([userId]),
    });

    expect(rows.map((row) => (row.kind === "single" ? row.step : null))).toEqual([
      expect.objectContaining({
        kind: "message",
        durationStart: userCreatedAt,
        editAvailable: true,
        pairId: userId,
        messageIndex: 0,
      }),
      expect.objectContaining({
        kind: "message",
        durationStart: userCreatedAt,
        editAvailable: false,
        pairId: userId,
        messageIndex: 1,
      }),
      expect.objectContaining({
        kind: "message",
        durationStart: assistantCompletedAt,
        editAvailable: false,
        pairId: followUpId,
        messageIndex: 2,
      }),
    ]);
  });

  it("groups thinking and tool work rows into one run and precomputes group flags", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "work",
          id: testTimelineEntryId("work:thinking"),
          createdAt: "2026-06-05T16:00:01.000Z",
          entry: workEntry({
            id: "thinking",
            createdAt: "2026-06-05T16:00:01.000Z",
            completedAt: "2026-06-05T16:00:02.500Z",
            tone: "thinking",
          }),
        },
        {
          kind: "work",
          id: testTimelineEntryId("work:command"),
          createdAt: "2026-06-05T16:00:03.000Z",
          entry: workEntry({
            id: "command",
            createdAt: "2026-06-05T16:00:03.000Z",
            itemType: "command_execution",
            artifacts: [{ type: "command", durationMs: 2_000 }],
          }),
        },
        {
          kind: "work",
          id: testTimelineEntryId("work:edit"),
          createdAt: "2026-06-05T16:00:04.000Z",
          entry: workEntry({
            id: "edit",
            createdAt: "2026-06-05T16:00:04.000Z",
            requestKind: "file-change",
            artifacts: [
              {
                type: "diff",
                format: "unified",
                source: "result",
                files: [{ path: "/repo/src/app.ts", additions: 4, deletions: 1 }],
                unifiedDiff: "@@",
              },
            ],
          }),
        },
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
      projectRoot: "/repo",
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        // One ongoing run: thinking groups with the tools that follow it, so a turn's
        // steps never split into per-tool "Worked for" rows.
        id: testTimelineEntryId("work:thinking"),
        group: expect.objectContaining({
          isThinkingGroup: false,
          isCommandGroup: false,
          // Trailing group during an active turn is the loading surface: present-tense,
          // no completed duration, even though its steps are no longer executing.
          isRunning: true,
          isTailGroup: true,
          completedDurationLabel: null,
          steps: [
            expect.objectContaining({ kind: "work", id: "work:thinking" }),
            expect.objectContaining({ kind: "work", id: "work:command" }),
            expect.objectContaining({ kind: "work", id: "work:edit" }),
          ],
          summary: {
            action: "Editing",
            details: "repo/src/app.ts, ran 1 command",
            additions: 4,
            deletions: 1,
          },
        }),
      }),
    ]);
  });

  it("renders explicit waiting entries as waiting groups", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "waiting",
          id: testTimelineEntryId("working-indicator-row"),
          createdAt: "2026-06-05T16:00:00.000Z",
          elapsedStartedAt: "2026-06-05T16:00:00.000Z",
        },
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "waitingGroup",
        id: testTimelineEntryId("working-indicator-row"),
        createdAt: "2026-06-05T16:00:00.000Z",
      }),
    ]);
  });

  it("suppresses waiting entries when live thinking already renders", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeThinkingEntry({
          id: "thinking:active",
          createdAt: "2026-06-05T16:00:00.000Z",
          thinking: "Checking the branch.",
          streaming: true,
        }),
        {
          kind: "waiting",
          id: testTimelineEntryId("working-indicator-row"),
          createdAt: "2026-06-05T16:00:01.000Z",
          elapsedStartedAt: "2026-06-05T16:00:01.000Z",
        },
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: testTimelineEntryId("thinking:active"),
        group: expect.objectContaining({
          isRunning: true,
          isThinkingGroup: true,
          summary: {
            action: "Thinking",
            details: "",
          },
        }),
      }),
    ]);
  });

  it("suppresses waiting entries while a tool is still running in the tail group", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeThinkingEntry({
          id: "thinking:done",
          createdAt: "2026-06-05T16:00:00.000Z",
          thinking: "Checking git diff options.",
        }),
        runtimeReadTool({
          id: "tool:read",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "running",
        }),
        {
          kind: "waiting",
          id: testTimelineEntryId("working-indicator-row"),
          createdAt: "2026-06-05T16:00:02.000Z",
          elapsedStartedAt: "2026-06-05T16:00:02.000Z",
        },
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          isRunning: true,
          isThinkingGroup: false,
        }),
      }),
    ]);
  });

  it("suppresses waiting entries while the tail group stays the loading surface between steps", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeThinkingEntry({
          id: "thinking:done",
          createdAt: "2026-06-05T16:00:00.000Z",
          thinking: "Checking git diff options.",
        }),
        runtimeReadTool({
          id: "tool:read",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
        }),
        {
          kind: "waiting",
          id: testTimelineEntryId("working-indicator-row"),
          createdAt: "2026-06-05T16:00:02.000Z",
          elapsedStartedAt: "2026-06-05T16:00:02.000Z",
        },
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          isRunning: true,
          isTailGroup: true,
        }),
      }),
    ]);
  });

  it("keeps waiting entries when completed work is followed by a static assistant message", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeThinkingEntry({
          id: "thinking:done",
          createdAt: "2026-06-05T16:00:00.000Z",
          thinking: "Checking git diff options.",
        }),
        runtimeReadTool({
          id: "tool:read",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
        }),
        assistantTextEntry({
          id: "message:assistant",
          createdAt: "2026-06-05T16:00:02.000Z",
          text: "The diff is empty because git diff skips untracked files; the test file needs to be staged first before the comparison can show anything useful.",
        }),
        {
          kind: "waiting",
          id: testTimelineEntryId("working-indicator-row"),
          createdAt: "2026-06-05T16:00:03.000Z",
          elapsedStartedAt: "2026-06-05T16:00:03.000Z",
        },
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({ isRunning: false }),
      }),
      expect.objectContaining({
        kind: "single",
        id: testTimelineEntryId("message:assistant"),
      }),
      expect.objectContaining({
        kind: "waitingGroup",
        id: testTimelineEntryId("working-indicator-row"),
      }),
    ]);
  });

  it("groups adjacent runtime thinking and runtime tool rows without committed work entries", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "runtime-thinking",
          id: testTimelineEntryId("message:assistant:thinking"),
          createdAt: "2026-06-05T16:00:01.000Z",
          message: {
            id: "message:assistant",
            kind: "message",
            source: "live-event",
            orderKey: "2026-06-05T16:00:01.000Z:message:assistant",
            createdAt: "2026-06-05T16:00:01.000Z",
            role: "assistant",
            eventIds: [],
            streaming: true,
            thinking: "Inspecting repo",
          },
        },
        {
          kind: "runtime-tool",
          id: testTimelineEntryId("tool:toolu-runtime"),
          createdAt: "2026-06-05T16:00:02.000Z",
          tool: {
            id: "tool:toolu-runtime",
            kind: "tool",
            orderKey: "2026-06-05T16:00:02.000Z:tool:toolu-runtime",
            createdAt: "2026-06-05T16:00:02.000Z",
            toolCallId: "toolu-runtime",
            toolName: "bash",
            status: "completed",
            eventIds: [],
            args: { command: "git status --short" },
            result: { content: [{ type: "text", text: "M file.ts" }] },
            display: {
              kind: "bash",
              command: "git status --short",
              output: "M file.ts",
            },
          },
        },
        {
          kind: "runtime-tool",
          id: testTimelineEntryId("tool:toolu-runtime-2"),
          createdAt: "2026-06-05T16:00:03.000Z",
          tool: {
            id: "tool:toolu-runtime-2",
            kind: "tool",
            orderKey: "2026-06-05T16:00:03.000Z:tool:toolu-runtime-2",
            createdAt: "2026-06-05T16:00:03.000Z",
            toolCallId: "toolu-runtime-2",
            toolName: "read",
            status: "running",
            eventIds: [],
            display: {
              kind: "bash",
              command: "pnpm test",
              output: "running",
            },
          },
        },
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: testTimelineEntryId("message:assistant:thinking"),
        group: expect.objectContaining({
          entries: [],
          isRunning: true,
          isTailGroup: true,
          summary: {
            action: "Running",
            details: "",
          },
          steps: [
            expect.objectContaining({ kind: "runtime-thinking" }),
            expect.objectContaining({
              kind: "runtime-tool",
              tool: expect.objectContaining({ toolCallId: "toolu-runtime" }),
            }),
            expect.objectContaining({
              kind: "runtime-tool",
              tool: expect.objectContaining({ toolCallId: "toolu-runtime-2" }),
            }),
          ],
        }),
      }),
    ]);
  });

  it("keeps one ongoing group when a turn's steps mix committed work and runtime sources", () => {
    // A tool flips from runtime item to committed work entry as persistence catches up
    // (Commit & Push: per-command tool.completed activities land while the next command's
    // thinking still streams). The run must survive the source seam instead of closing a
    // "Worked for Ns · 1 command" group per tool.
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "work",
          id: testTimelineEntryId("tool-call:cmd-1"),
          createdAt: "2026-06-05T16:00:01.000Z",
          entry: workEntry({
            id: "cmd-1",
            createdAt: "2026-06-05T16:00:01.000Z",
            completedAt: "2026-06-05T16:00:04.000Z",
            itemType: "command_execution",
            toolCallId: "cmd-1",
          }),
        },
        {
          kind: "runtime-thinking",
          id: testTimelineEntryId("thinking:turn:turn-1:0"),
          createdAt: "2026-06-05T16:00:05.000Z",
          message: {
            id: "message:assistant-2",
            kind: "message",
            source: "live-event",
            orderKey: "2026-06-05T16:00:05.000Z:message:assistant-2",
            createdAt: "2026-06-05T16:00:05.000Z",
            role: "assistant",
            eventIds: [],
            streaming: true,
            thinking: "Checking branch state",
          },
        },
        runtimeShellTool({
          id: "tool-call:cmd-2",
          createdAt: "2026-06-05T16:00:06.000Z",
          status: "running",
        }),
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: testTimelineEntryId("tool-call:cmd-1"),
        group: expect.objectContaining({
          isRunning: true,
          isTailGroup: true,
          completedDurationLabel: null,
          summary: {
            action: "Running",
            details: "",
          },
          steps: [
            expect.objectContaining({ kind: "work", id: "tool-call:cmd-1" }),
            expect.objectContaining({ kind: "runtime-thinking" }),
            expect.objectContaining({ kind: "runtime-tool", id: "tool-call:cmd-2" }),
          ],
        }),
      }),
    ]);
  });

  it("emits runtime subagent tools as task rows outside generic tool groups", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "runtime-thinking",
          id: testTimelineEntryId("message:assistant:thinking"),
          createdAt: "2026-06-05T16:00:01.000Z",
          message: {
            id: "message:assistant",
            kind: "message",
            source: "live-event",
            orderKey: "2026-06-05T16:00:01.000Z:message:assistant",
            createdAt: "2026-06-05T16:00:01.000Z",
            role: "assistant",
            eventIds: [],
            streaming: false,
            thinking: "Delegating",
          },
        },
        {
          kind: "runtime-tool",
          id: testTimelineEntryId("tool:toolu-subagent"),
          createdAt: "2026-06-05T16:00:02.000Z",
          tool: {
            id: "tool:toolu-subagent",
            kind: "tool",
            orderKey: "2026-06-05T16:00:02.000Z:tool:toolu-subagent",
            createdAt: "2026-06-05T16:00:02.000Z",
            toolCallId: "toolu-subagent",
            toolName: "subagent",
            status: "running",
            eventIds: [],
            display: {
              kind: "subagent",
              mode: "single",
              runs: [
                {
                  subagentThreadId: "thread:child",
                  agentId: "agent:child",
                  nickname: "Review",
                  role: "general-purpose",
                  model: "gpt-5.5",
                  prompt: "Review the row",
                  state: "running",
                  finalText: null,
                  errorMessage: null,
                },
              ],
              activities: [],
            },
          },
        },
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: testTimelineEntryId("message:assistant:thinking"),
        group: expect.objectContaining({
          isThinkingGroup: true,
          summary: { action: "Thought", details: "briefly" },
        }),
      }),
      expect.objectContaining({
        kind: "single",
        id: testTimelineEntryId("tool:toolu-subagent"),
        step: expect.objectContaining({
          kind: "runtime-task",
          tool: expect.objectContaining({ toolCallId: "toolu-subagent" }),
        }),
      }),
    ]);
  });

  it("closes stale work previews when the timeline is busy but the turn is no longer running", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "work",
          id: testTimelineEntryId("work:stale-running-command"),
          createdAt: "2026-06-05T16:00:03.000Z",
          entry: workEntry({
            id: "stale-running-command",
            createdAt: "2026-06-05T16:00:03.000Z",
            status: "running",
            itemType: "command_execution",
            artifacts: [{ type: "command", durationMs: 1_000 }],
          }),
        },
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: testTimelineEntryId("work:stale-running-command"),
        group: expect.objectContaining({
          completedDurationLabel: "1 second",
          isRunning: false,
          summary: {
            action: "Ran",
            details: "1 command",
          },
        }),
      }),
    ]);
  });

  it("keeps runtime work as the only active status surface while the turn is active", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "runtime-thinking",
          id: testTimelineEntryId("message:stale-running-assistant:thinking"),
          createdAt: "2026-06-05T16:00:01.000Z",
          message: {
            id: "message:stale-running-assistant",
            kind: "message",
            source: "live-event",
            orderKey: "2026-06-05T16:00:01.000Z:message:stale-running-assistant",
            createdAt: "2026-06-05T16:00:01.000Z",
            role: "assistant",
            eventIds: [],
            streaming: true,
            thinking: "Wrapping up",
          },
        },
        {
          kind: "runtime-tool",
          id: testTimelineEntryId("tool:stale-running-shell"),
          createdAt: "2026-06-05T16:00:02.000Z",
          tool: {
            id: "tool:stale-running-shell",
            kind: "tool",
            orderKey: "2026-06-05T16:00:02.000Z:tool:stale-running-shell",
            createdAt: "2026-06-05T16:00:02.000Z",
            toolCallId: "toolu-stale-running-shell",
            toolName: "bash",
            status: "running",
            eventIds: [],
            display: {
              kind: "bash",
              command: "git push",
            },
          },
        },
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: testTimelineEntryId("message:stale-running-assistant:thinking"),
        group: expect.objectContaining({
          completedDurationLabel: null,
          isRunning: true,
          isTailGroup: true,
          summary: {
            action: "Running",
            details: "",
          },
          steps: [
            expect.objectContaining({ kind: "runtime-thinking" }),
            expect.objectContaining({
              kind: "runtime-tool",
              tool: expect.objectContaining({ status: "running" }),
            }),
          ],
        }),
      }),
    ]);
  });

  it("uses briefly for sub-500ms thinking groups", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "work",
          id: testTimelineEntryId("work:brief-thinking"),
          createdAt: "2026-06-05T16:00:01.000Z",
          entry: workEntry({
            id: "brief-thinking",
            createdAt: "2026-06-05T16:00:01.000Z",
            completedAt: "2026-06-05T16:00:01.300Z",
            tone: "thinking",
          }),
        },
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          summary: { action: "Thought", details: "briefly" },
        }),
      }),
    );
  });

  it("summarizes exploration-only work groups as explored segments", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "work",
          id: testTimelineEntryId("work:read"),
          createdAt: "2026-06-05T16:00:01.000Z",
          entry: workEntry({
            id: "read",
            createdAt: "2026-06-05T16:00:01.000Z",
            itemType: "file_read",
            artifacts: [{ type: "read", path: "/repo/src/a.ts" }],
          }),
        },
        {
          kind: "work",
          id: testTimelineEntryId("work:search"),
          createdAt: "2026-06-05T16:00:02.000Z",
          entry: workEntry({
            id: "search",
            createdAt: "2026-06-05T16:00:02.000Z",
            itemType: "file_search",
            artifacts: [{ type: "search", matchedFiles: ["/repo/src/b.ts"] }],
          }),
        },
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          summary: {
            action: "Explored",
            details: "2 files, 1 search",
          },
        }),
      }),
    );
  });

  it("summarizes delete-only work groups with deleted vocabulary", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "work",
          id: testTimelineEntryId("work:delete"),
          createdAt: "2026-06-05T16:00:01.000Z",
          entry: workEntry({
            id: "delete",
            createdAt: "2026-06-05T16:00:01.000Z",
            requestKind: "file-change",
            artifacts: [
              {
                type: "diff",
                format: "unified",
                source: "result",
                files: [{ path: "/repo/src/old.ts", additions: 0, deletions: 12 }],
                unifiedDiff: "@@",
              },
            ],
          }),
        },
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
      projectRoot: "/repo",
    });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          summary: {
            action: "Deleted",
            details: "repo/src/old.ts",
            deletions: 12,
          },
        }),
      }),
    );
  });

  it("summarizes browser-only runtime groups with browser action counts", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "runtime-tool",
          id: testTimelineEntryId("tool:browser-1"),
          createdAt: "2026-06-05T16:00:01.000Z",
          tool: {
            id: "tool:browser-1",
            kind: "tool",
            orderKey: "2026-06-05T16:00:01.000Z:tool:browser-1",
            createdAt: "2026-06-05T16:00:01.000Z",
            toolCallId: "toolu-browser-1",
            toolName: "mcp_cursor-ide-browser_browser_navigate",
            status: "completed",
            eventIds: [],
            display: {
              kind: "mcp",
              providerIdentifier: "cursor-ide-browser",
            },
          },
        },
        {
          kind: "runtime-tool",
          id: testTimelineEntryId("tool:browser-2"),
          createdAt: "2026-06-05T16:00:02.000Z",
          tool: {
            id: "tool:browser-2",
            kind: "tool",
            orderKey: "2026-06-05T16:00:02.000Z:tool:browser-2",
            createdAt: "2026-06-05T16:00:02.000Z",
            toolCallId: "toolu-browser-2",
            toolName: "mcp_cursor-ide-browser_browser_snapshot",
            status: "completed",
            eventIds: [],
            display: {
              kind: "mcp",
              providerIdentifier: "cursor-ide-browser",
            },
          },
        },
        {
          kind: "runtime-tool",
          id: testTimelineEntryId("tool:browser-3"),
          createdAt: "2026-06-05T16:00:03.000Z",
          tool: {
            id: "tool:browser-3",
            kind: "tool",
            orderKey: "2026-06-05T16:00:03.000Z:tool:browser-3",
            createdAt: "2026-06-05T16:00:03.000Z",
            toolCallId: "toolu-browser-3",
            toolName: "mcp_cursor-ide-browser_browser_click",
            status: "completed",
            eventIds: [],
            display: {
              kind: "mcp",
              providerIdentifier: "cursor-ide-browser",
            },
          },
        },
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          isBrowserGroup: true,
          summary: {
            action: "Ran",
            details: "3 browser actions",
          },
        }),
      }),
    );
  });

  it("applies tail-only loading semantics so only the last group stays active", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "work",
          id: testTimelineEntryId("work:earlier-running"),
          createdAt: "2026-06-05T16:00:01.000Z",
          entry: workEntry({
            id: "earlier-running",
            createdAt: "2026-06-05T16:00:01.000Z",
            status: "running",
            itemType: "command_execution",
            artifacts: [{ type: "command", durationMs: 1_000 }],
          }),
        },
        {
          kind: "message",
          id: testTimelineEntryId("message:boundary"),
          createdAt: "2026-06-05T16:00:01.500Z",
          message: {
            id: MessageId.make("message:boundary"),
            role: "user",
            text: "continue",
            createdAt: "2026-06-05T16:00:01.500Z",
            streaming: false,
          },
        },
        {
          kind: "work",
          id: testTimelineEntryId("work:tail-running"),
          createdAt: "2026-06-05T16:00:02.000Z",
          entry: workEntry({
            id: "tail-running",
            createdAt: "2026-06-05T16:00:02.000Z",
            status: "running",
            itemType: "command_execution",
            artifacts: [{ type: "command", durationMs: 500 }],
          }),
        },
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          isRunning: false,
          isTailGroup: false,
          summary: {
            action: "Ran",
            details: "1 command",
          },
        }),
      }),
    );
    expect(rows[2]).toEqual(
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          isRunning: true,
          isTailGroup: true,
          completedDurationLabel: null,
          summary: {
            action: "Running",
            details: "",
          },
        }),
      }),
    );
  });

  it("keeps a single completed explore tool ungrouped", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeReadTool({
          id: "tool:read-single",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
        }),
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "single",
        step: expect.objectContaining({
          kind: "runtime-tool",
          tool: expect.objectContaining({ toolCallId: "tool:read-single" }),
        }),
      }),
    ]);
  });

  it("keeps shells ungrouped at any status when the density disables shell grouping", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-single",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "running",
        }),
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
      conversationDensity: "compact-ungrouped",
    });

    // Density gates unconditionally: a tool must not change groupability between its
    // running and completed states, or the streaming group recomposes mid-turn.
    expect(rows).toEqual([
      expect.objectContaining({
        kind: "single",
        step: expect.objectContaining({ kind: "runtime-tool" }),
      }),
    ]);
  });

  it("keeps a running group tail when assistant text follows it", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-tail",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "running",
        }),
        {
          kind: "message",
          id: testTimelineEntryId("message:assistant"),
          createdAt: "2026-06-05T16:00:02.000Z",
          message: {
            id: assistantId,
            role: "assistant",
            text: "Still working",
            createdAt: "2026-06-05T16:00:02.000Z",
            streaming: true,
          },
        },
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          isRunning: true,
          isTailGroup: true,
          // Short streaming narration joins the running group instead of splitting it.
          steps: [
            expect.objectContaining({ kind: "runtime-tool" }),
            expect.objectContaining({ kind: "message" }),
          ],
        }),
      }),
    );
  });

  it("keeps active runtime groups running when the orchestration working flag lags", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-orchestration-lag",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "running",
        }),
        {
          kind: "message",
          id: testTimelineEntryId("message:assistant"),
          createdAt: "2026-06-05T16:00:02.000Z",
          message: {
            id: assistantId,
            role: "assistant",
            text: "Still working",
            createdAt: "2026-06-05T16:00:02.000Z",
            streaming: true,
          },
        },
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          isRunning: true,
          isTailGroup: true,
          completedDurationLabel: null,
        }),
      }),
    );
  });

  it("ignores empty streaming thinking markers in collapsed preview accounting", () => {
    const shellEntry = runtimeShellTool({
      id: "tool:shell-preview-output",
      createdAt: "2026-06-05T16:00:01.000Z",
      status: "running",
    });
    const steps = [
      {
        kind: "runtime-tool",
        id: shellEntry.id,
        createdAt: shellEntry.createdAt,
        tool: shellEntry.tool,
      },
      {
        kind: "runtime-thinking",
        id: testTimelineEntryId("message:assistant:thinking"),
        createdAt: "2026-06-05T16:00:02.000Z",
        message: {
          id: "message:assistant",
          kind: "message",
          source: "live-event",
          orderKey: "2026-06-05T16:00:02.000Z:message:assistant",
          createdAt: "2026-06-05T16:00:02.000Z",
          role: "assistant",
          eventIds: [],
          streaming: true,
        },
      },
    ] satisfies TimelineGroupedStep[];

    expect(countRenderableWorkGroupPreviewSteps(steps)).toBe(1);
    expect(runningWorkGroupPreviewOutputStripExtraPx(steps)).toBe(
      WORK_GROUP_PREVIEW_OUTPUT_STRIP_PX + WORK_GROUP_STEP_GAP_PX - WORK_GROUP_PREVIEW_ENTRY_PX,
    );
  });

  it("groups a single running shell tool", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-single",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "running",
        }),
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          isRunning: true,
          isTailGroup: true,
          summary: {
            action: "Running",
            details: "",
          },
        }),
      }),
    ]);
  });

  it("requires three explore-only runtime tools before collapsing", () => {
    const twoReads = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeReadTool({
          id: "tool:read-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
        }),
        runtimeReadTool({
          id: "tool:read-2",
          createdAt: "2026-06-05T16:00:02.000Z",
          status: "completed",
        }),
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });
    expect(twoReads.map((row) => row.kind)).toEqual(["single", "single"]);

    const threeReads = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeReadTool({
          id: "tool:read-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
          path: "/repo/src/a.ts",
        }),
        runtimeReadTool({
          id: "tool:read-2",
          createdAt: "2026-06-05T16:00:02.000Z",
          status: "completed",
          path: "/repo/src/b.ts",
        }),
        runtimeReadTool({
          id: "tool:read-3",
          createdAt: "2026-06-05T16:00:03.000Z",
          status: "completed",
          path: "/repo/src/c.ts",
        }),
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });
    expect(threeReads).toEqual([
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          summary: {
            action: "Explored",
            details: "3 files",
          },
        }),
      }),
    ]);
  });

  it("keeps the trailing group running between tool calls while the turn is active", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
        }),
        runtimeShellTool({
          id: "tool:shell-2",
          createdAt: "2026-06-05T16:00:02.000Z",
          status: "completed",
        }),
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          isRunning: true,
          isTailGroup: true,
          completedDurationLabel: null,
          summary: {
            action: "Running",
            details: "",
          },
        }),
      }),
    ]);
  });

  it("keeps runtime tool errors out of the grouped header", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
        }),
        runtimeReadTool({
          id: "tool:read-error",
          createdAt: "2026-06-05T16:00:02.000Z",
          status: "error",
          path: "/repo/src/app.ts",
        }),
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
      projectRoot: "/repo",
    });

    const group = rows[0]?.kind === "group" ? rows[0].group : null;
    const errorStep = group?.steps.find(
      (step) => step.kind === "runtime-tool" && step.tool.toolCallId === "tool:read-error",
    );

    expect(group).toEqual(
      expect.objectContaining({
        isRunning: true,
        isTailGroup: true,
        summary: {
          action: "Exploring",
          details: "1 file, ran 1 command",
        },
      }),
    );
    expect(errorStep).toEqual(
      expect.objectContaining({
        kind: "runtime-tool",
        tool: expect.objectContaining({ status: "error", isError: true }),
      }),
    );
    expect(errorStep ? isPreviewableWorkGroupStep(errorStep) : false).toBe(true);
  });

  it("keeps short assistant narration inside a tool group", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
        }),
        assistantTextEntry({
          id: "message:narration",
          createdAt: "2026-06-05T16:00:02.000Z",
          text: "Now checking the test output.",
        }),
        runtimeShellTool({
          id: "tool:shell-2",
          createdAt: "2026-06-05T16:00:03.000Z",
          status: "completed",
        }),
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          // Text steps stay out of the summary counts.
          summary: { action: "Ran", details: "2 commands" },
        }),
      }),
    ]);
    expect(rows[0]?.kind === "group" ? rows[0].group.steps.map((step) => step.kind) : []).toEqual([
      "runtime-tool",
      "message",
      "runtime-tool",
    ]);
  });

  it("peels short assistant summary out of a completed tool group", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
        }),
        assistantTextEntry({
          id: "message:summary",
          createdAt: "2026-06-05T16:00:02.000Z",
          text: "Done checking the test output.",
        }),
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          summary: { action: "Ran", details: "1 command" },
        }),
      }),
    );
    expect(rows[0]?.kind === "group" ? rows[0].group.steps.map((step) => step.kind) : []).toEqual([
      "runtime-tool",
    ]);
    expect(rows[1]).toEqual(
      expect.objectContaining({
        kind: "single",
        id: testTimelineEntryId("message:summary"),
        step: expect.objectContaining({
          kind: "message",
          message: expect.objectContaining({ text: "Done checking the test output." }),
        }),
      }),
    );
  });

  it("splits the group when assistant text is long or structured", () => {
    const longText = "x".repeat(120);
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
        }),
        assistantTextEntry({
          id: "message:long",
          createdAt: "2026-06-05T16:00:02.000Z",
          text: longText,
        }),
        runtimeShellTool({
          id: "tool:shell-2",
          createdAt: "2026-06-05T16:00:03.000Z",
          status: "completed",
        }),
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows.map((row) => row.kind)).toEqual(["group", "single", "group"]);

    const markdownRows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
        }),
        assistantTextEntry({
          id: "message:list",
          createdAt: "2026-06-05T16:00:02.000Z",
          text: "- first item",
        }),
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });
    expect(markdownRows.map((row) => row.kind)).toEqual(["group", "single"]);
  });

  it("releases assistant code-fence replies as standalone transcript rows after tool groups", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-turn-2",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
          turnId: "turn-2",
        }),
        assistantTextEntry({
          id: "message:turn-2-reply",
          createdAt: "2026-06-05T16:00:02.000Z",
          text: "Here is the patch:\n```ts\nexport const x = 1;\n```",
          turnId: "turn-2",
        }),
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows.map((row) => row.kind)).toEqual(["group", "single"]);
    expect(rows[1]?.kind === "single" ? rows[1].step.kind : null).toBe("message");
    expect(rows[0]?.kind === "group" ? rows[0].group.steps.map((step) => step.kind) : []).toEqual([
      "runtime-tool",
    ]);
  });

  it("releases structured assistant summaries while the turn is still active", () => {
    const structuredText = [
      "Here are some representative examples from this codebase style.",
      "",
      "## React app entry",
      "",
      "```javascript",
      'import { createBrowserHistory } from "@tanstack/react-router";',
      "```",
    ].join("\n");
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-turn-2",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
          turnId: "turn-2",
        }),
        assistantTextEntry({
          id: "message:turn-2-summary",
          createdAt: "2026-06-05T16:00:02.000Z",
          text: structuredText,
          turnId: "turn-2",
        }),
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows.map((row) => row.kind)).toEqual(["group", "single"]);
    expect(rows[0]?.kind === "group" ? rows[0].group.steps.map((step) => step.kind) : []).toEqual([
      "runtime-tool",
    ]);
    expect(rows[1]?.kind === "single" ? rows[1].step.kind : null).toBe("message");
  });

  it("releases transcript-scale assistant text trapped inside group steps", () => {
    const trappedMessage: TimelineGroupedStep = {
      kind: "message",
      id: testTimelineEntryId("message:trapped"),
      createdAt: "2026-06-05T16:00:02.000Z",
      message: {
        id: assistantId,
        role: "assistant",
        text: "## React app entry\n\n```javascript\nconst x = 1;\n```",
        createdAt: "2026-06-05T16:00:02.000Z",
        streaming: false,
      },
      durationStart: "2026-06-05T16:00:02.000Z",
      editAvailable: false,
      pairId: null,
      messageIndex: 1,
    };
    const rows = finalizeGroupAssistantMessagesForTest(
      [
        {
          kind: "group",
          id: testTimelineEntryId("tool:shell-1"),
          createdAt: "2026-06-05T16:00:01.000Z",
          group: {
            id: testTimelineEntryId("tool:shell-1"),
            createdAt: "2026-06-05T16:00:01.000Z",
            completedDurationLabel: null,
            isRunning: true,
            isTailGroup: true,
            isThinkingGroup: false,
            isCommandGroup: true,
            isWaitingGroup: false,
            isBrowserGroup: false,
            summary: { action: "Ran", details: "1 command" },
            steps: [
              {
                kind: "runtime-tool",
                id: testTimelineEntryId("tool:shell-1"),
                createdAt: "2026-06-05T16:00:01.000Z",
                tool: runtimeShellTool({
                  id: "tool:shell-1",
                  createdAt: "2026-06-05T16:00:01.000Z",
                  status: "completed",
                }).tool,
              },
              trappedMessage,
            ],
            entries: [],
          },
        },
      ],
      { isTurnActive: true },
    );

    expect(rows.map((row) => row.kind)).toEqual(["group", "single"]);
    expect(rows[0]?.kind === "group" ? rows[0].group.steps.map((step) => step.kind) : []).toEqual([
      "runtime-tool",
    ]);
    expect(rows[1]?.kind === "single" ? rows[1].id : null).toBe("message:trapped");
  });

  it("keeps one ongoing group across internal turn-id flips with no user-visible boundary", () => {
    // Runtime-driven continuations (GitAction flows, ask_user resumes) mint a new
    // orchestration turn id per segment within one visible run. Only user-visible
    // entries break runs — never internal turn ids.
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-turn-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
          turnId: "turn-1",
        }),
        assistantTextEntry({
          id: "message:turn-1-narration",
          createdAt: "2026-06-05T16:00:02.000Z",
          text: "Turn one summary complete.",
          turnId: "turn-1",
        }),
        runtimeShellTool({
          id: "tool:shell-turn-2",
          createdAt: "2026-06-05T16:00:03.000Z",
          status: "running",
          turnId: "turn-2",
        }),
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows.map((row) => row.kind)).toEqual(["group"]);
    expect(rows[0]?.kind === "group" ? rows[0].group.steps.map((step) => step.kind) : []).toEqual([
      "runtime-tool",
      "message",
      "runtime-tool",
    ]);
    expect(rows[0]?.kind === "group" ? rows[0].group.isRunning : false).toBe(true);
  });

  it("does not start a group with assistant text", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        assistantTextEntry({
          id: "message:lead-in",
          createdAt: "2026-06-05T16:00:01.000Z",
          text: "Looking into it.",
        }),
        runtimeShellTool({
          id: "tool:shell-1",
          createdAt: "2026-06-05T16:00:02.000Z",
          status: "completed",
        }),
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows.map((row) => row.kind)).toEqual(["single", "group"]);
    expect(rows[0]?.kind === "single" ? rows[0].step.kind : null).toBe("message");
  });

  it("does not absorb text into a thinking-only run", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "runtime-thinking",
          id: testTimelineEntryId("thinking:1"),
          createdAt: "2026-06-05T16:00:01.000Z",
          message: {
            id: "thinking:1",
            kind: "message",
            orderKey: "2026-06-05T16:00:01.000Z:thinking:1",
            createdAt: "2026-06-05T16:00:01.000Z",
            role: "assistant",
            thinking: "Considering options.",
            streaming: false,
          },
        } as unknown as TimelineEntry,
        assistantTextEntry({
          id: "message:after-thinking",
          createdAt: "2026-06-05T16:00:02.000Z",
          text: "Here is the plan.",
        }),
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows.map((row) => row.kind)).toEqual(["group", "single"]);
  });

  it("releases streaming text from the group once it outgrows the short-text limit", () => {
    const shell = runtimeShellTool({
      id: "tool:shell-1",
      createdAt: "2026-06-05T16:00:01.000Z",
      status: "completed",
    });
    const shortFrame = deriveTimelineRenderItems({
      timelineEntries: [
        shell,
        assistantTextEntry({
          id: "message:streaming",
          createdAt: "2026-06-05T16:00:02.000Z",
          text: "Starting the summary now.",
          streaming: true,
        }),
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });
    const longFrame = deriveTimelineRenderItems({
      timelineEntries: [
        shell,
        assistantTextEntry({
          id: "message:streaming",
          createdAt: "2026-06-05T16:00:02.000Z",
          text: "Starting the summary now. ".repeat(8),
          streaming: true,
        }),
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(shortFrame.map((row) => row.kind)).toEqual(["group"]);
    expect(shortFrame[0]?.kind === "group" ? shortFrame[0].group.steps.length : 0).toBe(2);
    expect(longFrame.map((row) => row.kind)).toEqual(["group", "single"]);
    // The group row id is the first tool's id in both frames, so nothing remounts.
    expect(longFrame[0]?.id).toBe(shortFrame[0]?.id);
  });

  it("keeps the tail group running while trailing short text streams", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
        }),
        assistantTextEntry({
          id: "message:streaming",
          createdAt: "2026-06-05T16:00:02.000Z",
          text: "Wrapping up.",
          streaming: true,
        }),
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({ isRunning: true, isTailGroup: true }),
      }),
    ]);
  });

  it("keeps runtime extension UI requests outside runtime groups", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "runtime-tool",
          id: testTimelineEntryId("tool:toolu-runtime"),
          createdAt: "2026-06-05T16:00:02.000Z",
          tool: {
            id: "tool:toolu-runtime",
            kind: "tool",
            orderKey: "2026-06-05T16:00:02.000Z:tool:toolu-runtime",
            createdAt: "2026-06-05T16:00:02.000Z",
            toolCallId: "toolu-runtime",
            toolName: "bash",
            status: "running",
            eventIds: [],
            display: {
              kind: "bash",
              command: "git status --short",
            },
          },
        },
        {
          kind: "runtime-extension-ui-request",
          id: testTimelineEntryId("extension-ui:request"),
          createdAt: "2026-06-05T16:00:03.000Z",
          request: {
            id: "extension-ui:request",
            kind: "extension-ui-request",
            orderKey: "2026-06-05T16:00:03.000Z:extension-ui:request",
            createdAt: "2026-06-05T16:00:03.000Z",
            requestId: "request",
            requestKind: "select",
            status: "pending",
            threadId: ThreadId.make("thread:runtime-extension-ui"),
            runtimeSessionId: RuntimeSessionId.make("runtime:runtime-extension-ui"),
            eventIds: [],
            title: "Allow?",
            message: "Run command?",
          },
        },
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: testTimelineEntryId("tool:toolu-runtime"),
        group: expect.objectContaining({
          steps: [expect.objectContaining({ kind: "runtime-tool" })],
        }),
      }),
      expect.objectContaining({
        kind: "single",
        id: "extension-ui:request",
        step: expect.objectContaining({ kind: "runtime-extension-ui-request" }),
      }),
    ]);
  });

  it("groups 2+ parallel await tools into a waiting group with monitoring summary", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeAwaitTool({
          id: "tool:await-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
          taskId: "task-1",
        }),
        runtimeAwaitTool({
          id: "tool:await-2",
          createdAt: "2026-06-05T16:00:02.000Z",
          status: "running",
          taskId: "task-2",
        }),
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: testTimelineEntryId("tool:await-1"),
        group: expect.objectContaining({
          isWaitingGroup: true,
          isBrowserGroup: false,
          isRunning: true,
          summary: {
            action: "Monitoring background tasks",
            details: "",
          },
          steps: [
            expect.objectContaining({ kind: "runtime-tool", id: "tool:await-1" }),
            expect.objectContaining({ kind: "runtime-tool", id: "tool:await-2" }),
          ],
        }),
      }),
    ]);
  });

  it("summarizes completed waiting groups with monitored background task counts", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeAwaitTool({
          id: "tool:await-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
          taskId: "task-1",
        }),
        runtimeAwaitTool({
          id: "tool:await-2",
          createdAt: "2026-06-05T16:00:02.000Z",
          status: "completed",
          taskId: "task-2",
        }),
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          isWaitingGroup: true,
          isRunning: false,
          summary: {
            action: "Monitored background tasks",
            details: "2 complete",
          },
        }),
      }),
    ]);
  });

  it("emits a single await tool outside waiting groups", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeAwaitTool({
          id: "tool:await-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "running",
        }),
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "single",
        id: testTimelineEntryId("tool:await-1"),
        step: expect.objectContaining({ kind: "runtime-tool" }),
      }),
    ]);
  });

  it("groups 2+ browser MCP tools into a browser group", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeBrowserMcpTool({
          id: "tool:browser-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "completed",
        }),
        runtimeBrowserMcpTool({
          id: "tool:browser-2",
          createdAt: "2026-06-05T16:00:02.000Z",
          status: "completed",
        }),
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: testTimelineEntryId("tool:browser-1"),
        group: expect.objectContaining({
          isWaitingGroup: false,
          isBrowserGroup: true,
          summary: {
            action: "Ran",
            details: "2 browser actions",
          },
          steps: [
            expect.objectContaining({ kind: "runtime-tool", id: "tool:browser-1" }),
            expect.objectContaining({ kind: "runtime-tool", id: "tool:browser-2" }),
          ],
        }),
      }),
    ]);
  });

  it("keeps a single browser MCP tool outside browser groups", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeBrowserMcpTool({
          id: "tool:browser-1",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "running",
        }),
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "single",
        id: testTimelineEntryId("tool:browser-1"),
        step: expect.objectContaining({ kind: "runtime-tool" }),
      }),
    ]);
  });

  it("marks the tail runtime group running while the turn is active and a tool is executing", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-running",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "running",
        }),
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          isRunning: true,
          isTailGroup: true,
        }),
      }),
    );
  });

  it("does not keep groups running after the turn ends even if tool status lags", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-lagging",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "running",
        }),
      ],
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          isRunning: false,
          isTailGroup: false,
        }),
      }),
    );
  });

  it("excludes long assistant narration from collapsed preview steps", () => {
    const shortMessage = {
      kind: "message" as const,
      id: testTimelineEntryId("message:short"),
      createdAt: "2026-06-05T16:00:02.000Z",
      message: {
        id: assistantId,
        role: "assistant" as const,
        text: "Starting the summary now.",
        createdAt: "2026-06-05T16:00:02.000Z",
        streaming: true,
      },
      durationStart: assistantCreatedAt,
      editAvailable: false,
      pairId: null,
      messageIndex: 0,
    };
    const longMessage = {
      ...shortMessage,
      message: {
        ...shortMessage.message,
        text: "Starting the summary now. ".repeat(8),
      },
    };

    expect(isShortPlainText(shortMessage.message.text)).toBe(true);
    expect(isGroupedNarrationMessageStep(shortMessage)).toBe(true);
    expect(isPreviewableWorkGroupStep(shortMessage)).toBe(true);
    expect(isRenderableWorkGroupPreviewStep(shortMessage)).toBe(true);
    expect(isShortPlainText(longMessage.message.text)).toBe(false);
    expect(isShortPlainText("Here:\n    const x = 1;")).toBe(false);
    expect(isShortPlainText("~~~ts\ncode\n~~~")).toBe(false);
    expect(isGroupedNarrationMessageStep(longMessage)).toBe(false);
    expect(isPreviewableWorkGroupStep(longMessage)).toBe(false);
    expect(isRenderableWorkGroupPreviewStep(longMessage)).toBe(false);
  });

  it("keeps tool summary entries outside work groups and preview steps", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "work",
          id: testTimelineEntryId("work:shell"),
          createdAt: "2026-06-05T16:00:01.000Z",
          entry: workEntry({
            id: "shell",
            createdAt: "2026-06-05T16:00:01.000Z",
            itemType: "command_execution",
            command: "pnpm test",
          }),
        },
        {
          kind: "work",
          id: testTimelineEntryId("work:summary"),
          createdAt: "2026-06-05T16:00:02.000Z",
          entry: workEntry({
            id: "summary",
            createdAt: "2026-06-05T16:00:02.000Z",
            label: "Chat context summarized.",
            tone: "info",
            isToolSummary: true,
          }),
        },
      ],
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows.map((row) => row.kind)).toEqual(["group", "single"]);
    const group = rows[0];
    expect(group?.kind === "group" ? group.group.steps.map((step) => step.id) : []).toEqual([
      "work:shell",
    ]);
    expect(
      countRenderableWorkGroupPreviewSteps(group?.kind === "group" ? group.group.steps : []),
    ).toBe(1);
  });

  describe("compact-ungrouped density", () => {
    it("keeps three explore reads as separate rows", () => {
      const rows = deriveTimelineRenderItems({
        timelineEntries: [
          runtimeReadTool({
            id: "tool:read-1",
            createdAt: "2026-06-05T16:00:01.000Z",
            status: "completed",
            path: "/repo/src/a.ts",
          }),
          runtimeReadTool({
            id: "tool:read-2",
            createdAt: "2026-06-05T16:00:02.000Z",
            status: "completed",
            path: "/repo/src/b.ts",
          }),
          runtimeReadTool({
            id: "tool:read-3",
            createdAt: "2026-06-05T16:00:03.000Z",
            status: "completed",
            path: "/repo/src/c.ts",
          }),
        ],
        isTurnActive: false,
        editableUserMessageIds: new Set(),
        conversationDensity: "compact-ungrouped",
      });

      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.kind === "single")).toBe(true);
    });

    it("keeps work-log reads as separate rows", () => {
      const rows = deriveTimelineRenderItems({
        timelineEntries: [
          {
            kind: "work",
            id: testTimelineEntryId("work:read-1"),
            createdAt: "2026-06-05T16:00:01.000Z",
            entry: workEntry({
              id: "read-1",
              createdAt: "2026-06-05T16:00:01.000Z",
              itemType: "file_read",
              artifacts: [{ type: "read", path: "/repo/src/a.ts" }],
            }),
          },
          {
            kind: "work",
            id: testTimelineEntryId("work:read-2"),
            createdAt: "2026-06-05T16:00:02.000Z",
            entry: workEntry({
              id: "read-2",
              createdAt: "2026-06-05T16:00:02.000Z",
              itemType: "file_read",
              artifacts: [{ type: "read", path: "/repo/src/b.ts" }],
            }),
          },
        ],
        isTurnActive: false,
        editableUserMessageIds: new Set(),
        conversationDensity: "compact-ungrouped",
      });

      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.kind === "single")).toBe(true);
    });

    it("keeps await and browser tools as separate rows", () => {
      const awaitRows = deriveTimelineRenderItems({
        timelineEntries: [
          runtimeAwaitTool({
            id: "tool:await-1",
            createdAt: "2026-06-05T16:00:01.000Z",
            status: "completed",
            taskId: "task-1",
          }),
          runtimeAwaitTool({
            id: "tool:await-2",
            createdAt: "2026-06-05T16:00:02.000Z",
            status: "completed",
            taskId: "task-2",
          }),
        ],
        isTurnActive: false,
        editableUserMessageIds: new Set(),
        conversationDensity: "compact-ungrouped",
      });
      expect(awaitRows).toHaveLength(2);
      expect(awaitRows.every((row) => row.kind === "single")).toBe(true);

      const browserRows = deriveTimelineRenderItems({
        timelineEntries: [
          runtimeBrowserMcpTool({
            id: "tool:browser-1",
            createdAt: "2026-06-05T16:00:01.000Z",
            status: "completed",
          }),
          runtimeBrowserMcpTool({
            id: "tool:browser-2",
            createdAt: "2026-06-05T16:00:02.000Z",
            status: "completed",
          }),
        ],
        isTurnActive: false,
        editableUserMessageIds: new Set(),
        conversationDensity: "compact-ungrouped",
      });
      expect(browserRows).toHaveLength(2);
      expect(browserRows.every((row) => row.kind === "single")).toBe(true);
    });

    it("still groups thinking-only work entries", () => {
      const rows = deriveTimelineRenderItems({
        timelineEntries: [
          {
            kind: "work",
            id: testTimelineEntryId("work:thinking-1"),
            createdAt: "2026-06-05T16:00:01.000Z",
            entry: workEntry({
              id: "thinking-1",
              createdAt: "2026-06-05T16:00:01.000Z",
              tone: "thinking",
            }),
          },
          {
            kind: "work",
            id: testTimelineEntryId("work:thinking-2"),
            createdAt: "2026-06-05T16:00:02.000Z",
            entry: workEntry({
              id: "thinking-2",
              createdAt: "2026-06-05T16:00:02.000Z",
              tone: "thinking",
            }),
          },
        ],
        isTurnActive: false,
        editableUserMessageIds: new Set(),
        conversationDensity: "compact-ungrouped",
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          kind: "group",
          group: expect.objectContaining({
            isThinkingGroup: true,
          }),
        }),
      );
    });
  });

  describe("detailed density", () => {
    it("keeps mixed shells, edits, and reads as separate rows", () => {
      const rows = deriveTimelineRenderItems({
        timelineEntries: [
          runtimeShellTool({
            id: "tool:shell-1",
            createdAt: "2026-06-05T16:00:01.000Z",
            status: "completed",
          }),
          runtimeEditTool({
            id: "tool:edit-1",
            createdAt: "2026-06-05T16:00:02.000Z",
            status: "completed",
            path: "/repo/src/a.ts",
          }),
          runtimeReadTool({
            id: "tool:read-1",
            createdAt: "2026-06-05T16:00:03.000Z",
            status: "completed",
            path: "/repo/src/b.ts",
          }),
        ],
        isTurnActive: false,
        editableUserMessageIds: new Set(),
        conversationDensity: "detailed",
      });

      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.kind === "single")).toBe(true);
    });

    it("still groups thinking-only runtime runs", () => {
      const rows = deriveTimelineRenderItems({
        timelineEntries: [
          runtimeThinkingEntry({
            id: "thinking-1",
            createdAt: "2026-06-05T16:00:01.000Z",
            thinking: "Reading the failing test first.",
          }),
          runtimeThinkingEntry({
            id: "thinking-2",
            createdAt: "2026-06-05T16:00:02.000Z",
            thinking: "The mock omits the branch parent.",
          }),
        ],
        isTurnActive: false,
        editableUserMessageIds: new Set(),
        conversationDensity: "detailed",
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          kind: "group",
          group: expect.objectContaining({
            isThinkingGroup: true,
          }),
        }),
      );
    });
  });

  it("changes explore read row count when density transitions from grouped to balanced", () => {
    const timelineEntries = [
      runtimeReadTool({
        id: "tool:read-1",
        createdAt: "2026-06-05T16:00:01.000Z",
        status: "completed",
        path: "/repo/src/a.ts",
      }),
      runtimeReadTool({
        id: "tool:read-2",
        createdAt: "2026-06-05T16:00:02.000Z",
        status: "completed",
        path: "/repo/src/b.ts",
      }),
      runtimeReadTool({
        id: "tool:read-3",
        createdAt: "2026-06-05T16:00:03.000Z",
        status: "completed",
        path: "/repo/src/c.ts",
      }),
    ];
    const grouped = deriveTimelineRenderItems({
      timelineEntries,
      isTurnActive: false,
      editableUserMessageIds: new Set(),
      conversationDensity: "compact-all-grouped",
    });
    const balanced = deriveTimelineRenderItems({
      timelineEntries,
      isTurnActive: false,
      editableUserMessageIds: new Set(),
      conversationDensity: "compact-ungrouped",
    });

    expect(grouped).toHaveLength(1);
    expect(balanced).toHaveLength(3);
  });
});

describe("pending approval handling", () => {
  const pendingCommandKinds: ReadonlySet<PendingApprovalRequestKind> = new Set(["command"]);
  const pendingEntries = [
    runtimeThinkingEntry({
      id: "thinking:pending-run",
      createdAt: "2026-06-05T16:00:01.000Z",
      thinking: "Checking the workspace state.",
    }),
    runtimeShellTool({
      id: "tool:shell-done",
      createdAt: "2026-06-05T16:00:02.000Z",
      status: "completed",
    }),
    runtimeShellTool({
      id: "tool:shell-pending",
      createdAt: "2026-06-05T16:00:03.000Z",
      status: "running",
    }),
  ];

  it("breaks the awaiting tool out of the group and keeps the prior group running", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: pendingEntries,
      isTurnActive: true,
      editableUserMessageIds: new Set(),
      conversationDensity: "compact-all-grouped",
      pendingApprovalKinds: pendingCommandKinds,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        kind: "group",
        group: expect.objectContaining({
          isRunning: true,
          isTailGroup: true,
        }),
      }),
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({
        kind: "single",
        id: testTimelineEntryId("tool:shell-pending"),
      }),
    );
  });

  it("regroups the tool once the approval resolves", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: pendingEntries,
      isTurnActive: true,
      editableUserMessageIds: new Set(),
      conversationDensity: "compact-all-grouped",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("group");
  });

  it("ignores pending approvals of a non-matching kind", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: pendingEntries,
      isTurnActive: true,
      editableUserMessageIds: new Set(),
      conversationDensity: "compact-all-grouped",
      pendingApprovalKinds: new Set(["file-change"]),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("group");
  });

  it("matches work entries by request kind and running status", () => {
    const runningCommand = workEntry({
      id: "work:push",
      createdAt: "2026-06-05T16:00:01.000Z",
      status: "running",
      command: "git push origin main",
    });

    expect(workEntryHasPendingApproval(runningCommand, pendingCommandKinds)).toBe(true);
    expect(workEntryHasPendingApproval(runningCommand, new Set(["permissions"]))).toBe(true);
    expect(workEntryHasPendingApproval(runningCommand, new Set(["file-change"]))).toBe(false);
    expect(
      workEntryHasPendingApproval({ ...runningCommand, status: "completed" }, pendingCommandKinds),
    ).toBe(false);
  });

  it("matches runtime tools by display kind and running status", () => {
    const runningShell = runtimeShellTool({
      id: "tool:shell-approval",
      createdAt: "2026-06-05T16:00:01.000Z",
      status: "running",
    }).tool;
    const completedShell = runtimeShellTool({
      id: "tool:shell-settled",
      createdAt: "2026-06-05T16:00:02.000Z",
      status: "completed",
    }).tool;

    expect(runtimeToolHasPendingApproval(runningShell, pendingCommandKinds)).toBe(true);
    expect(runtimeToolHasPendingApproval(runningShell, new Set(["file-read"]))).toBe(false);
    expect(runtimeToolHasPendingApproval(completedShell, pendingCommandKinds)).toBe(false);
  });
});
