import {
  EventId,
  OrchestrationProposedPlanId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@honk/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveWorkLogEntries,
  deriveWorkLogSubagentsFromOrderedActivities,
  findLatestProposedPlan,
} from "./session-logic";
import type { ProposedPlan } from "./types";

const createdAt = "2026-06-05T20:00:00.000Z";
const turnId = TurnId.make("turn:streaming-command");

function proposedPlan(input: {
  id: string;
  turnId: TurnId | null;
  updatedAt: string;
}): ProposedPlan {
  return {
    id: OrchestrationProposedPlanId.make(input.id),
    turnId: input.turnId,
    planMarkdown: `# ${input.id}`,
    implementedAt: null,
    implementationThreadId: null,
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt,
  };
}

describe("findLatestProposedPlan", () => {
  it("returns the newest proposed plan from the requested turn", () => {
    const requestedTurnId = TurnId.make("turn:plan-current");

    expect(
      findLatestProposedPlan(
        [
          proposedPlan({
            id: "plan:old-turn",
            turnId: TurnId.make("turn:plan-old"),
            updatedAt: "2026-06-05T20:00:00.000Z",
          }),
          proposedPlan({
            id: "plan:current-older",
            turnId: requestedTurnId,
            updatedAt: "2026-06-05T20:01:00.000Z",
          }),
          proposedPlan({
            id: "plan:current-newer",
            turnId: requestedTurnId,
            updatedAt: "2026-06-05T20:02:00.000Z",
          }),
        ],
        requestedTurnId,
      )?.id,
    ).toBe("plan:current-newer");
  });

  it("does not fall back to an older turn's proposed plan", () => {
    expect(
      findLatestProposedPlan(
        [
          proposedPlan({
            id: "plan:old-turn",
            turnId: TurnId.make("turn:plan-old"),
            updatedAt: "2026-06-05T20:00:00.000Z",
          }),
        ],
        TurnId.make("turn:normal-follow-up"),
      ),
    ).toBeNull();
  });
});

