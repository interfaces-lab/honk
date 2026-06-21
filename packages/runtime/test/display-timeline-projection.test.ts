import {
  EventId,
  MessageId,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  TurnId,
  type AgentRuntimeEvent,
  type DesktopExtensionUiRequest,
  type SessionTreeProjection,
} from "@honk/contracts";
import { describe, expect, it } from "vitest";
import {
  projectRuntimeDisplayTimeline,
  projectRuntimeDisplayTimelineEvent,
} from "../src/display-timeline-projection";

const threadId = ThreadId.make("thread:display-timeline");
const runtimeSessionId = RuntimeSessionId.make("runtime:display-timeline");
const turnId = TurnId.make("turn:display-timeline");
const secondTurnId = TurnId.make("turn:display-timeline-second");
const createdAt = "2026-06-05T20:30:00.000Z";

describe("runtime display timeline projection", () => {
  it("projects client-sent session user messages by client message identity", () => {
    const tree = sessionTree([
      {
        id: RuntimeItemId.make("runtime:user-entry"),
        threadEntryId: ThreadEntryId.make("thread-entry:user"),
        parentId: null,
        parentThreadEntryId: null,
        kind: "message",
        role: "user",
        clientMessageId: MessageId.make("client:first-send"),
        turnId,
        text: "Commit and push",
        createdAt,
        rawEntry: { type: "message" },
      },
      {
        id: RuntimeItemId.make("runtime:custom-entry"),
        threadEntryId: ThreadEntryId.make("thread-entry:custom"),
        parentId: RuntimeItemId.make("runtime:user-entry"),
        parentThreadEntryId: ThreadEntryId.make("thread-entry:user"),
        kind: "custom-message",
        text: "Queued branch handoff",
        createdAt: "2026-06-05T20:30:01.000Z",
        rawEntry: {
          type: "custom_message",
          customType: "git-agent-action",
          content: "Queued branch handoff",
          details: { action: "commit-push" },
          display: true,
        },
      },
      {
        id: RuntimeItemId.make("runtime:hidden-custom-entry"),
        threadEntryId: ThreadEntryId.make("thread-entry:hidden-custom"),
        parentId: RuntimeItemId.make("runtime:custom-entry"),
        parentThreadEntryId: ThreadEntryId.make("thread-entry:custom"),
        kind: "custom-message",
        createdAt: "2026-06-05T20:30:02.000Z",
        rawEntry: {
          type: "custom_message",
          customType: "internal-state",
          content: "Hidden state",
          display: false,
        },
      },
    ]);

    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      sessionTree: tree,
    });

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: "message:client:first-send",
        kind: "message",
        source: "session-entry",
        entryId: RuntimeItemId.make("runtime:user-entry"),
        role: "user",
        clientMessageId: MessageId.make("client:first-send"),
        text: "Commit and push",
      }),
    ]);
  });

  it("prunes abandoned session messages before merging edited prompt events", () => {
    const oldUserEntryId = RuntimeItemId.make("runtime:old-user-entry");
    const oldAssistantEntryId = RuntimeItemId.make("runtime:old-assistant-entry");
    const oldTree = sessionTree([
      {
        id: oldUserEntryId,
        threadEntryId: ThreadEntryId.make("message:client:old-prompt"),
        parentId: null,
        parentThreadEntryId: null,
        kind: "message",
        role: "user",
        clientMessageId: MessageId.make("client:old-prompt"),
        turnId,
        text: "old prompt",
        createdAt,
        rawEntry: { type: "message" },
      },
      {
        id: oldAssistantEntryId,
        threadEntryId: ThreadEntryId.make("message:runtime:old-assistant-entry"),
        parentId: oldUserEntryId,
        parentThreadEntryId: ThreadEntryId.make("message:client:old-prompt"),
        kind: "message",
        role: "assistant",
        turnId,
        text: "old response",
        createdAt: "2026-06-05T20:30:01.000Z",
        rawEntry: { type: "message" },
      },
    ]);
    const previousTimeline = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      sessionTree: oldTree,
    });
    const previousTimelineWithTool = {
      ...previousTimeline,
      items: [
        ...previousTimeline.items,
        {
          id: "tool:old-branch",
          kind: "tool",
          orderKey: "2026-06-05T20:30:01.500Z:tool:old-branch",
          createdAt: "2026-06-05T20:30:01.500Z",
          toolCallId: "toolu-old-branch",
          toolName: "bash",
          turnId,
          status: "completed",
          eventIds: [EventId.make("runtime-event:old-tool")],
          display: { kind: "bash", command: "echo old" },
        },
      ],
    } satisfies ReturnType<typeof projectRuntimeDisplayTimeline>;
    const currentTree: SessionTreeProjection = {
      ...oldTree,
      leafEntryId: null,
      nodes: oldTree.nodes.map((node) => ({
        ...node,
        isActivePath: false,
        isActiveLeaf: false,
      })),
    };

    const projection = projectRuntimeDisplayTimelineEvent({
      previousTimeline: previousTimelineWithTool,
      threadId,
      runtimeSessionId,
      sessionTree: currentTree,
      event: runtimeEvent({
        id: "runtime-event:edited-prompt",
        type: "message.completed",
        summary: "User message sent",
        data: { clientMessageId: "client:edited-prompt" },
        messageRole: "user",
        text: "edited prompt",
        turnId: secondTurnId,
        createdAt: "2026-06-05T20:30:02.000Z",
      }),
    });

    expect(projection.items.map((item) => (item.kind === "message" ? item.text : null))).toEqual([
      "edited prompt",
    ]);
    expect(projection.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ toolCallId: "toolu-old-branch" })]),
    );
  });

  it("collapses live tool lifecycle events by toolCallId", () => {
    const events = [
      runtimeEvent({
        id: "runtime-event:tool-started",
        type: "tool.started",
        summary: "Started bash",
        data: {
          toolCallId: "toolu-1",
          toolName: "bash",
          args: { command: "git status --short" },
        },
      }),
      runtimeEvent({
        id: "runtime-event:tool-updated",
        type: "tool.updated",
        summary: "Running bash",
        data: {
          toolCallId: "toolu-1",
          toolName: "bash",
          partialResult: { content: [{ type: "text", text: "M file.ts" }] },
        },
        createdAt: "2026-06-05T20:30:01.000Z",
      }),
      runtimeEvent({
        id: "runtime-event:tool-completed",
        type: "tool.completed",
        summary: "Completed bash",
        data: {
          toolCallId: "toolu-1",
          toolName: "bash",
          result: {
            content: [{ type: "text", text: "M file.ts" }],
            details: { exitCode: 0 },
          },
          isError: false,
        },
        createdAt: "2026-06-05T20:30:02.000Z",
      }),
    ];

    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: events,
    });

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: "tool:toolu-1",
        kind: "tool",
        toolCallId: "toolu-1",
        toolName: "bash",
        status: "completed",
        args: { command: "git status --short" },
        display: {
          kind: "bash",
          command: "git status --short",
          output: "M file.ts",
          exitCode: 0,
        },
        argsComplete: true,
        executionStarted: true,
        isPartial: false,
        isError: false,
        details: { exitCode: 0 },
        eventIds: [
          EventId.make("runtime-event:tool-started"),
          EventId.make("runtime-event:tool-updated"),
          EventId.make("runtime-event:tool-completed"),
        ],
      }),
    ]);
  });

  it("extracts a sanitized tool-call short description from args", () => {
    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: [
        runtimeEvent({
          id: "runtime-event:tool-described",
          type: "tool.started",
          summary: "Started bash",
          data: {
            toolCallId: "toolu-described",
            toolName: "bash",
            args: {
              command: "pnpm run typecheck",
              description: "  Run\n  the TypeScript checker   ",
            },
          },
        }),
      ],
    });

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: "tool:toolu-described",
        kind: "tool",
        shortDescription: "Run the TypeScript checker",
        display: {
          kind: "bash",
          command: "pnpm run typecheck",
        },
      }),
    ]);
  });

  it("ignores blank tool-call descriptions and keeps generated display details", () => {
    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: [
        runtimeEvent({
          id: "runtime-event:tool-blank-description",
          type: "tool.started",
          summary: "Started read",
          data: {
            toolCallId: "toolu-blank-description",
            toolName: "read",
            args: {
              path: "packages/runtime/src/display-timeline-projection.ts",
              description: "   ",
            },
          },
        }),
      ],
    });

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: "tool:toolu-blank-description",
        kind: "tool",
        display: {
          kind: "read",
          path: "packages/runtime/src/display-timeline-projection.ts",
        },
      }),
    ]);
    expect(projection.items[0]).not.toHaveProperty("shortDescription");
  });

  it("incrementally merges tool lifecycle events without rescanning prior events", () => {
    const events = [
      runtimeEvent({
        id: "runtime-event:tool-started",
        type: "tool.started",
        summary: "Started bash",
        data: {
          toolCallId: "toolu-incremental",
          toolName: "bash",
          args: { command: "git status --short" },
        },
      }),
      runtimeEvent({
        id: "runtime-event:tool-updated",
        type: "tool.updated",
        summary: "Running bash",
        data: {
          toolCallId: "toolu-incremental",
          toolName: "bash",
          partialResult: { content: [{ type: "text", text: "M file.ts" }] },
        },
        createdAt: "2026-06-05T20:30:01.000Z",
      }),
      runtimeEvent({
        id: "runtime-event:tool-completed",
        type: "tool.completed",
        summary: "Completed bash",
        data: {
          toolCallId: "toolu-incremental",
          toolName: "bash",
          result: {
            content: [{ type: "text", text: "M file.ts\nM second.ts" }],
            details: { exitCode: 0 },
          },
          isError: false,
        },
        createdAt: "2026-06-05T20:30:02.000Z",
      }),
    ];
    const fullProjection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: events,
    });
    const incrementalProjection = events.reduce(
      (previousTimeline, event) =>
        projectRuntimeDisplayTimelineEvent({
          previousTimeline,
          threadId,
          runtimeSessionId,
          event,
        }),
      projectRuntimeDisplayTimeline({ threadId, runtimeSessionId }),
    );

    expect(incrementalProjection).toEqual(fullProjection);
    expect(incrementalProjection.items).toEqual([
      expect.objectContaining({
        id: "tool:toolu-incremental",
        kind: "tool",
        status: "completed",
        args: { command: "git status --short" },
        command: "git status --short",
        result: {
          content: [{ type: "text", text: "M file.ts\nM second.ts" }],
          details: { exitCode: 0 },
        },
        display: {
          kind: "bash",
          command: "git status --short",
          output: "M file.ts\nM second.ts",
          exitCode: 0,
        },
        eventIds: [
          EventId.make("runtime-event:tool-started"),
          EventId.make("runtime-event:tool-updated"),
          EventId.make("runtime-event:tool-completed"),
        ],
      }),
    ]);
  });

  it("projects tool partialResult while the tool is running", () => {
    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: [
        runtimeEvent({
          id: "runtime-event:tool-updated",
          type: "tool.updated",
          summary: "Running bash",
          data: {
            toolCallId: "toolu-partial",
            toolName: "bash",
            partialResult: { content: [{ type: "text", text: "M file.ts" }] },
          },
        }),
      ],
    });

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: "tool:toolu-partial",
        kind: "tool",
        status: "running",
        result: { content: [{ type: "text", text: "M file.ts" }] },
        display: {
          kind: "bash",
          output: "M file.ts",
        },
        isPartial: true,
      }),
    ]);
  });

  it("merges repeated partial tool output chunks while streaming", () => {
    const events = [
      runtimeEvent({
        id: "runtime-event:tool-started:chunks",
        type: "tool.started",
        summary: "Started bash",
        data: {
          toolCallId: "toolu-chunks",
          toolName: "bash",
          args: { command: "git status --short" },
        },
      }),
      runtimeEvent({
        id: "runtime-event:tool-updated:chunk-1",
        type: "tool.updated",
        summary: "Running bash",
        data: {
          toolCallId: "toolu-chunks",
          toolName: "bash",
          partialResult: { content: [{ type: "text", text: "M first.ts" }] },
        },
        createdAt: "2026-06-05T20:30:01.000Z",
      }),
      runtimeEvent({
        id: "runtime-event:tool-updated:chunk-2",
        type: "tool.updated",
        summary: "Running bash",
        data: {
          toolCallId: "toolu-chunks",
          toolName: "bash",
          partialResult: { content: [{ type: "text", text: "M second.ts" }] },
        },
        createdAt: "2026-06-05T20:30:02.000Z",
      }),
    ];
    const fullProjection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: events,
    });
    const incrementalProjection = events.reduce(
      (previousTimeline, event) =>
        projectRuntimeDisplayTimelineEvent({
          previousTimeline,
          threadId,
          runtimeSessionId,
          event,
        }),
      projectRuntimeDisplayTimeline({ threadId, runtimeSessionId }),
    );

    expect(incrementalProjection).toEqual(fullProjection);
    expect(incrementalProjection.items).toEqual([
      expect.objectContaining({
        id: "tool:toolu-chunks",
        kind: "tool",
        status: "running",
        output: "M first.ts\nM second.ts",
        display: {
          kind: "bash",
          command: "git status --short",
          output: "M first.ts\nM second.ts",
        },
        isPartial: true,
      }),
    ]);
  });

  it("extracts shell commands from event data, result details, and raw command fields", () => {
    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: [
        runtimeEvent({
          id: "runtime-event:tool-command-data",
          type: "tool.completed",
          summary: "Completed bash",
          data: {
            toolCallId: "toolu-command-data",
            toolName: "bash",
            command: "pwd",
            result: { content: [{ type: "text", text: "/repo" }] },
          },
        }),
        runtimeEvent({
          id: "runtime-event:tool-command-details",
          type: "tool.completed",
          summary: "Completed bash",
          data: {
            toolCallId: "toolu-command-details",
            toolName: "bash",
            result: {
              content: [{ type: "text", text: "main" }],
              details: { command: "git branch --show-current" },
            },
          },
          createdAt: "2026-06-05T20:30:01.000Z",
        }),
        runtimeEvent({
          id: "runtime-event:tool-raw-command",
          type: "tool.completed",
          summary: "Completed bash",
          data: {
            toolCallId: "toolu-raw-command",
            toolName: "bash",
            args: { rawCommand: "git status --short" },
            result: { content: [{ type: "text", text: "M file.ts" }] },
          },
          createdAt: "2026-06-05T20:30:02.000Z",
        }),
      ],
    });

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: "tool:toolu-command-data",
        command: "pwd",
        display: expect.objectContaining({
          kind: "bash",
          command: "pwd",
        }),
      }),
      expect.objectContaining({
        id: "tool:toolu-command-details",
        command: "git branch --show-current",
        display: expect.objectContaining({
          kind: "bash",
          command: "git branch --show-current",
        }),
      }),
      expect.objectContaining({
        id: "tool:toolu-raw-command",
        command: "git status --short",
        display: expect.objectContaining({
          kind: "bash",
          command: "git status --short",
        }),
      }),
    ]);
  });

  it("projects typed read, grep, find, and edit tool display data", () => {
    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: [
        runtimeEvent({
          id: "runtime-event:read-completed",
          type: "tool.completed",
          summary: "Read file",
          data: {
            toolCallId: "toolu-read",
            toolName: "read_file",
            args: { file_path: "packages/app/src/chat.tsx", startLine: 10, endLine: 20 },
            result: { content: [{ type: "text", text: "export function Chat() {}" }] },
          },
        }),
        runtimeEvent({
          id: "runtime-event:grep-completed",
          type: "tool.completed",
          summary: "Search files",
          data: {
            toolCallId: "toolu-grep",
            toolName: "grep",
            args: { pattern: "RuntimeToolCallMessage", path: "packages/app/src" },
            result: {
              content: [{ type: "text", text: "tool-message.tsx: RuntimeToolCallMessage" }],
              details: {
                matchedFiles: ["packages/app/src/components/chat/message/tool-message.tsx"],
                totalMatched: 3,
                totalFiles: 240,
              },
            },
          },
          createdAt: "2026-06-05T20:30:01.000Z",
        }),
        runtimeEvent({
          id: "runtime-event:find-completed",
          type: "tool.completed",
          summary: "Find files",
          data: {
            toolCallId: "toolu-find",
            toolName: "find",
            args: { pattern: "tool renderer", path: "packages/app/src" },
            result: {
              content: [
                {
                  type: "text",
                  text: "packages/app/src/components/chat/message/tool-renderer.tsx",
                },
              ],
              details: {
                totalMatched: 12,
                totalFiles: 240,
                hasMore: true,
              },
            },
          },
          createdAt: "2026-06-05T20:30:02.000Z",
        }),
        runtimeEvent({
          id: "runtime-event:edit-completed",
          type: "tool.completed",
          summary: "Edit file",
          data: {
            toolCallId: "toolu-edit",
            toolName: "edit",
            args: { path: "packages/app/src/components/chat/message/tool-message.tsx" },
            result: {
              content: [{ type: "text", text: "Updated tool renderer" }],
              details: { additions: 4, deletions: 1 },
            },
          },
          createdAt: "2026-06-05T20:30:03.000Z",
        }),
      ],
    });

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: "tool:toolu-read",
        display: {
          kind: "read",
          path: "packages/app/src/chat.tsx",
          output: "export function Chat() {}",
          startLine: 10,
          endLine: 20,
        },
      }),
      expect.objectContaining({
        id: "tool:toolu-grep",
        display: {
          kind: "grep",
          query: "RuntimeToolCallMessage",
          path: "packages/app/src",
          output: "tool-message.tsx: RuntimeToolCallMessage",
          matchedFiles: ["packages/app/src/components/chat/message/tool-message.tsx"],
          totalMatched: 3,
          totalIndexedFiles: 240,
        },
      }),
      expect.objectContaining({
        id: "tool:toolu-find",
        display: {
          kind: "find",
          query: "tool renderer",
          path: "packages/app/src",
          output: "packages/app/src/components/chat/message/tool-renderer.tsx",
          totalMatched: 12,
          totalIndexedFiles: 240,
          hasMore: true,
        },
      }),
      expect.objectContaining({
        id: "tool:toolu-edit",
        display: {
          kind: "edit",
          path: "packages/app/src/components/chat/message/tool-message.tsx",
          output: "Updated tool renderer",
          additions: 4,
          deletions: 1,
        },
      }),
    ]);
  });

  it("projects the unified diff from pi-agent edit result details", () => {
    // pi-agent edit results carry details.patch (unified) and details.diff (pretty-printed
    // with line numbers); only the unified patch must surface, with stats derived from it.
    const patch = [
      "--- packages/app/src/components/chat/view/chat-view.tsx",
      "+++ packages/app/src/components/chat/view/chat-view.tsx",
      "@@ -315,4 +315,4 @@",
      '         { kind: "text", text: "Use " },',
      '-        { kind: "token", text: "Plan New Idea" },',
      '+        { kind: "token", text: "/plan" },',
      '+        { kind: "text", text: " to plan first" },',
      "",
    ].join("\n");
    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: [
        runtimeEvent({
          id: "runtime-event:edit-diff-completed",
          type: "tool.completed",
          summary: "Edit file",
          data: {
            toolCallId: "toolu-edit-diff",
            toolName: "edit",
            args: { path: "packages/app/src/components/chat/view/chat-view.tsx" },
            result: {
              content: [{ type: "text", text: "Successfully replaced 1 block(s)." }],
              details: {
                diff: "  315   tips.push({\n- 319 old\n+ 319 new",
                patch,
                firstChangedLine: 319,
              },
            },
          },
        }),
      ],
    });

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: "tool:toolu-edit-diff",
        display: {
          kind: "edit",
          path: "packages/app/src/components/chat/view/chat-view.tsx",
          output: "Successfully replaced 1 block(s).",
          additions: 2,
          deletions: 1,
          diff: patch.trim(),
        },
      }),
    ]);
  });

  it("uses apply_patch changed files as the edit display path", () => {
    const patch = [
      "diff --git a/packages/app/src/components/chat/message/tool-message.tsx b/packages/app/src/components/chat/message/tool-message.tsx",
      "--- a/packages/app/src/components/chat/message/tool-message.tsx",
      "+++ b/packages/app/src/components/chat/message/tool-message.tsx",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\n");
    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: [
        runtimeEvent({
          id: "runtime-event:apply-patch-completed",
          type: "tool.completed",
          summary: "Edited",
          data: {
            toolCallId: "toolu-apply-patch",
            toolName: "apply_patch",
            args: {
              input:
                "*** Begin Patch\n*** Update File: packages/app/src/components/chat/message/tool-message.tsx",
            },
            result: {
              content: [{ type: "text", text: "Applied patch successfully" }],
              details: {
                status: "success",
                result: {
                  changedFiles: ["packages/app/src/components/chat/message/tool-message.tsx"],
                  createdFiles: [],
                  deletedFiles: [],
                  movedFiles: [],
                  fuzz: 0,
                },
                patch,
              },
            },
          },
        }),
      ],
    });

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: "tool:toolu-apply-patch",
        display: expect.objectContaining({
          kind: "edit",
          path: "packages/app/src/components/chat/message/tool-message.tsx",
          additions: 1,
          deletions: 1,
        }),
      }),
    ]);
  });

  it("projects typed subagent tool display data", () => {
    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: [
        runtimeEvent({
          id: "runtime-event:subagent-completed",
          type: "tool.completed",
          summary: "Completed subagents",
          data: {
            toolCallId: "toolu-subagent",
            toolName: "Task",
            result: {
              content: [{ type: "text", text: "Subagents: 1/1 completed" }],
              details: {
                mode: "single",
                runs: [
                  {
                    subagentThreadId: "thread:child",
                    agentId: "agent:child",
                    nickname: "Research",
                    role: "general-purpose",
                    model: "gpt-5.5",
                    prompt: "Inspect the renderer",
                    state: "completed",
                    finalText: "Renderer reviewed",
                    errorMessage: null,
                  },
                ],
                activities: [
                  {
                    id: "runtime-subagent:toolu-subagent:thread:child:1",
                    kind: "subagent.thread.started",
                    tone: "info",
                    summary: "Started Research",
                    createdAt,
                    sequence: 1,
                    payload: {
                      subagentThreadId: "thread:child",
                      parentThreadId: threadId,
                      parentItemId: "toolu-subagent",
                      agentId: "agent:child",
                      nickname: "Research",
                      role: "general-purpose",
                      model: "gpt-5.5",
                      prompt: "Inspect the renderer",
                      state: "running",
                      itemType: null,
                      itemId: null,
                      status: null,
                      title: "Research",
                      detail: null,
                      data: null,
                    },
                  },
                ],
              },
            },
          },
        }),
      ],
    });

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: "tool:toolu-subagent",
        kind: "tool",
        display: expect.objectContaining({
          kind: "subagent",
          mode: "single",
          runs: [
            expect.objectContaining({
              subagentThreadId: "thread:child",
              nickname: "Research",
              state: "completed",
            }),
          ],
          activities: [
            expect.objectContaining({
              kind: "subagent.thread.started",
              summary: "Started Research",
            }),
          ],
        }),
      }),
    ]);
  });

  it("does not project malformed subagent details as typed subagent display", () => {
    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: [
        runtimeEvent({
          id: "runtime-event:malformed-subagent",
          type: "tool.completed",
          summary: "Malformed task",
          data: {
            toolCallId: "toolu-malformed-subagent",
            toolName: "Task",
            result: {
              content: [{ type: "text", text: "Malformed" }],
              details: {
                mode: "single",
                runs: [{ subagentThreadId: "thread:child" }],
                activities: [],
              },
            },
          },
        }),
      ],
    });

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: "tool:toolu-malformed-subagent",
        kind: "tool",
        display: expect.objectContaining({
          kind: "unknown",
          toolName: "Task",
          output: "Malformed",
        }),
      }),
    ]);
  });

  it("uses committed assistant session entries instead of stale live events", () => {
    const events = [
      runtimeEvent({
        id: "runtime-event:message-updated",
        type: "message.updated",
        summary: "Assistant message updated",
        data: {},
        text: "Streaming answer",
        messageRole: "assistant",
      }),
    ];

    const liveProjection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: events,
    });

    expect(liveProjection.items).toEqual([
      expect.objectContaining({
        id: `message:${turnId}:assistant`,
        kind: "message",
        source: "live-event",
        role: "assistant",
        text: "Streaming answer",
        streaming: true,
        eventIds: [EventId.make("runtime-event:message-updated")],
      }),
    ]);

    const committedTree = sessionTree([
      {
        id: RuntimeItemId.make("runtime:assistant-entry"),
        threadEntryId: ThreadEntryId.make("thread-entry:assistant"),
        parentId: null,
        parentThreadEntryId: null,
        kind: "message",
        role: "assistant",
        turnId,
        text: "Committed answer",
        createdAt: "2026-06-05T20:30:01.000Z",
        rawEntry: { type: "message" },
      },
    ]);
    const committedProjection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      sessionTree: committedTree,
      runtimeEvents: events,
    });

    expect(committedProjection.items).toEqual([
      expect.objectContaining({
        id: "message:runtime:assistant-entry",
        kind: "message",
        source: "session-entry",
        role: "assistant",
        text: "Committed answer",
        streaming: false,
      }),
    ]);

    const matchingCommittedTree = sessionTree([
      {
        id: RuntimeItemId.make("runtime:assistant-entry"),
        threadEntryId: ThreadEntryId.make("thread-entry:assistant"),
        parentId: null,
        parentThreadEntryId: null,
        kind: "message",
        role: "assistant",
        turnId,
        text: "Streaming answer",
        createdAt: "2026-06-05T20:30:01.000Z",
        rawEntry: { type: "message" },
      },
    ]);
    const matchingCommittedProjection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      sessionTree: matchingCommittedTree,
      runtimeEvents: events,
    });

    expect(matchingCommittedProjection.items).toEqual([
      expect.objectContaining({
        id: "message:runtime:assistant-entry",
        kind: "message",
        source: "session-entry",
        role: "assistant",
        text: "Streaming answer",
        streaming: false,
      }),
    ]);
  });

  it("lets committed assistant text replace an older streamed fragment", () => {
    const events = [
      runtimeEvent({
        id: "runtime-event:assistant-updated:partial",
        type: "message.updated",
        summary: "Assistant message updated",
        data: {},
        text: "Hi. What do you want to work on",
        messageRole: "assistant",
      }),
    ];
    const committedTree = sessionTree([
      {
        id: RuntimeItemId.make("runtime:assistant-entry:final"),
        threadEntryId: ThreadEntryId.make("thread-entry:assistant:final"),
        parentId: null,
        parentThreadEntryId: null,
        kind: "message",
        role: "assistant",
        turnId,
        text: "Hi. What do you want to work on?",
        createdAt: "2026-06-05T20:30:01.000Z",
        rawEntry: { type: "message" },
      },
    ]);

    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      sessionTree: committedTree,
      runtimeEvents: events,
    });

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: "message:runtime:assistant-entry:final",
        kind: "message",
        source: "session-entry",
        role: "assistant",
        text: "Hi. What do you want to work on?",
        streaming: false,
      }),
    ]);
  });

  it("keeps multiple live message lifecycles in the same turn separate", () => {
    const events = [
      runtimeEvent({
        id: "runtime-event:assistant-started:first",
        type: "message.started",
        summary: "Assistant message started",
        data: {},
        messageRole: "assistant",
      }),
      runtimeEvent({
        id: "runtime-event:assistant-completed:first",
        type: "message.completed",
        summary: "Assistant message completed",
        data: {},
        text: "First answer",
        messageRole: "assistant",
        createdAt: "2026-06-05T20:30:01.000Z",
      }),
      runtimeEvent({
        id: "runtime-event:assistant-started:second",
        type: "message.started",
        summary: "Assistant message started",
        data: {},
        messageRole: "assistant",
        createdAt: "2026-06-05T20:30:02.000Z",
      }),
      runtimeEvent({
        id: "runtime-event:assistant-updated:second",
        type: "message.updated",
        summary: "Assistant message updated",
        data: {},
        text: "Second answer",
        messageRole: "assistant",
        createdAt: "2026-06-05T20:30:03.000Z",
      }),
    ];
    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: events,
    });
    const incrementalProjection = events.reduce(
      (previousTimeline, event) =>
        projectRuntimeDisplayTimelineEvent({
          previousTimeline,
          threadId,
          runtimeSessionId,
          event,
        }),
      projectRuntimeDisplayTimeline({ threadId, runtimeSessionId }),
    );

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: `message:${turnId}:assistant`,
        kind: "message",
        text: "First answer",
        streaming: false,
        eventIds: [
          EventId.make("runtime-event:assistant-started:first"),
          EventId.make("runtime-event:assistant-completed:first"),
        ],
      }),
      expect.objectContaining({
        id: `message:${turnId}:assistant:2`,
        kind: "message",
        text: "Second answer",
        streaming: true,
        eventIds: [
          EventId.make("runtime-event:assistant-started:second"),
          EventId.make("runtime-event:assistant-updated:second"),
        ],
      }),
    ]);
    expect(incrementalProjection).toEqual(projection);
  });

  it("projects a pending user prompt event until the session tree commits it", () => {
    const clientMessageId = MessageId.make("client:first-send-pending");
    const events = [
      runtimeEvent({
        id: "runtime-event:user-message",
        type: "message.completed",
        summary: "User message sent",
        data: { clientMessageId },
        text: "Commit and push",
        messageRole: "user",
      }),
    ];

    const liveProjection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: events,
    });

    expect(liveProjection.items).toEqual([
      expect.objectContaining({
        id: "message:client:first-send-pending",
        kind: "message",
        source: "live-event",
        role: "user",
        text: "Commit and push",
        streaming: false,
        clientMessageId,
        eventIds: [EventId.make("runtime-event:user-message")],
      }),
    ]);

    const committedTree = sessionTree([
      {
        id: RuntimeItemId.make("runtime:user-entry"),
        threadEntryId: ThreadEntryId.make("thread-entry:user"),
        parentId: null,
        parentThreadEntryId: null,
        kind: "message",
        role: "user",
        clientMessageId,
        turnId,
        text: "Commit and push",
        createdAt: "2026-06-05T20:30:01.000Z",
        rawEntry: { type: "message" },
      },
    ]);
    const committedProjection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      sessionTree: committedTree,
      runtimeEvents: events,
    });

    expect(committedProjection.items).toEqual([
      expect.objectContaining({
        id: "message:client:first-send-pending",
        kind: "message",
        source: "session-entry",
        role: "user",
        text: "Commit and push",
        streaming: false,
        clientMessageId,
      }),
    ]);
  });

  it("merges the synthetic prompt user event with Pi's user lifecycle for the same turn", () => {
    const clientMessageId = MessageId.make("client:first-hi");
    const events = [
      runtimeEvent({
        id: "runtime-event:prompt-user-completed",
        type: "message.completed",
        summary: "User message sent",
        data: { clientMessageId },
        text: "hi",
        messageRole: "user",
      }),
      runtimeEvent({
        id: "runtime-event:pi-user-started",
        type: "message.started",
        summary: "Pi user message started",
        data: {},
        messageRole: "user",
        createdAt: "2026-06-05T20:30:00.100Z",
      }),
      runtimeEvent({
        id: "runtime-event:pi-user-completed",
        type: "message.completed",
        summary: "Pi user message completed",
        data: {},
        text: "hi",
        messageRole: "user",
        createdAt: "2026-06-05T20:30:00.200Z",
      }),
    ];

    const fullProjection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: events,
    });
    const incrementalProjection = events.reduce(
      (previousTimeline, event) =>
        projectRuntimeDisplayTimelineEvent({
          previousTimeline,
          threadId,
          runtimeSessionId,
          event,
        }),
      projectRuntimeDisplayTimeline({ threadId, runtimeSessionId }),
    );

    expect(incrementalProjection).toEqual(fullProjection);
    expect(fullProjection.items).toEqual([
      expect.objectContaining({
        id: "message:client:first-hi",
        kind: "message",
        source: "live-event",
        role: "user",
        text: "hi",
        streaming: false,
        clientMessageId,
        eventIds: [
          EventId.make("runtime-event:prompt-user-completed"),
          EventId.make("runtime-event:pi-user-started"),
          EventId.make("runtime-event:pi-user-completed"),
        ],
      }),
    ]);
  });

  it("keeps repeated identical user text separate when it belongs to separate turns", () => {
    const firstClientMessageId = MessageId.make("client:first-hi");
    const secondClientMessageId = MessageId.make("client:second-hi");

    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      runtimeEvents: [
        runtimeEvent({
          id: "runtime-event:first-user-completed",
          type: "message.completed",
          summary: "First user message sent",
          data: { clientMessageId: firstClientMessageId },
          text: "hi",
          messageRole: "user",
        }),
        runtimeEvent({
          id: "runtime-event:second-user-completed",
          type: "message.completed",
          summary: "Second user message sent",
          data: { clientMessageId: secondClientMessageId },
          text: "hi",
          messageRole: "user",
          turnId: secondTurnId,
          createdAt: "2026-06-05T20:30:02.000Z",
        }),
      ],
    });

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: "message:client:first-hi",
        role: "user",
        text: "hi",
        clientMessageId: firstClientMessageId,
      }),
      expect.objectContaining({
        id: "message:client:second-hi",
        role: "user",
        text: "hi",
        clientMessageId: secondClientMessageId,
      }),
    ]);
  });

  it("projects extension UI pending and resolved state by request id", () => {
    const request = {
      id: "extension-request-1",
      threadId,
      runtimeSessionId,
      kind: "input",
      title: "Run command?",
      message: "Allow git status?",
      placeholder: "Answer",
      options: ["Yes", "No"],
      createdAt,
    } satisfies DesktopExtensionUiRequest;
    const events = [
      runtimeEvent({
        id: "runtime-event:extension-resolved",
        type: "extension-ui.resolved",
        summary: "Answered Run command?",
        data: {
          requestId: request.id,
          requestKind: "input",
          title: request.title,
          detail: request.message,
          value: "Yes",
        },
        createdAt: "2026-06-05T20:30:02.000Z",
      }),
    ];

    const projection = projectRuntimeDisplayTimeline({
      threadId,
      runtimeSessionId,
      pendingExtensionUiRequests: [request],
      runtimeEvents: events,
    });

    expect(projection.items).toEqual([
      expect.objectContaining({
        id: "extension-ui:extension-request-1",
        kind: "extension-ui-request",
        requestId: "extension-request-1",
        requestKind: "input",
        status: "resolved",
        title: "Run command?",
        message: "Allow git status?",
        placeholder: "Answer",
        options: ["Yes", "No"],
        value: "Yes",
        eventIds: [EventId.make("runtime-event:extension-resolved")],
      }),
    ]);
  });
});

