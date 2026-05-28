import {
  EventId,
  MessageId,
  OrchestrationThreadActivity,
  ThreadId,
  TurnId,
} from "@multi/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  deriveActiveWorkStartedAt,
  deriveActivePlanState,
  PROVIDER_OPTIONS,
  derivePendingApprovals,
  derivePendingUserInputs,
  deriveTimelineEntries,
  deriveWorkLogEntries,
  findLatestProposedPlan,
  findSidebarProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
} from "./session-logic";

function makeActivity(overrides: {
  id?: string;
  createdAt?: string;
  kind?: OrchestrationThreadActivity["kind"];
  summary?: string;
  tone?: OrchestrationThreadActivity["tone"];
  payload?: Record<string, unknown>;
  turnId?: string;
  sequence?: number;
}): OrchestrationThreadActivity {
  const id = overrides.id ?? crypto.randomUUID();
  const kind = overrides.kind ?? "tool.started";
  const payload = withActivityPayloadDefaults(kind, overrides.payload ?? {}, id);
  return Schema.decodeUnknownSync(OrchestrationThreadActivity)({
    id: EventId.make(id),
    createdAt: overrides.createdAt ?? "2026-02-23T00:00:00.000Z",
    kind,
    summary: overrides.summary ?? "Tool call",
    tone: overrides.tone ?? "tool",
    payload,
    turnId: overrides.turnId ? TurnId.make(overrides.turnId) : null,
    ...(overrides.sequence !== undefined ? { sequence: overrides.sequence } : {}),
  });
}

function withActivityPayloadDefaults(
  kind: OrchestrationThreadActivity["kind"],
  payload: Record<string, unknown>,
  activityId: string,
): Record<string, unknown> {
  switch (kind) {
    case "task.started":
      return { taskId: activityId, ...payload };
    case "task.progress":
      return {
        taskId: activityId,
        detail: typeof payload.summary === "string" ? payload.summary : "Task progress",
        ...payload,
      };
    case "task.completed":
      return { taskId: activityId, status: "completed", ...payload };
    case "context-window.updated":
      return { usedTokens: 0, ...payload };
    case "context-compaction":
      return { state: "compacted", ...payload };
    default:
      return payload;
  }
}

describe("derivePendingApprovals", () => {
  it("tracks open approvals and removes resolved ones", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-1",
          requestKind: "command",
          detail: "bun run lint",
        },
      }),
      makeActivity({
        id: "approval-close",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "approval.resolved",
        summary: "Approval resolved",
        tone: "info",
        payload: { requestId: "req-2" },
      }),
      makeActivity({
        id: "approval-closed-request",
        createdAt: "2026-02-23T00:00:01.500Z",
        kind: "approval.requested",
        summary: "File-change approval requested",
        tone: "approval",
        payload: { requestId: "req-2", requestKind: "file-change" },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: "req-1",
        requestKind: "command",
        createdAt: "2026-02-23T00:00:01.000Z",
        detail: "bun run lint",
      },
    ]);
  });

  it("maps canonical requestType payloads into pending approvals", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open-request-type",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-request-type",
          requestType: "command_execution_approval",
          detail: "pwd",
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: "req-request-type",
        requestKind: "command",
        createdAt: "2026-02-23T00:00:01.000Z",
        detail: "pwd",
      },
    ]);
  });

  it("maps expanded Codex requestType payloads into pending approvals", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open-permissions",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Permissions approval requested",
        tone: "approval",
        payload: {
          requestId: "req-permissions",
          requestType: "permissions_approval",
          detail: "Allow network access",
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: "req-permissions",
        requestKind: "permissions",
        createdAt: "2026-02-23T00:00:01.000Z",
        detail: "Allow network access",
      },
    ]);
  });

  it("clears stale pending approvals when provider reports unknown pending request", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open-stale",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-stale-1",
          requestKind: "command",
        },
      }),
      makeActivity({
        id: "approval-failed-stale",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        tone: "error",
        payload: {
          requestId: "req-stale-1",
          detail: "Unknown pending permission request: req-stale-1",
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([]);
  });

  it("clears stale pending approvals when the backend marks them stale after restart", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open-stale-restart",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-stale-restart-1",
          requestKind: "command",
        },
      }),
      makeActivity({
        id: "approval-failed-stale-restart",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        tone: "error",
        payload: {
          requestId: "req-stale-restart-1",
          detail:
            "Stale pending approval request: req-stale-restart-1. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.",
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([]);
  });

  it("limits open approvals to the active turn when provided", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open-old-turn",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        turnId: "turn-old",
        payload: {
          requestId: "req-old-turn",
          requestKind: "command",
          detail: "old command",
        },
      }),
      makeActivity({
        id: "approval-open-current-turn",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        turnId: "turn-current",
        payload: {
          requestId: "req-current-turn",
          requestKind: "command",
          detail: "current command",
        },
      }),
    ];

    expect(derivePendingApprovals(activities, TurnId.make("turn-current"))).toEqual([
      {
        requestId: "req-current-turn",
        requestKind: "command",
        createdAt: "2026-02-23T00:00:02.000Z",
        detail: "current command",
      },
    ]);
    expect(derivePendingApprovals(activities, null)).toEqual([]);
  });
});

