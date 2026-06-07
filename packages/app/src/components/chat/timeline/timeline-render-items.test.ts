import { MessageId, RuntimeSessionId, ThreadId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import type { TimelineEntry, WorkLogEntry } from "../../../session-logic";
import { deriveTimelineRenderItems } from "./timeline-render-items";

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
      activeTurnStartedAt: null,
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
      activeTurnStartedAt: "2026-06-05T16:00:00.000Z",
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
          summary: { action: "Thought", details: "for 2 seconds" },
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
            details: "repo/src/app.ts, explored 1 command",
            additions: 4,
            deletions: 1,
          },
        }),
      }),
      expect.objectContaining({
        kind: "waitingGroup",
        id: "working-indicator-row",
        createdAt: "2026-06-05T16:00:00.000Z",
      }),
    ]);
  });

  it("groups adjacent runtime thinking and runtime tool rows without legacy work entries", () => {
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
      activeTurnStartedAt: null,
      editableUserMessageIds: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "group",
        id: "message:assistant:thinking",
        group: expect.objectContaining({
          entries: [],
          isRunning: true,
          summary: {
            action: "Working",
            details: "1 thought, 2 tools",
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
      activeTurnStartedAt: null,
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
      expect.objectContaining({
        kind: "waitingGroup",
        id: "working-indicator-row",
      }),
    ]);
  });
});
