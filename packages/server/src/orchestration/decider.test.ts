import {
  CommandId,
  MessageId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@multi/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";

const createdAt = "2026-06-06T19:13:05.704Z";
const threadId = ThreadId.make("thread:turn-start-failed");
const messageId = MessageId.make("message:turn-start-failed");

function readModelWithThread(thread: OrchestrationThread): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [thread],
    updatedAt: createdAt,
  };
}

function thread(): OrchestrationThread {
  return {
    id: threadId,
    projectId: null,
    title: "Thread",
    modelSelection: {
      instanceId: "model:test",
      model: "gpt-test",
    },
    runtimeMode: "full-access",
    interactionMode: "agent",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    deletedAt: null,
    messages: [],
    leafId: null,
    entries: [],
    proposedPlans: [],
    activities: [],
    session: null,
  };
}

describe("decideOrchestrationCommand", () => {
  it("maps client turn-start failure reports to runtime failure activities", async () => {
    const event = await Effect.runPromise(
      decideOrchestrationCommand({
        readModel: readModelWithThread(thread()),
        command: {
          type: "thread.turn.start.failed",
          commandId: CommandId.make("command:turn-start-failed"),
          threadId,
          messageId,
          detail: "Runtime host unavailable.",
          createdAt,
        },
      }),
    );

    expect(Array.isArray(event)).toBe(false);
    expect(event).toEqual(
      expect.objectContaining({
        type: "thread.activity-appended",
        aggregateId: threadId,
        payload: {
          threadId,
          activity: expect.objectContaining({
            tone: "error",
            kind: "runtime.turn.start.failed",
            summary: "Runtime failed to start",
            payload: {
              detail: "Runtime host unavailable.",
              messageId,
            },
            turnId: null,
            createdAt,
          }),
        },
      }),
    );
  });

  it("accepts unarchive commands for already unarchived threads", async () => {
    const event = await Effect.runPromise(
      decideOrchestrationCommand({
        readModel: readModelWithThread(thread()),
        command: {
          type: "thread.unarchive",
          commandId: CommandId.make("command:thread-unarchive"),
          threadId,
        },
      }),
    );

    expect(Array.isArray(event)).toBe(false);
    expect(event).toEqual(
      expect.objectContaining({
        type: "thread.unarchived",
        aggregateId: threadId,
        payload: {
          threadId,
          updatedAt: createdAt,
        },
      }),
    );
  });
});
