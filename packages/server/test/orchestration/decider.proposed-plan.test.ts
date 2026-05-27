import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
  type OrchestrationReadModel,
} from "@multi/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "../../src/orchestration/decider.ts";

function readModelWithPlan(now: string): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: now,
    projects: [
      {
        id: ProjectId.make("project-1"),
        title: "Project",
        projectRoot: "/tmp/project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: {
          instanceId: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        deletedAt: null,
        latestTurn: null,
        messages: [],
        activeEntryId: null,
        entries: [],
        session: null,
        activities: [],
        proposedPlans: [
          {
            id: "plan-1",
            turnId: null,
            planMarkdown: "# Original plan",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
        checkpoints: [],
      },
    ],
  };
}

describe("decider proposed plan commands", () => {
  it("updates an existing proposed plan from a client command", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const updatedAt = "2026-01-01T00:00:01.000Z";

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.proposed-plan.update",
          commandId: CommandId.make("cmd-plan-update"),
          threadId: ThreadId.make("thread-1"),
          planId: "plan-1",
          planMarkdown: "# Updated plan",
          createdAt: updatedAt,
        },
        readModel: readModelWithPlan(now),
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("thread.proposed-plan-upserted");
    if (event.type !== "thread.proposed-plan-upserted") {
      return;
    }
    expect(event.payload.proposedPlan).toMatchObject({
      id: "plan-1",
      planMarkdown: "# Updated plan",
      createdAt: now,
      updatedAt,
    });
  });
});
