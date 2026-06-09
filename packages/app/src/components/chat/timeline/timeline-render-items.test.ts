import { MessageId, RuntimeSessionId, ThreadId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import type { TimelineEntry, WorkLogEntry } from "../../../session-logic";
import {
  deriveTimelineRenderItems,
  readTailGroupSnapshot,
} from "./timeline-render-items";

const userId = MessageId.make("message:user");
const assistantId = MessageId.make("message:assistant");
const followUpId = MessageId.make("message:follow-up");
const userCreatedAt = "2026-06-05T16:00:00.000Z";
const assistantCreatedAt = "2026-06-05T16:00:03.000Z";
const assistantCompletedAt = "2026-06-05T16:00:08.000Z";
const followUpCreatedAt = "2026-06-05T16:00:12.000Z";

function workEntry(input: Partial<WorkLogEntry> & Pick<WorkLogEntry, "id" | "createdAt">): WorkLogEntry {
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
  status: "running" | "completed";
  path?: string;
}): Extract<TimelineEntry, { kind: "runtime-tool" }> {
  return {
    kind: "runtime-tool",
    id: input.id,
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
    id: input.id,
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
    id: input.id,
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
}): Extract<TimelineEntry, { kind: "runtime-tool" }> {
  return {
    kind: "runtime-tool",
    id: input.id,
    createdAt: input.createdAt,
    tool: {
      id: input.id,
      kind: "tool",
      orderKey: `${input.createdAt}:${input.id}`,
      createdAt: input.createdAt,
      toolCallId: input.id,
      toolName: "shell",
      status: input.status,
      eventIds: [],
      display: {
        kind: "shell",
        command: "pnpm test",
        output: input.status === "running" ? "running" : "done",
      },
    },
  };
}