describe("derivePendingUserInputs", () => {
  it("tracks open structured prompts and removes resolved ones", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "user-input-open",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "user-input.requested",
        summary: "User input requested",
        tone: "info",
        payload: {
          requestId: "req-user-input-1",
          questions: [
            {
              id: "sandbox_mode",
              header: "Sandbox",
              question: "Which mode should be used?",
              options: [
                {
                  label: "project-write",
                  description: "Allow project writes only",
                },
              ],
              multiSelect: true,
            },
          ],
        },
      }),
      makeActivity({
        id: "user-input-resolved",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "user-input.resolved",
        summary: "User input submitted",
        tone: "info",
        payload: {
          requestId: "req-user-input-2",
          answers: {
            sandbox_mode: "project-write",
          },
        },
      }),
      makeActivity({
        id: "user-input-open-2",
        createdAt: "2026-02-23T00:00:01.500Z",
        kind: "user-input.requested",
        summary: "User input requested",
        tone: "info",
        payload: {
          requestId: "req-user-input-2",
          questions: [
            {
              id: "approval",
              header: "Approval",
              question: "Continue?",
              options: [
                {
                  label: "yes",
                  description: "Continue execution",
                },
              ],
              multiSelect: false,
            },
          ],
        },
      }),
    ];

    expect(derivePendingUserInputs(activities)).toEqual([
      {
        requestId: "req-user-input-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        questions: [
          {
            id: "sandbox_mode",
            header: "Sandbox",
            question: "Which mode should be used?",
            options: [
              {
                label: "project-write",
                description: "Allow project writes only",
              },
            ],
            multiSelect: true,
          },
        ],
      },
    ]);
  });

  it("limits open structured prompts to the active turn when provided", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "user-input-open-old-turn",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "user-input.requested",
        summary: "User input requested",
        tone: "info",
        turnId: "turn-old",
        payload: {
          requestId: "req-user-input-old-turn",
          questions: [
            {
              id: "surface",
              header: "Surface",
              question: "Which surface?",
              options: [
                {
                  label: "Old",
                  description: "Old turn option",
                },
              ],
              multiSelect: false,
            },
          ],
        },
      }),
      makeActivity({
        id: "user-input-open-current-turn",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "user-input.requested",
        summary: "User input requested",
        tone: "info",
        turnId: "turn-current",
        payload: {
          requestId: "req-user-input-current-turn",
          questions: [
            {
              id: "surface",
              header: "Surface",
              question: "Which surface?",
              options: [
                {
                  label: "Current",
                  description: "Current turn option",
                },
              ],
              multiSelect: false,
            },
          ],
        },
      }),
    ];

    expect(derivePendingUserInputs(activities, TurnId.make("turn-current"))).toEqual([
      {
        requestId: "req-user-input-current-turn",
        createdAt: "2026-02-23T00:00:02.000Z",
        questions: [
          {
            id: "surface",
            header: "Surface",
            question: "Which surface?",
            options: [
              {
                label: "Current",
                description: "Current turn option",
              },
            ],
            multiSelect: false,
          },
        ],
      },
    ]);
    expect(derivePendingUserInputs(activities, null)).toEqual([]);
  });

  it("clears stale pending user-input prompts when the provider reports an orphaned request", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "user-input-open-stale",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "user-input.requested",
        summary: "User input requested",
        tone: "info",
        payload: {
          requestId: "req-user-input-stale-1",
          questions: [
            {
              id: "sandbox_mode",
              header: "Sandbox",
              question: "Which mode should be used?",
              options: [
                {
                  label: "project-write",
                  description: "Allow project writes only",
                },
              ],
              multiSelect: false,
            },
          ],
        },
      }),
      makeActivity({
        id: "user-input-failed-stale",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "provider.user-input.respond.failed",
        summary: "Provider user input response failed",
        tone: "error",
        payload: {
          requestId: "req-user-input-stale-1",
          detail:
            "Stale pending user-input request: req-user-input-stale-1. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.",
        },
      }),
    ];

    expect(derivePendingUserInputs(activities)).toEqual([]);
  });
});

describe("deriveActivePlanState", () => {
  it("returns the latest plan update for the active turn", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-old",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          explanation: "Initial plan",
          plan: [{ step: "Inspect code", status: "pending" }],
        },
      }),
      makeActivity({
        id: "plan-latest",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          explanation: "Refined plan",
          plan: [{ step: "Implement Codex user input", status: "inProgress" }],
        },
      }),
    ];

    expect(deriveActivePlanState(activities, TurnId.make("turn-1"))).toEqual({
      createdAt: "2026-02-23T00:00:02.000Z",
      turnId: "turn-1",
      explanation: "Refined plan",
      steps: [{ step: "Implement Codex user input", status: "inProgress" }],
    });
  });

  it("falls back to the most recent plan from a previous turn", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-from-turn-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          plan: [{ step: "Write tests", status: "completed" }],
        },
      }),
    ];

    // turn-2 has no plan activity, so the previous turn's plan remains current.
    const result = deriveActivePlanState(activities, TurnId.make("turn-2"));
    expect(result).toEqual({
      createdAt: "2026-02-23T00:00:01.000Z",
      turnId: "turn-1",
      steps: [{ step: "Write tests", status: "completed" }],
    });
  });
});

describe("findLatestProposedPlan", () => {
  it("prefers the latest proposed plan for the active turn", () => {
    expect(
      findLatestProposedPlan(
        [
          {
            id: "plan:thread-1:turn:turn-1",
            turnId: TurnId.make("turn-1"),
            planMarkdown: "# Older",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-23T00:00:01.000Z",
            updatedAt: "2026-02-23T00:00:01.000Z",
          },
          {
            id: "plan:thread-1:turn:turn-1",
            turnId: TurnId.make("turn-1"),
            planMarkdown: "# Latest",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-23T00:00:01.000Z",
            updatedAt: "2026-02-23T00:00:02.000Z",
          },
          {
            id: "plan:thread-1:turn:turn-2",
            turnId: TurnId.make("turn-2"),
            planMarkdown: "# Different turn",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-23T00:00:03.000Z",
            updatedAt: "2026-02-23T00:00:03.000Z",
          },
        ],
        TurnId.make("turn-1"),
      ),
    ).toEqual({
      id: "plan:thread-1:turn:turn-1",
      turnId: "turn-1",
      planMarkdown: "# Latest",
      implementedAt: null,
      implementationThreadId: null,
      createdAt: "2026-02-23T00:00:01.000Z",
      updatedAt: "2026-02-23T00:00:02.000Z",
    });
  });

  it("falls back to the most recently updated proposed plan", () => {
    const latestPlan = findLatestProposedPlan(
      [
        {
          id: "plan:thread-1:turn:turn-1",
          turnId: TurnId.make("turn-1"),
          planMarkdown: "# First",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-02-23T00:00:01.000Z",
          updatedAt: "2026-02-23T00:00:01.000Z",
        },
        {
          id: "plan:thread-1:turn:turn-2",
          turnId: TurnId.make("turn-2"),
          planMarkdown: "# Latest",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-02-23T00:00:02.000Z",
          updatedAt: "2026-02-23T00:00:03.000Z",
        },
      ],
      null,
    );

    expect(latestPlan?.planMarkdown).toBe("# Latest");
  });
});

describe("hasActionableProposedPlan", () => {
  it("returns true for an unimplemented proposed plan", () => {
    expect(
      hasActionableProposedPlan({
        id: "plan-1",
        turnId: TurnId.make("turn-1"),
        planMarkdown: "# Plan",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-02-23T00:00:00.000Z",
        updatedAt: "2026-02-23T00:00:01.000Z",
      }),
    ).toBe(true);
  });

  it("returns false for a proposed plan already implemented elsewhere", () => {
    expect(
      hasActionableProposedPlan({
        id: "plan-1",
        turnId: TurnId.make("turn-1"),
        planMarkdown: "# Plan",
        implementedAt: "2026-02-23T00:00:02.000Z",
        implementationThreadId: ThreadId.make("thread-implement"),
        createdAt: "2026-02-23T00:00:00.000Z",
        updatedAt: "2026-02-23T00:00:02.000Z",
      }),
    ).toBe(false);
  });
});

