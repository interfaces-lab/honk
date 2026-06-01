import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ThreadEntryId,
  ThreadId,
  type OrchestrationReadModel,
} from "@multi/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "../../src/orchestration/decider.ts";

const now = "2026-01-01T00:00:00.000Z";
const threadId = ThreadId.make("thread-tree-1");
const assistantEntryId = ThreadEntryId.make("entry-assistant-1");

function readModelWithTree(options?: { running?: boolean }): OrchestrationReadModel {
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
        id: threadId,
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
        leafId: ThreadEntryId.make("entry-user-1"),
        entries: [
          {
            id: ThreadEntryId.make("entry-user-1"),
            threadId,
            parentEntryId: null,
            kind: "message",
            messageId: MessageId.make("message-user-1"),
            turnId: null,
            createdAt: now,
          },
          {
            id: assistantEntryId,
            threadId,
            parentEntryId: ThreadEntryId.make("entry-user-1"),
            kind: "message",
            messageId: MessageId.make("message-assistant-1"),
            turnId: null,
            createdAt: "2026-01-01T00:00:01.000Z",
          },
        ],
        session: options?.running
          ? {
              threadId,
              status: "running",
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: now,
            }
          : null,
        activities: [],
        chatTimelineRows: [],
        proposedPlans: [],
      },
    ],
  };
}

describe("decider thread tree commands", () => {
  it("navigates directly to the requested entry", async () => {
    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.tree.navigate",
          commandId: CommandId.make("cmd-tree-navigate"),
          threadId,
          entryId: assistantEntryId,
          createdAt: now,
        },
        readModel: readModelWithTree(),
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("thread.tree-leaf-moved");
    if (event.type !== "thread.tree-leaf-moved") {
      return;
    }
    expect(event.payload.leafId).toBe(assistantEntryId);
  });

  it("rejects tree navigation while a turn is running", async () => {
    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.tree.navigate",
            commandId: CommandId.make("cmd-tree-navigate-running"),
            threadId,
            entryId: assistantEntryId,
            createdAt: now,
          },
          readModel: readModelWithTree({ running: true }),
        }),
      ),
    ).rejects.toThrow("Cannot change the thread tree while a turn is running.");
  });
});