function sessionTree(entries: SessionTreeProjection["entries"]): SessionTreeProjection {
  return {
    threadId,
    runtimeSessionId,
    leafEntryId: entries.at(-1)?.id ?? null,
    entries,
    nodes: entries.map((entry, index) => ({
      entryId: entry.id,
      threadEntryId: entry.threadEntryId,
      parentEntryId: entry.parentId,
      depth: index,
      isActivePath: true,
      isActiveLeaf: index === entries.length - 1,
      childCount: index === entries.length - 1 ? 0 : 1,
    })),
  };
}

function runtimeEvent(input: {
  readonly id: string;
  readonly type: AgentRuntimeEvent["type"];
  readonly summary: string;
  readonly data: unknown;
  readonly createdAt?: string;
  readonly text?: string;
  readonly messageRole?: AgentRuntimeEvent["messageRole"];
  readonly turnId?: TurnId;
}): AgentRuntimeEvent {
  return {
    id: EventId.make(input.id),
    type: input.type,
    agentRuntime: "pi",
    threadId,
    runtimeSessionId,
    turnId: input.turnId ?? turnId,
    createdAt: input.createdAt ?? createdAt,
    summary: input.summary,
    data: input.data,
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.messageRole !== undefined ? { messageRole: input.messageRole } : {}),
  };
}