describe("findSidebarProposedPlan", () => {
  it("prefers the running turn source proposed plan when available on the same thread", () => {
    expect(
      findSidebarProposedPlan({
        threads: [
          {
            id: ThreadId.make("thread-1"),
            proposedPlans: [
              {
                id: "plan-1",
                turnId: TurnId.make("turn-plan"),
                planMarkdown: "# Source plan",
                implementedAt: "2026-02-23T00:00:03.000Z",
                implementationThreadId: ThreadId.make("thread-2"),
                createdAt: "2026-02-23T00:00:01.000Z",
                updatedAt: "2026-02-23T00:00:02.000Z",
              },
            ],
          },
          {
            id: ThreadId.make("thread-2"),
            proposedPlans: [
              {
                id: "plan-2",
                turnId: TurnId.make("turn-other"),
                planMarkdown: "# Latest elsewhere",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: "2026-02-23T00:00:04.000Z",
                updatedAt: "2026-02-23T00:00:05.000Z",
              },
            ],
          },
        ],
        latestTurn: {
          turnId: TurnId.make("turn-implementation"),
          sourceProposedPlan: {
            threadId: ThreadId.make("thread-1"),
            planId: "plan-1",
          },
        },
        latestTurnSettled: false,
        threadId: ThreadId.make("thread-1"),
      }),
    ).toEqual({
      id: "plan-1",
      turnId: "turn-plan",
      planMarkdown: "# Source plan",
      implementedAt: "2026-02-23T00:00:03.000Z",
      implementationThreadId: "thread-2",
      createdAt: "2026-02-23T00:00:01.000Z",
      updatedAt: "2026-02-23T00:00:02.000Z",
    });
  });

  it("falls back to the latest proposed plan once the turn is settled", () => {
    expect(
      findSidebarProposedPlan({
        threads: [
          {
            id: ThreadId.make("thread-1"),
            proposedPlans: [
              {
                id: "plan-1",
                turnId: TurnId.make("turn-plan"),
                planMarkdown: "# Older",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: "2026-02-23T00:00:01.000Z",
                updatedAt: "2026-02-23T00:00:02.000Z",
              },
              {
                id: "plan-2",
                turnId: TurnId.make("turn-latest"),
                planMarkdown: "# Latest",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: "2026-02-23T00:00:03.000Z",
                updatedAt: "2026-02-23T00:00:04.000Z",
              },
            ],
          },
        ],
        latestTurn: {
          turnId: TurnId.make("turn-implementation"),
          sourceProposedPlan: {
            threadId: ThreadId.make("thread-1"),
            planId: "plan-1",
          },
        },
        latestTurnSettled: true,
        threadId: ThreadId.make("thread-1"),
      })?.planMarkdown,
    ).toBe("# Latest");
  });
});