describe("deriveTimelineRenderItems", () => {
  it("derives message duration boundaries in the main timeline order", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "message",
          id: "message:user",
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
          id: "message:assistant",
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
          id: "message:follow-up",
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
      isWorking: false,
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

  it("groups adjacent work rows by thinking parity and precomputes group flags", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "work",
          id: "work:thinking",
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
          id: "work:command",
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
          id: "work:edit",
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
      isWorking: true,
      isTurnActive: true,
      editableUserMessageIds: new Set(),
      projectRoot: "/repo",
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: "work:thinking",
        group: expect.objectContaining({
          isThinkingGroup: true,
          isCommandGroup: false,
          summary: { action: "Thought", details: "for 2s" },
        }),
      }),
      expect.objectContaining({
        kind: "group",
        id: "work:command",
        group: expect.objectContaining({
          isThinkingGroup: false,
          isCommandGroup: false,
          completedDurationLabel: "2 seconds",
          summary: {
            action: "Edited",
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
          id: "working-indicator-row",
          createdAt: "2026-06-05T16:00:00.000Z",
          phase: "thinking",
          elapsedStartedAt: "2026-06-05T16:00:00.000Z",
        },
      ],
      isWorking: true,
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "waitingGroup",
        id: "working-indicator-row",
        createdAt: "2026-06-05T16:00:00.000Z",
      }),
    ]);
  });

  it("groups adjacent runtime thinking and runtime tool rows without committed work entries", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "runtime-thinking",
          id: "message:assistant:thinking",
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
          id: "tool:toolu-runtime",
          createdAt: "2026-06-05T16:00:02.000Z",
          tool: {
            id: "tool:toolu-runtime",
            kind: "tool",
            orderKey: "2026-06-05T16:00:02.000Z:tool:toolu-runtime",
            createdAt: "2026-06-05T16:00:02.000Z",
            toolCallId: "toolu-runtime",
            toolName: "shell",
            status: "completed",
            eventIds: [],
            args: { command: "git status --short" },
            result: { content: [{ type: "text", text: "M file.ts" }] },
            display: {
              kind: "shell",
              command: "git status --short",
              output: "M file.ts",
            },
          },
        },
        {
          kind: "runtime-tool",
          id: "tool:toolu-runtime-2",
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
              kind: "shell",
              command: "pnpm test",
              output: "running",
            },
          },
        },
      ],
      isWorking: true,
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: "message:assistant:thinking",
        group: expect.objectContaining({
          entries: [],
          isRunning: true,
          isTailGroup: true,
          summary: {
            action: "Running",
            details: "2 commands",
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

  it("emits runtime subagent tools as task rows outside generic tool groups", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "runtime-thinking",
          id: "message:assistant:thinking",
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
          id: "tool:toolu-subagent",
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
              agentScope: "project",
              projectAgentsDir: null,
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
      isWorking: true,
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: "message:assistant:thinking",
        group: expect.objectContaining({
          isThinkingGroup: true,
          summary: { action: "Thought", details: "briefly" },
        }),
      }),
      expect.objectContaining({
        kind: "single",
        id: "tool:toolu-subagent",
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
          id: "work:stale-running-command",
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
      isWorking: true,
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: "work:stale-running-command",
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
          id: "message:stale-running-assistant:thinking",
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
          id: "tool:stale-running-shell",
          createdAt: "2026-06-05T16:00:02.000Z",
          tool: {
            id: "tool:stale-running-shell",
            kind: "tool",
            orderKey: "2026-06-05T16:00:02.000Z:tool:stale-running-shell",
            createdAt: "2026-06-05T16:00:02.000Z",
            toolCallId: "toolu-stale-running-shell",
            toolName: "shell",
            status: "running",
            eventIds: [],
            display: {
              kind: "shell",
              command: "git push",
            },
          },
        },
      ],
      isWorking: true,
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: "message:stale-running-assistant:thinking",
        group: expect.objectContaining({
          completedDurationLabel: null,
          isRunning: true,
          isTailGroup: true,
          summary: {
            action: "Running",
            details: "1 command",
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
          id: "work:brief-thinking",
          createdAt: "2026-06-05T16:00:01.000Z",
          entry: workEntry({
            id: "brief-thinking",
            createdAt: "2026-06-05T16:00:01.000Z",
            completedAt: "2026-06-05T16:00:01.300Z",
            tone: "thinking",
          }),
        },
      ],
      isWorking: false,
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
          id: "work:read",
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
          id: "work:search",
          createdAt: "2026-06-05T16:00:02.000Z",
          entry: workEntry({
            id: "search",
            createdAt: "2026-06-05T16:00:02.000Z",
            itemType: "file_search",
            artifacts: [{ type: "search", matchedFiles: ["/repo/src/b.ts"] }],
          }),
        },
      ],
      isWorking: false,
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
          id: "work:delete",
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
      isWorking: false,
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
          id: "tool:browser-1",
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
          id: "tool:browser-2",
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
          id: "tool:browser-3",
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
      isWorking: false,
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
          id: "work:earlier-running",
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
          id: "message:boundary",
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
          id: "work:tail-running",
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
      isWorking: true,
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
            details: "1 command",
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
      isWorking: false,
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

  it("groups a single running shell tool", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-single",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "running",
        }),
      ],
      isWorking: true,
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
            details: "1 command",
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
      isWorking: false,
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
      isWorking: false,
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

  it("reuses a frozen tail snapshot while the turn is active", () => {
    const priorRows = deriveTimelineRenderItems({
      timelineEntries: [
        runtimeShellTool({
          id: "tool:shell-tail",
          createdAt: "2026-06-05T16:00:01.000Z",
          status: "running",
        }),
      ],
      isWorking: true,
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });
    const tailGroupSnapshot = readTailGroupSnapshot(priorRows);
    expect(tailGroupSnapshot).not.toBeNull();

    const rows = deriveTimelineRenderItems({
      timelineEntries: [],
      tailGroupSnapshot,
      isWorking: true,
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: "tool:shell-tail",
        group: expect.objectContaining({
          isRunning: true,
          isTailGroup: true,
        }),
      }),
    ]);
  });

  it("keeps runtime extension UI requests outside runtime groups", () => {
    const rows = deriveTimelineRenderItems({
      timelineEntries: [
        {
          kind: "runtime-tool",
          id: "tool:toolu-runtime",
          createdAt: "2026-06-05T16:00:02.000Z",
          tool: {
            id: "tool:toolu-runtime",
            kind: "tool",
            orderKey: "2026-06-05T16:00:02.000Z:tool:toolu-runtime",
            createdAt: "2026-06-05T16:00:02.000Z",
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
        {
          kind: "runtime-extension-ui-request",
          id: "extension-ui:request",
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
      isWorking: true,
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: "tool:toolu-runtime",
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
      isWorking: true,
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: "tool:await-1",
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
      isWorking: false,
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
      isWorking: true,
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "single",
        id: "tool:await-1",
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
      isWorking: false,
      isTurnActive: false,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: "tool:browser-1",
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
      isWorking: true,
      isTurnActive: true,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "single",
        id: "tool:browser-1",
        step: expect.objectContaining({ kind: "runtime-tool" }),
      }),
    ]);
  });
});