describe("deriveWorkLogEntries", () => {
  it("omits metadata-only command completion rows", () => {
    const entries = deriveWorkLogEntries(
      [
        {
          id: EventId.make("event:empty-command-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Ran command",
          turnId,
          createdAt,
          payload: {
            itemId: "tool-call-empty-command",
            itemType: "command_execution",
            status: "completed",
            title: "command",
            data: {
              toolCallId: "tool-call-empty-command",
              toolName: "bash",
              isError: false,
            },
          },
        } satisfies OrchestrationThreadActivity,
      ],
      undefined,
    );

    expect(entries).toEqual([]);
  });

  it("keeps running command output on the work entry instead of duplicating it in artifacts", () => {
    const entries = deriveWorkLogEntries(
      [
        {
          id: EventId.make("event:tool-updated"),
          kind: "tool.updated",
          tone: "tool",
          summary: "Running command",
          turnId,
          createdAt,
          payload: {
            itemId: "tool-call-1",
            itemType: "command_execution",
            detail: "Enumerating objects...\n",
            data: {
              streamKind: "command_output",
              command: "git push",
            },
          },
        } satisfies OrchestrationThreadActivity,
      ],
      undefined,
    );

    expect(entries).toEqual([
      expect.objectContaining({
        itemType: "command_execution",
        output: "Enumerating objects...",
        status: "running",
        artifacts: [
          expect.objectContaining({
            type: "command",
            command: "git push",
            isPartial: true,
          }),
        ],
      }),
    ]);
    expect(entries[0]?.artifacts?.[0]).not.toHaveProperty("output");
  });

  it("keeps command output on completed command artifacts", () => {
    const entries = deriveWorkLogEntries(
      [
        {
          id: EventId.make("event:tool-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Ran command",
          turnId,
          createdAt,
          payload: {
            itemId: "tool-call-1",
            itemType: "command_execution",
            detail: "To github.com:org/repo.git\n",
            data: {
              streamKind: "command_output",
              command: "git push",
              result: { exitCode: 0 },
            },
          },
        } satisfies OrchestrationThreadActivity,
      ],
      undefined,
    );

    expect(entries[0]).toEqual(
      expect.objectContaining({
        output: "To github.com:org/repo.git",
        status: "completed",
        artifacts: [
          expect.objectContaining({
            type: "command",
            command: "git push",
            output: "To github.com:org/repo.git",
            exitCode: 0,
          }),
        ],
      }),
    );
  });

  it("extracts a unified diff artifact from persisted pi-agent edit result details", () => {
    const patch = [
      "--- packages/app/src/components/chat/view/chat-view.tsx",
      "+++ packages/app/src/components/chat/view/chat-view.tsx",
      "@@ -315,2 +315,2 @@",
      "-old line",
      "+new line",
      "+added line",
    ].join("\n");
    const entries = deriveWorkLogEntries(
      [
        {
          id: EventId.make("event:edit-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Edited chat-view.tsx",
          turnId,
          createdAt,
          payload: {
            itemId: "tool-call-edit",
            itemType: "file_change",
            status: "completed",
            data: {
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
          },
        } satisfies OrchestrationThreadActivity,
      ],
      undefined,
    );

    expect(entries[0]?.artifacts).toEqual([
      expect.objectContaining({
        type: "diff",
        format: "unified",
        source: "result",
        files: [
          {
            path: "packages/app/src/components/chat/view/chat-view.tsx",
            additions: 2,
            deletions: 1,
          },
        ],
        unifiedDiff: patch,
      }),
    ]);
  });

  it("keeps compact persisted subagent tool rows visible without child activities", () => {
    const entries = deriveWorkLogEntries(
      [
        {
          id: EventId.make("event:subagent-tool-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Completed subagent",
          turnId,
          createdAt,
          payload: {
            itemId: "toolu-subagent",
            itemType: "collab_agent_tool_call",
            status: "completed",
            title: "subagent",
            data: {
              item: {
                tool: "subagent",
                details: {
                  runs: [
                    {
                      subagentThreadId: "thread:child",
                      agentId: "agent:child",
                      nickname: "Review",
                      role: "oracle",
                      model: "gpt-5.5",
                      prompt: "Review the code",
                      state: "completed",
                      finalText: null,
                      errorMessage: null,
                    },
                  ],
                },
              },
            },
          },
        } satisfies OrchestrationThreadActivity,
      ],
      undefined,
    );

    expect(entries).toEqual([
      expect.objectContaining({
        itemType: "collab_agent_tool_call",
        toolCallId: "toolu-subagent",
        subagents: [
          expect.objectContaining({
            subagentThreadId: "thread:child",
            nickname: "Review",
            role: "oracle",
            statusLabel: "Completed",
            isActive: false,
          }),
        ],
      }),
    ]);
  });

  it("does not infer a command from command execution detail output", () => {
    const entries = deriveWorkLogEntries(
      [
        {
          id: EventId.make("event:tool-completed-output-only"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Ran command",
          turnId,
          createdAt,
          payload: {
            itemId: "tool-call-output-only",
            itemType: "command_execution",
            detail: "M AGENTS.md M packages/app/src/session-logic.ts\n",
            data: {
              result: { exitCode: 0 },
            },
          },
        } satisfies OrchestrationThreadActivity,
      ],
      undefined,
    );

    expect(entries[0]).toEqual(
      expect.objectContaining({
        detail: "M AGENTS.md M packages/app/src/session-logic.ts",
        status: "completed",
      }),
    );
    expect(entries[0]).not.toHaveProperty("command");
    expect(entries[0]?.artifacts?.[0]).toEqual(
      expect.objectContaining({
        type: "command",
        exitCode: 0,
      }),
    );
    expect(entries[0]?.artifacts?.[0]).not.toHaveProperty("command");
  });
});

describe("deriveWorkLogSubagentsFromOrderedActivities", () => {
  it("keeps reasoning summaries at their own chronological position", () => {
    const subagentThreadId = "thread:child";
    const activities: OrchestrationThreadActivity[] = [
      {
        id: EventId.make("event:subagent-reasoning-started"),
        kind: "subagent.item.started",
        tone: "info",
        summary: "Started reasoning",
        turnId,
        sequence: 1,
        createdAt: "2026-06-05T20:00:01.000Z",
        payload: {
          subagentThreadId,
          itemId: "reasoning:item",
          itemType: "reasoning",
          status: "running",
          title: "Reasoning",
        },
      },
      {
        id: EventId.make("event:subagent-command-completed"),
        kind: "subagent.item.completed",
        tone: "info",
        summary: "Ran command",
        turnId,
        sequence: 2,
        createdAt: "2026-06-05T20:00:02.000Z",
        payload: {
          subagentThreadId,
          itemId: "command:item",
          itemType: "command_execution",
          status: "completed",
          title: "Ran command",
          detail: "command output",
          data: {
            args: { command: "pnpm typecheck" },
            result: { stdout: "command output" },
          },
        },
      },
      {
        id: EventId.make("event:subagent-reasoning-summary"),
        kind: "subagent.content.delta",
        tone: "info",
        summary: "Reasoning summary",
        turnId,
        sequence: 3,
        createdAt: "2026-06-05T20:00:03.000Z",
        payload: {
          subagentThreadId,
          itemId: "reasoning:item",
          streamKind: "reasoning_summary_text",
          summaryIndex: 0,
          delta: "summary after the command",
        },
      },
      {
        id: EventId.make("event:subagent-reasoning-completed"),
        kind: "subagent.item.completed",
        tone: "info",
        summary: "Completed reasoning",
        turnId,
        sequence: 4,
        createdAt: "2026-06-05T20:00:04.000Z",
        payload: {
          subagentThreadId,
          itemId: "reasoning:item",
          itemType: "reasoning",
          status: "completed",
          title: "Reasoning",
          detail: "summary after the command",
        },
      },
    ];

    const subagent = deriveWorkLogSubagentsFromOrderedActivities(activities, {
      includeTranscript: true,
    }).get(subagentThreadId);

    const transcriptItems = subagent?.transcriptItems;
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        id: "reasoning:item",
        itemId: "reasoning:item",
      }),
      expect.objectContaining({
        id: "command:item",
        itemId: "command:item",
        kind: "command",
      }),
      expect.objectContaining({
        itemId: "reasoning:item",
        kind: "reasoning",
        text: "summary after the command",
        loading: false,
        createdAt: "2026-06-05T20:00:03.000Z",
      }),
    ]);
    expect(transcriptItems?.[0]?.text).toBeUndefined();
  });
});