describe("deriveWorkLogEntries", () => {
  it("keeps tool started entries before completed entries", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
      makeActivity({
        id: "tool-start",
        createdAt: "2026-02-23T00:00:02.000Z",
        summary: "Tool call",
        kind: "tool.started",
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual(["tool-start", "tool-complete"]);
    expect(entries.map((entry) => entry.status)).toEqual(["running", "completed"]);
  });

  it("keeps task.started, task.progress, and task.completed", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "task-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "task.started",
        summary: "default task started",
        tone: "info",
      }),
      makeActivity({
        id: "task-progress",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "task.progress",
        summary: "Updating files",
        tone: "info",
      }),
      makeActivity({
        id: "task-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "task.completed",
        summary: "Task completed",
        tone: "info",
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual([
      "task:task-start",
      "task:task-progress",
      "task:task-complete",
    ]);
    expect(entries.map((entry) => entry.status)).toEqual(["running", "running", "completed"]);
  });

  it("uses payload summary as label for task entries when available", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "task-progress-with-summary",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "task.progress",
        summary: "Reasoning update",
        tone: "info",
        payload: { summary: "Searching for API endpoints" },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries[0]?.label).toBe("Searching for API endpoints");
  });

  it("uses payload detail as label for task.completed and preserves error tone", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "task-completed-failed",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "task.completed",
        summary: "Task failed",
        tone: "error",
        payload: { detail: "Failed to deploy changes" },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries[0]?.label).toBe("Failed to deploy changes");
    expect(entries[0]?.tone).toBe("error");
  });

  it("keeps the meaningful task label when completion uses a generic label", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "subagent-task",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "task.started",
        summary: "Subagent task",
        payload: {
          taskId: "task-1",
          detail: "Inspect the repo",
        },
      }),
      makeActivity({
        id: "subagent-task-completed",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "task.completed",
        summary: "Completed task",
        payload: {
          taskId: "task-1",
          status: "completed",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      label: "Inspect the repo",
      status: "completed",
    });
  });

  it("filters by turn id when provided", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({ id: "turn-1", turnId: "turn-1", summary: "Tool call", kind: "tool.started" }),
      makeActivity({
        id: "turn-2",
        turnId: "turn-2",
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
      makeActivity({ id: "no-turn", summary: "Checkpoint captured", tone: "info" }),
    ];

    const entries = deriveWorkLogEntries(activities, TurnId.make("turn-2"));
    expect(entries.map((entry) => entry.id)).toEqual(["turn-2"]);
  });

  it("omits checkpoint captured info entries", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "checkpoint",
        createdAt: "2026-02-23T00:00:01.000Z",
        summary: "Checkpoint captured",
        tone: "info",
      }),
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        summary: "Ran command",
        tone: "tool",
        kind: "tool.completed",
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual(["tool-complete"]);
  });

  it("omits ExitPlanMode lifecycle entries once the plan card is shown", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "exit-plan-updated",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          detail: 'ExitPlanMode: {"allowedPrompts":[{"tool":"Bash","prompt":"run tests"}]}',
        },
      }),
      makeActivity({
        id: "exit-plan-completed",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Tool call",
        payload: {
          detail: "ExitPlanMode: {}",
        },
      }),
      makeActivity({
        id: "real-work-log",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          detail: "Bash: bun test",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual(["real-work-log"]);
  });

  it("preserves tool summary rows separately from matching command lifecycle rows", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Ran command",
        payload: {
          itemId: "command-1",
          itemType: "command_execution",
          detail: "pnpm test",
          data: {
            item: {
              command: ["pnpm", "test"],
            },
          },
        },
      }),
      makeActivity({
        id: "command-summary",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.summary",
        summary: "1 test passed",
        payload: {
          summary: "1 test passed",
          precedingToolUseIds: ["command-1"],
        },
      }),
      makeActivity({
        id: "command-completed",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemId: "command-1",
          itemType: "command_execution",
          detail: "pnpm test",
          data: {
            item: {
              command: ["pnpm", "test"],
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: "tool:command-1",
      label: "Ran command",
      status: "completed",
      command: "pnpm test",
    });
    expect(entries[1]).toMatchObject({
      id: "command-summary",
      label: "1 test passed",
      isToolSummary: true,
    });
  });

  it("omits generic tool summary rows that duplicate command lifecycle rows", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Ran command",
        payload: {
          itemId: "command-1",
          itemType: "command_execution",
          detail: "pnpm test",
          data: {
            item: {
              command: ["pnpm", "test"],
            },
          },
        },
      }),
      makeActivity({
        id: "command-summary",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.summary",
        summary: "Ran command",
        payload: {
          summary: "Ran command",
          precedingToolUseIds: ["command-1"],
        },
      }),
      makeActivity({
        id: "command-completed",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemId: "command-1",
          itemType: "command_execution",
          detail: "pnpm test",
          data: {
            item: {
              command: ["pnpm", "test"],
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "tool:command-1",
      label: "Ran command",
      status: "completed",
      command: "pnpm test",
    });
  });

  it("collapses streamed subagent lifecycle rows and keeps completed assistant text intact", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "spawn-subagent",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.completed",
        summary: "Subagent",
        payload: {
          itemId: "call-subagent",
          itemType: "collab_agent_tool_call",
          detail: "Inspect the repo",
          data: {
            item: {
              tool: "spawnAgent",
              receiverThreadIds: ["subagent-thread-1"],
              agentsStates: {
                "subagent-thread-1": {
                  status: "completed",
                },
              },
            },
          },
        },
      }),
      makeActivity({
        id: "subagent-thread-started",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "subagent.thread.started",
        summary: "Subagent thread started",
        payload: {
          providerThreadId: "subagent-thread-1",
          parentItemId: "call-subagent",
          role: "explorer",
        },
      }),
      makeActivity({
        id: "subagent-command-start",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "subagent.item.started",
        summary: "Ran command",
        payload: {
          providerThreadId: "subagent-thread-1",
          parentItemId: "call-subagent",
          itemId: "command-1",
          itemType: "command_execution",
          title: "Ran command",
          detail: "pnpm test",
          data: {
            item: {
              command: ["pnpm", "test"],
            },
          },
        },
      }),
      makeActivity({
        id: "subagent-command-completed",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "subagent.item.completed",
        summary: "Ran command",
        payload: {
          providerThreadId: "subagent-thread-1",
          parentItemId: "call-subagent",
          itemId: "command-1",
          itemType: "command_execution",
          title: "Ran command",
          status: "completed",
          detail: "pnpm test",
          data: {
            item: {
              command: ["pnpm", "test"],
              result: {
                content: "ok <exited with exit code 0>",
              },
            },
          },
        },
      }),
      makeActivity({
        id: "subagent-assistant-delta",
        createdAt: "2026-02-23T00:00:05.000Z",
        kind: "subagent.content.delta",
        summary: "Output",
        payload: {
          providerThreadId: "subagent-thread-1",
          parentItemId: "call-subagent",
          itemId: "assistant-final",
          streamKind: "assistant_text",
          delta: "Multi is a pnpm/Turbo TypeScript monorepo",
        },
      }),
      makeActivity({
        id: "subagent-assistant-completed",
        createdAt: "2026-02-23T00:00:06.000Z",
        kind: "subagent.item.completed",
        summary: "Assistant message",
        payload: {
          providerThreadId: "subagent-thread-1",
          parentItemId: "call-subagent",
          itemId: "assistant-final",
          itemType: "assistant_message",
          title: "Assistant message",
          status: "completed",
          detail:
            "Multi is a pnpm/Turbo TypeScript monorepo for a desktop coding-agent app. The final sentence stays visible.",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    const transcriptItems = entries[0]?.subagents?.[0]?.transcriptItems ?? [];
    const commandItems = transcriptItems.filter((item) => item.itemId === "command-1");
    const finalAssistant = transcriptItems.find((item) => item.itemId === "assistant-final");

    expect(entries).toHaveLength(1);
    expect(commandItems).toHaveLength(1);
    expect(commandItems[0]).toMatchObject({
      kind: "command",
      command: "pnpm test",
      output: "ok",
      loading: false,
    });
    expect(finalAssistant).toMatchObject({
      kind: "message",
      role: "assistant",
      loading: false,
    });
    expect(finalAssistant?.text).toContain("The final sentence stays visible.");
  });

  it("does not replace streamed subagent assistant text with shorter completed detail", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "parent-task-tool",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Subagent task started",
        payload: {
          itemId: "tool-task-1",
          itemType: "collab_agent_tool_call",
          title: "Subagent task",
          detail: "Review the repo",
        },
      }),
      makeActivity({
        id: "subagent-thread",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "subagent.thread.started",
        summary: "Subagent thread started",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
        },
      }),
      makeActivity({
        id: "subagent-message-delta",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "subagent.content.delta",
        summary: "Subagent output",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "subagent-message-1",
          streamKind: "assistant_text",
          delta:
            "Multi is a pnpm/Turbo TypeScript monorepo for a desktop coding-agent app. The final sentence remains visible.",
        },
      }),
      makeActivity({
        id: "subagent-message-completed",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "subagent.item.completed",
        summary: "Assistant message",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "subagent-message-1",
          itemType: "assistant_message",
          status: "completed",
          title: "Assistant message",
          detail: "Multi is a pnpm/Turbo TypeScript monorepo...",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    const finalAssistant = entries[0]?.subagents?.[0]?.transcriptItems?.find(
      (item) => item.itemId === "subagent-message-1",
    );

    expect(finalAssistant).toMatchObject({
      kind: "message",
      role: "assistant",
      loading: false,
    });
    expect(finalAssistant?.text).toContain("The final sentence remains visible.");
    expect(finalAssistant?.text).not.toBe("Multi is a pnpm/Turbo TypeScript monorepo...");
  });

  it("orders work log by activity sequence when present", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "second",
        createdAt: "2026-02-23T00:00:03.000Z",
        sequence: 2,
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
      makeActivity({
        id: "first",
        createdAt: "2026-02-23T00:00:04.000Z",
        sequence: 1,
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    expect(entries.map((entry) => entry.id)).toEqual(["first", "second"]);
  });

  it("extracts command text for command tool activities", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: ["bun", "run", "lint"],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.command).toBe("bun run lint");
  });

  it("unwraps PowerShell command wrappers for displayed command text", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-windows-wrapper",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command 'bun run lint'",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.command).toBe("bun run lint");
    expect(entry?.rawCommand).toBe(
      "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command 'bun run lint'",
    );
  });

  it("unwraps PowerShell command wrappers from argv-style command payloads", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-windows-wrapper-argv",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "-Command", "rg -n foo ."],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.command).toBe("rg -n foo .");
    expect(entry?.rawCommand).toBe(
      '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "rg -n foo ."',
    );
  });

  it("extracts command text from command detail when structured command metadata is missing", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-windows-detail-fallback",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          detail:
            '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -Command \'rg -n -F "new Date()" .\' <exited with exit code 0>',
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.command).toBe('rg -n -F "new Date()" .');
    expect(entry?.rawCommand).toBe(
      `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -Command 'rg -n -F "new Date()" .'`,
    );
  });

  it("does not unwrap shell commands when no wrapper flag is present", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-shell-script",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: "bash script.sh",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.command).toBe("bash script.sh");
    expect(entry?.rawCommand).toBeUndefined();
  });

  it("keeps compact Codex tool metadata used for icons and labels", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-with-metadata",
        kind: "tool.completed",
        summary: "bash",
        payload: {
          itemType: "command_execution",
          title: "bash",
          status: "completed",
          detail: '{ "dev": "vite dev --port 3000" } <exited with exit code 0>',
          data: {
            item: {
              command: ["bun", "run", "dev"],
              result: {
                content: '{ "dev": "vite dev --port 3000" } <exited with exit code 0>',
                exitCode: 0,
              },
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry).toMatchObject({
      command: "bun run dev",
      output: '{ "dev": "vite dev --port 3000" }',
      itemType: "command_execution",
      toolTitle: "bash",
    });
  });

  it("falls back to structured tool result content when detail is missing", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-with-structured-result-only",
        kind: "tool.completed",
        summary: "bash",
        payload: {
          itemType: "command_execution",
          title: "bash",
          status: "completed",
          data: {
            item: {
              command: ["/bin/zsh", "-lc", "sed -n '1,220p' CONTEXT.md"],
              result: {
                content: "first line\nsecond line <exited with exit code 0>",
                exitCode: 0,
              },
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry).toMatchObject({
      command: "sed -n '1,220p' CONTEXT.md",
      output: "first line\nsecond line",
      rawCommand: "/bin/zsh -lc \"sed -n '1,220p' CONTEXT.md\"",
      itemType: "command_execution",
      toolTitle: "bash",
    });
  });

  it("extracts changed file paths for file-change tool activities", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "file-tool",
        kind: "tool.completed",
        summary: "File change",
        payload: {
          itemType: "file_change",
          data: {
            item: {
              changes: [
                { path: "packages/app/src/components/chat-view.tsx" },
                { filename: "packages/app/src/session-logic.ts" },
              ],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry?.changedFiles).toEqual([
      "packages/app/src/components/chat-view.tsx",
      "packages/app/src/session-logic.ts",
    ]);
  });

  it("collapses repeated lifecycle updates for the same tool call into one entry", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-update-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemId: "tool-1",
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-update-2",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemId: "tool-1",
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
          data: {
            item: {
              command: ["sed", "-n", "1,40p", "/tmp/app.ts"],
            },
          },
        },
      }),
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Tool call completed",
        payload: {
          itemId: "tool-1",
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "tool:tool-1",
      createdAt: "2026-02-23T00:00:01.000Z",
      label: "Tool call completed",
      detail: 'Read: {"file_path":"/tmp/app.ts"}',
      command: "sed -n 1,40p /tmp/app.ts",
      itemType: "dynamic_tool_call",
      toolTitle: "Tool call",
    });
  });

  it("collapses interleaved lifecycle updates for active command tool calls", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-1-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Ran command started",
        payload: {
          itemId: "command-1",
          itemType: "command_execution",
          title: "Ran command",
          detail: "sed -n '1,100p' packages/server/src/orchestration/Normalizer.ts",
        },
      }),
      makeActivity({
        id: "command-2-start",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.started",
        summary: "Ran command started",
        payload: {
          itemId: "command-2",
          itemType: "command_execution",
          title: "Ran command",
          detail: "sed -n '1,130p' packages/server/src/orchestration/OrchestrationEngine.ts",
        },
      }),
      makeActivity({
        id: "command-2-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemId: "command-2",
          itemType: "command_execution",
          title: "Ran command",
          detail: "sed -n '1,130p' packages/server/src/orchestration/OrchestrationEngine.ts",
        },
      }),
      makeActivity({
        id: "command-1-complete",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemId: "command-1",
          itemType: "command_execution",
          title: "Ran command",
          detail: "sed -n '1,100p' packages/server/src/orchestration/Normalizer.ts",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.id)).toEqual(["tool:command-1", "tool:command-2"]);
    expect(entries.map((entry) => entry.createdAt)).toEqual([
      "2026-02-23T00:00:01.000Z",
      "2026-02-23T00:00:02.000Z",
    ]);
    expect(entries.map((entry) => entry.status)).toEqual(["completed", "completed"]);
    expect(entries.map((entry) => entry.command)).toEqual([
      "sed -n '1,100p' packages/server/src/orchestration/Normalizer.ts",
      "sed -n '1,130p' packages/server/src/orchestration/OrchestrationEngine.ts",
    ]);
  });

  it("keeps separate tool entries when an identical call starts after the prior one completed", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-1-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemId: "tool-1",
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-1-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Tool call completed",
        payload: {
          itemId: "tool-1",
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-2-update",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemId: "tool-2",
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-2-complete",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "tool.completed",
        summary: "Tool call completed",
        payload: {
          itemId: "tool-2",
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries.map((entry) => entry.id)).toEqual(["tool:tool-1", "tool:tool-2"]);
  });

  it("scopes stable lifecycle row ids by turn id", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "turn-1-command-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Ran command started",
        turnId: "turn-1",
        payload: {
          itemId: "command-1",
          itemType: "command_execution",
          title: "Ran command",
          detail: "pnpm lint",
        },
      }),
      makeActivity({
        id: "turn-1-command-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        turnId: "turn-1",
        payload: {
          itemId: "command-1",
          itemType: "command_execution",
          title: "Ran command",
          detail: "pnpm lint",
        },
      }),
      makeActivity({
        id: "turn-2-command-start",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.started",
        summary: "Ran command started",
        turnId: "turn-2",
        payload: {
          itemId: "command-1",
          itemType: "command_execution",
          title: "Ran command",
          detail: "pnpm test",
        },
      }),
      makeActivity({
        id: "turn-2-command-complete",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        turnId: "turn-2",
        payload: {
          itemId: "command-1",
          itemType: "command_execution",
          title: "Ran command",
          detail: "pnpm test",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries.map((entry) => entry.id)).toEqual([
      "tool:turn-1:command-1",
      "tool:turn-2:command-1",
    ]);
    expect(entries.map((entry) => entry.command)).toEqual(["pnpm lint", "pnpm test"]);
  });

  it("collapses a tool lifecycle when one event is missing its turn id", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Ran command",
        turnId: "turn-1",
        payload: {
          itemId: "command-1",
          itemType: "command_execution",
          title: "Ran command",
          detail: "pnpm run typecheck",
        },
      }),
      makeActivity({
        id: "command-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemId: "command-1",
          itemType: "command_execution",
          title: "Ran command",
          detail: "pnpm run typecheck",
          data: {
            result: {
              stdout: "typecheck passed\n",
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "tool:turn-1:command-1",
      toolCallId: "command-1",
      command: "pnpm run typecheck",
      output: "typecheck passed",
      status: "completed",
    });
  });

  it("collapses tool lifecycle rows when the provider omitted itemId", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Ran command",
        turnId: "turn-1",
        payload: {
          itemType: "command_execution",
          title: "Ran command",
          detail: "pnpm run typecheck",
        },
      }),
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        turnId: "turn-1",
        payload: {
          itemType: "command_execution",
          title: "Ran command",
          detail: "pnpm run typecheck",
          data: {
            result: {
              stdout: "typecheck passed\n",
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      command: "pnpm run typecheck",
      output: "typecheck passed",
      status: "completed",
      itemType: "command_execution",
    });
    expect(entries[0]?.toolCallId).toBeUndefined();
  });

  it("does not collapse tool lifecycle rows without itemId across different turns", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-turn-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Ran command",
        turnId: "turn-1",
        payload: {
          itemType: "command_execution",
          title: "Ran command",
          detail: "pnpm run typecheck",
        },
      }),
      makeActivity({
        id: "tool-turn-2",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        turnId: "turn-2",
        payload: {
          itemType: "command_execution",
          title: "Ran command",
          detail: "pnpm run typecheck",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(2);
  });

  it("does not collapse tool lifecycle rows without itemId when descriptors differ", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-cmd-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Ran command",
        turnId: "turn-1",
        payload: {
          itemType: "command_execution",
          title: "Ran command",
          detail: "pnpm run typecheck",
        },
      }),
      makeActivity({
        id: "tool-cmd-2",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        turnId: "turn-1",
        payload: {
          itemType: "command_execution",
          title: "Ran command",
          detail: "pnpm run lint",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(2);
  });

  it("collapses same-timestamp lifecycle rows even when completed sorts before updated by id", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "z-update-earlier",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemId: "tool-1",
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "a-complete-same-timestamp",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Tool call",
        payload: {
          itemId: "tool-1",
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "z-update-same-timestamp",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemId: "tool-1",
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("tool:tool-1");
  });

  it("collapses collab agent lifecycle rows by stable item id", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "subagent-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Subagent task started",
        payload: {
          itemId: "tool-task-1",
          itemType: "collab_agent_tool_call",
          title: "Subagent task",
          detail: "code-reviewer: Review the database layer",
        },
      }),
      makeActivity({
        id: "subagent-update",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.updated",
        summary: "Subagent task",
        payload: {
          itemId: "tool-task-1",
          itemType: "collab_agent_tool_call",
          title: "Subagent task",
          detail: "code-reviewer: Review the database layer",
        },
      }),
      makeActivity({
        id: "subagent-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Subagent task",
        payload: {
          itemId: "tool-task-1",
          itemType: "collab_agent_tool_call",
          title: "Subagent task",
          detail: "code-reviewer: Review the database layer",
        },
      }),
      makeActivity({
        id: "subagent-thread",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "subagent.thread.started",
        summary: "Subagent thread started",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("tool:tool-task-1");
    expect(entries[0]?.toolCallId).toBe("tool-task-1");
    expect(entries[0]?.status).toBe("completed");
  });

  it("merges subagent usage updates onto collab subagent rows", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "subagent-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Subagent task started",
        payload: {
          itemId: "tool-task-1",
          itemType: "collab_agent_tool_call",
          data: {
            item: {
              receiverThreadIds: ["codex-subagent-thread-1"],
              receiverAgents: [{ threadId: "codex-subagent-thread-1", nickname: "reviewer" }],
            },
          },
        },
      }),
      makeActivity({
        id: "subagent-usage",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "subagent.usage.updated",
        summary: "Subagent context updated",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          usedTokens: 4200,
          maxTokens: 128_000,
          usedPercentage: 3.28125,
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.subagents?.[0]).toMatchObject({
      providerThreadId: "codex-subagent-thread-1",
      usedTokens: 4200,
      maxTokens: 128_000,
      usedPercentage: 3.28125,
    });
  });

  it("attaches streamed subagent activity details to the parent tool row", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "parent-task-tool",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Subagent task started",
        payload: {
          itemId: "tool-task-1",
          itemType: "collab_agent_tool_call",
          title: "Subagent task",
          detail: "Review the database layer",
        },
      }),
      makeActivity({
        id: "subagent-thread",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "subagent.thread.started",
        summary: "Subagent thread started",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          nickname: "reviewer",
          model: "gpt-5.3-codex",
        },
      }),
      makeActivity({
        id: "subagent-item",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "subagent.item.started",
        summary: "Subagent message started",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "subagent-message-1",
          itemType: "assistant_message",
          status: "running",
        },
      }),
      makeActivity({
        id: "subagent-delta-1",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "subagent.content.delta",
        summary: "Subagent content delta",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "subagent-message-1",
          streamKind: "assistant_text",
          delta: "Reviewed ",
        },
      }),
      makeActivity({
        id: "subagent-delta-2",
        createdAt: "2026-02-23T00:00:05.000Z",
        kind: "subagent.content.delta",
        summary: "Subagent content delta",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "subagent-message-1",
          streamKind: "assistant_text",
          delta: "the database layer.",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.subagents?.[0]).toMatchObject({
      providerThreadId: "codex-subagent-thread-1",
      parentItemId: "tool-task-1",
      nickname: "reviewer",
      model: "gpt-5.3-codex",
      hasDetails: true,
    });
    expect(entries[0]?.subagents?.[0]?.transcriptItems?.[0]).toMatchObject({
      itemId: "subagent-message-1",
      kind: "message",
      role: "assistant",
      text: "Reviewed the database layer.",
      loading: true,
    });
  });

  it("keeps subagent reasoning detail as a reasoning transcript item", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "parent-task-tool",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Subagent task started",
        payload: {
          itemId: "tool-task-1",
          itemType: "collab_agent_tool_call",
          title: "Subagent task",
          detail: "Review the database layer",
        },
      }),
      makeActivity({
        id: "subagent-thread",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "subagent.thread.started",
        summary: "Subagent thread started",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
        },
      }),
      makeActivity({
        id: "subagent-reasoning",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "subagent.item.completed",
        summary: "Reasoning",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "reasoning-1",
          itemType: "reasoning",
          status: "completed",
          title: "Reasoning",
          detail: "I inspected the relevant files.",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.subagents?.[0]?.transcriptItems?.[0]).toMatchObject({
      itemId: "reasoning-1",
      kind: "reasoning",
      title: "Reasoning",
      text: "I inspected the relevant files.",
      loading: false,
    });
  });

  it("hydrates subagent user message text from canonical item content", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "parent-task-tool",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Subagent task started",
        payload: {
          itemId: "tool-task-1",
          itemType: "collab_agent_tool_call",
          title: "Subagent task",
          detail: "Review the database layer",
        },
      }),
      makeActivity({
        id: "subagent-thread",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "subagent.thread.started",
        summary: "Subagent thread started",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
        },
      }),
      makeActivity({
        id: "subagent-user-message",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "subagent.item.completed",
        summary: "User message",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "user-message-1",
          itemType: "user_message",
          status: "completed",
          title: "User message",
          data: {
            item: {
              content: [
                {
                  type: "text",
                  text: "Please inspect the local codebase.",
                },
              ],
              id: "user-message-1",
              type: "userMessage",
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.subagents?.[0]?.transcriptItems?.[0]).toMatchObject({
      itemId: "user-message-1",
      kind: "message",
      role: "user",
      text: "Please inspect the local codebase.",
      loading: false,
    });
  });

  it("keeps subagent reasoning stream detail as a reasoning transcript item", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "parent-task-tool",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Subagent task started",
        payload: {
          itemId: "tool-task-1",
          itemType: "collab_agent_tool_call",
          title: "Subagent task",
          detail: "Review the database layer",
        },
      }),
      makeActivity({
        id: "subagent-thread",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "subagent.thread.started",
        summary: "Subagent thread started",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
        },
      }),
      makeActivity({
        id: "subagent-reasoning-start",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "subagent.item.started",
        summary: "Reasoning",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "reasoning-1",
          itemType: "reasoning",
          status: "running",
          title: "Reasoning",
        },
      }),
      makeActivity({
        id: "subagent-reasoning-delta",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "subagent.content.delta",
        summary: "Reasoning update",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "reasoning-1",
          streamKind: "reasoning_summary_text",
          delta: "Inspecting files.",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.subagents?.[0]?.transcriptItems?.[0]).toMatchObject({
      itemId: "reasoning-1",
      kind: "reasoning",
      title: "Reasoning",
      text: "Inspecting files.",
      loading: true,
      streamKind: "reasoning_summary_text",
    });
  });

  it("keeps subagent command lifecycle and output in one transcript tool row", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "parent-task-tool",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Subagent task started",
        payload: {
          itemId: "tool-task-1",
          itemType: "collab_agent_tool_call",
          title: "Subagent task",
          detail: "Review the database layer",
        },
      }),
      makeActivity({
        id: "subagent-thread",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "subagent.thread.started",
        summary: "Subagent thread started",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
        },
      }),
      makeActivity({
        id: "subagent-command-start",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "subagent.item.started",
        summary: "Ran command",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "command-1",
          itemType: "command_execution",
          status: "inProgress",
          title: "Ran command",
          detail: "/bin/zsh -lc 'pnpm run typecheck'",
          data: {
            item: {
              command: "/bin/zsh -lc 'pnpm run typecheck'",
            },
          },
        },
      }),
      makeActivity({
        id: "subagent-command-output",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "subagent.content.delta",
        summary: "Command output",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "command-1",
          streamKind: "command_output",
          delta: "typecheck passed\n",
        },
      }),
      makeActivity({
        id: "subagent-command-output-2",
        createdAt: "2026-02-23T00:00:04.500Z",
        kind: "subagent.content.delta",
        summary: "Command output",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "command-1",
          streamKind: "command_output",
          delta: "all good\n",
        },
      }),
      makeActivity({
        id: "subagent-command-complete",
        createdAt: "2026-02-23T00:00:05.000Z",
        kind: "subagent.item.completed",
        summary: "Ran command",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "command-1",
          itemType: "command_execution",
          status: "completed",
          title: "Ran command",
          detail: "/bin/zsh -lc 'pnpm run typecheck'",
          data: {
            item: {
              aggregatedOutput: "typecheck passed\nall good\n",
              command: "/bin/zsh -lc 'pnpm run typecheck'",
            },
          },
        },
      }),
      makeActivity({
        id: "subagent-message",
        createdAt: "2026-02-23T00:00:06.000Z",
        kind: "subagent.item.completed",
        summary: "Subagent message",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "subagent-message-1",
          itemType: "assistant_message",
          status: "completed",
          detail: "Typecheck passed.",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.subagents?.[0]?.transcriptItems).toEqual([
      expect.objectContaining({
        itemId: "command-1",
        kind: "command",
        title: "Ran command",
        command: "pnpm run typecheck",
        rawCommand: "/bin/zsh -lc 'pnpm run typecheck'",
        output: "typecheck passed\nall good",
      }),
      expect.objectContaining({
        itemId: "subagent-message-1",
        kind: "message",
        text: "Typecheck passed.",
      }),
    ]);
    expect(entries[0]?.subagents?.[0]?.transcriptItems?.[0]?.text).toBeUndefined();
  });

  it("hydrates subagent command output from completed payload without duplicate command text", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "parent-task-tool",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Subagent task started",
        payload: {
          itemId: "tool-task-1",
          itemType: "collab_agent_tool_call",
          title: "Subagent task",
          detail: "Review the database layer",
        },
      }),
      makeActivity({
        id: "subagent-thread",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "subagent.thread.started",
        summary: "Subagent thread started",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
        },
      }),
      makeActivity({
        id: "subagent-command-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "subagent.item.completed",
        summary: "Ran command",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "command-1",
          itemType: "command_execution",
          status: "completed",
          title: "Ran command",
          detail: "/bin/zsh -lc 'pnpm dlx @tanstack/intent@latest list'",
          data: {
            item: {
              aggregatedOutput: "3 intent-enabled packages, 14 skills\nWarnings:\nnone",
              command: "/bin/zsh -lc 'pnpm dlx @tanstack/intent@latest list'",
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);
    const commandItem = entries[0]?.subagents?.[0]?.transcriptItems?.[0];

    expect(commandItem).toMatchObject({
      itemId: "command-1",
      kind: "command",
      command: "pnpm dlx @tanstack/intent@latest list",
      rawCommand: "/bin/zsh -lc 'pnpm dlx @tanstack/intent@latest list'",
      output: "3 intent-enabled packages, 14 skills\nWarnings:\nnone",
    });
    expect(commandItem?.text).toBeUndefined();
  });

  it("uses raw subagent message text instead of truncated lifecycle detail", () => {
    const fullSummary =
      "Multi is a pnpm/Turbo TypeScript monorepo for a desktop coding-agent app. The product is a local server plus a web UI, wrapped by Electron for desktop. Main docs are README.md and AGENTS.md.";
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "parent-task-tool",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Subagent task started",
        payload: {
          itemId: "tool-task-1",
          itemType: "collab_agent_tool_call",
          title: "Subagent task",
          detail: "Review the repo",
        },
      }),
      makeActivity({
        id: "subagent-thread",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "subagent.thread.started",
        summary: "Subagent thread started",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
        },
      }),
      makeActivity({
        id: "subagent-message",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "subagent.item.completed",
        summary: "Subagent message",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "tool-task-1",
          itemId: "subagent-message-1",
          itemType: "assistant_message",
          status: "completed",
          detail:
            "Multi is a pnpm/Turbo TypeScript monorepo for a desktop coding-agent app. The product is a local ser...",
          data: {
            item: {
              id: "subagent-message-1",
              text: fullSummary,
              type: "agentMessage",
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries[0]?.subagents?.[0]?.transcriptItems?.[0]).toMatchObject({
      itemId: "subagent-message-1",
      kind: "message",
      role: "assistant",
      text: fullSummary,
    });
  });

  it("keeps a subagent row on the parent spawn call when wait references the same thread", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "spawn-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.started",
        summary: "Subagent task started",
        payload: {
          itemId: "spawn-tool-1",
          itemType: "collab_agent_tool_call",
          detail: "Review the database layer",
          data: {
            item: {
              id: "spawn-tool-1",
              tool: "spawnAgent",
              prompt: "Review the database layer",
              receiverThreadIds: [],
              type: "collabAgentToolCall",
            },
          },
        },
      }),
      makeActivity({
        id: "spawn-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Subagent task completed",
        payload: {
          itemId: "spawn-tool-1",
          itemType: "collab_agent_tool_call",
          detail: "Review the database layer",
          data: {
            item: {
              id: "spawn-tool-1",
              tool: "spawnAgent",
              prompt: "Review the database layer",
              receiverThreadIds: ["codex-subagent-thread-1"],
              type: "collabAgentToolCall",
            },
          },
        },
      }),
      makeActivity({
        id: "subagent-thread-active",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "subagent.thread.state.changed",
        summary: "Subagent active",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "spawn-tool-1",
          state: "active",
        },
      }),
      makeActivity({
        id: "subagent-message",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "subagent.item.completed",
        summary: "Subagent message",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: "spawn-tool-1",
          itemId: "subagent-message-1",
          itemType: "assistant_message",
          status: "completed",
          detail: "Reviewed the database layer.",
        },
      }),
      makeActivity({
        id: "wait-start",
        createdAt: "2026-02-23T00:00:05.000Z",
        kind: "tool.started",
        summary: "Waiting for subagent",
        payload: {
          itemId: "wait-tool-1",
          itemType: "collab_agent_tool_call",
          data: {
            item: {
              id: "wait-tool-1",
              tool: "wait",
              receiverThreadIds: ["codex-subagent-thread-1"],
              type: "collabAgentToolCall",
            },
          },
        },
      }),
      makeActivity({
        id: "wait-complete",
        createdAt: "2026-02-23T00:00:06.000Z",
        kind: "tool.completed",
        summary: "Subagent completed",
        payload: {
          itemId: "wait-tool-1",
          itemType: "collab_agent_tool_call",
          data: {
            item: {
              id: "wait-tool-1",
              tool: "wait",
              receiverThreadIds: ["codex-subagent-thread-1"],
              type: "collabAgentToolCall",
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities, undefined);

    expect(entries.map((entry) => entry.id)).toEqual(["tool:spawn-tool-1"]);
    expect(entries[0]?.subagents).toHaveLength(1);
    expect(entries[0]?.subagents?.[0]).toMatchObject({
      providerThreadId: "codex-subagent-thread-1",
      parentItemId: "spawn-tool-1",
      hasDetails: true,
    });
    expect(entries[0]?.subagents?.[0]?.transcriptItems?.[0]).toMatchObject({
      itemId: "subagent-message-1",
      text: "Reviewed the database layer.",
      loading: false,
    });
  });
});

describe("deriveTimelineEntries", () => {
  it("includes proposed plans alongside messages and work entries in chronological order", () => {
    const entries = deriveTimelineEntries(
      [
        {
          id: MessageId.make("message-1"),
          role: "assistant",
          text: "hello",
          createdAt: "2026-02-23T00:00:01.000Z",
          streaming: false,
        },
      ],
      [
        {
          id: "plan:thread-1:turn:turn-1",
          turnId: TurnId.make("turn-1"),
          planMarkdown: "# Ship it",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-02-23T00:00:02.000Z",
          updatedAt: "2026-02-23T00:00:02.000Z",
        },
      ],
      [
        {
          id: "work-1",
          toolCallId: "shared-tool-call",
          createdAt: "2026-02-23T00:00:03.000Z",
          label: "Ran tests",
          tone: "tool",
        },
      ],
    );

    expect(entries.map((entry) => entry.kind)).toEqual(["message", "proposed-plan", "work"]);
    expect(entries[2]?.id).toBe("work:work-1");
    expect(entries[1]).toMatchObject({
      kind: "proposed-plan",
      proposedPlan: {
        planMarkdown: "# Ship it",
        implementedAt: null,
        implementationThreadId: null,
      },
    });
  });
});

describe("deriveWorkLogEntries context window handling", () => {
  it("excludes context window updates from the work log", () => {
    const entries = deriveWorkLogEntries(
      [
        makeActivity({
          id: "context-1",
          turnId: "turn-1",
          kind: "context-window.updated",
          summary: "Context window updated",
          tone: "info",
        }),
        makeActivity({
          id: "tool-1",
          turnId: "turn-1",
          kind: "tool.completed",
          summary: "Ran command",
          tone: "tool",
        }),
      ],
      TurnId.make("turn-1"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe("Ran command");
  });

  it("keeps context compaction activities as normal work log entries", () => {
    const entries = deriveWorkLogEntries(
      [
        makeActivity({
          id: "compaction-1",
          turnId: "turn-1",
          kind: "context-compaction",
          summary: "Context compacted",
          tone: "info",
        }),
      ],
      TurnId.make("turn-1"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe("Context compacted");
  });
});

describe("isLatestTurnSettled", () => {
  const latestTurn = {
    turnId: TurnId.make("turn-1"),
    state: "completed" as const,
    startedAt: "2026-02-27T21:10:00.000Z",
    completedAt: "2026-02-27T21:10:06.000Z",
  } as const;

  it("returns false while the same turn is still active in a running session", () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: "running",
        activeTurnId: TurnId.make("turn-1"),
      }),
    ).toBe(false);
  });

  it("returns false while any turn is running to avoid stale latest-turn banners", () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: "running",
        activeTurnId: TurnId.make("turn-2"),
      }),
    ).toBe(false);
  });

  it("returns true once the session is no longer running that turn", () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: "ready",
        activeTurnId: undefined,
      }),
    ).toBe(true);
  });

  it("returns true immediately for interrupted turns", () => {
    expect(
      isLatestTurnSettled(
        {
          turnId: TurnId.make("turn-1"),
          state: "interrupted" as const,
          startedAt: "2026-02-27T21:10:00.000Z",
          completedAt: "2026-02-27T21:10:06.000Z",
        },
        { orchestrationStatus: "running", activeTurnId: TurnId.make("turn-1") },
      ),
    ).toBe(true);
  });

  it("returns true immediately for error turns", () => {
    expect(
      isLatestTurnSettled(
        {
          turnId: TurnId.make("turn-1"),
          state: "error" as const,
          startedAt: "2026-02-27T21:10:00.000Z",
          completedAt: "2026-02-27T21:10:06.000Z",
        },
        { orchestrationStatus: "running", activeTurnId: TurnId.make("turn-1") },
      ),
    ).toBe(true);
  });

  it("returns false when turn timestamps are incomplete", () => {
    expect(
      isLatestTurnSettled(
        {
          turnId: TurnId.make("turn-1"),
          state: "running" as const,
          startedAt: null,
          completedAt: "2026-02-27T21:10:06.000Z",
        },
        null,
      ),
    ).toBe(false);
  });
});

describe("deriveActiveWorkStartedAt", () => {
  const latestTurn = {
    turnId: TurnId.make("turn-1"),
    state: "completed" as const,
    startedAt: "2026-02-27T21:10:00.000Z",
    completedAt: "2026-02-27T21:10:06.000Z",
  } as const;

  it("prefers the in-flight turn start when the latest turn is not settled", () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          orchestrationStatus: "running",
          activeTurnId: TurnId.make("turn-1"),
        },
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:10:00.000Z");
  });

  it("uses the new send start while the session is running a different turn", () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          orchestrationStatus: "running",
          activeTurnId: TurnId.make("turn-2"),
        },
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:11:00.000Z");
  });

  it("falls back to sendStartedAt once the latest turn is settled", () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          orchestrationStatus: "ready",
          activeTurnId: undefined,
        },
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:11:00.000Z");
  });

  it("uses sendStartedAt for a fresh send after the prior turn completed", () => {
    expect(
      deriveActiveWorkStartedAt(
        {
          turnId: TurnId.make("turn-1"),
          state: "completed" as const,
          startedAt: "2026-02-27T21:10:00.000Z",
          completedAt: "2026-02-27T21:10:06.000Z",
        },
        null,
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:11:00.000Z");
  });
});

describe("PROVIDER_OPTIONS", () => {
  it("advertises the canonical provider list with Pi pending", () => {
    const claude = PROVIDER_OPTIONS.find((option) => option.value === "claudeAgent");
    const cursor = PROVIDER_OPTIONS.find((option) => option.value === "cursor");
    const pi = PROVIDER_OPTIONS.find((option) => option.value === "pi");
    expect(PROVIDER_OPTIONS).toEqual([
      { value: "codex", label: "Codex", available: true },
      { value: "claudeAgent", label: "Claude", available: true },
      { value: "opencode", label: "OpenCode", available: true },
      { value: "cursor", label: "Cursor", available: true },
      { value: "pi", label: "Pi", available: false },
    ]);
    expect(claude).toEqual({
      value: "claudeAgent",
      label: "Claude",
      available: true,
    });
    expect(cursor).toEqual({
      value: "cursor",
      label: "Cursor",
      available: true,
    });
    expect(pi).toEqual({
      value: "pi",
      label: "Pi",
      available: false,
    });
  });
});
