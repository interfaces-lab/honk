import {
  EventId,
  MessageId,
  ProjectId,
  ThreadEntryId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@honk/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

const projectId = ProjectId.make("project:projection");
const threadId = ThreadId.make("thread:projection");
const turnId = TurnId.make("thread:projection:turn:1");
const userMessageId = MessageId.make("message:user");
const assistantMessageId = MessageId.make("message:assistant");
const userEntryId = ThreadEntryId.make("entry:user");
const assistantEntryId = ThreadEntryId.make("entry:assistant");
const createdAt = "2026-06-12T02:00:00.000Z";
const completedAt = "2026-06-12T02:00:10.000Z";

function eventBase(sequence: number, occurredAt: string) {
  return {
    sequence,
    eventId: EventId.make(`event:projection:${sequence}`),
    aggregateKind: "thread" as const,
    aggregateId: threadId,
    occurredAt,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
  };
}

describe("projectEvent", () => {
  it("advances latestTurn from a completed assistant message", async () => {
    const threadCreated = {
      ...eventBase(1, createdAt),
      type: "thread.created",
      payload: {
        threadId,
        projectId,
        title: "Projection thread",
        modelSelection: {
          instanceId: "model:test",
          model: "gpt-test",
        },
        runtimeMode: "full-access",
        interactionMode: "agent",
        branch: null,
        worktreePath: null,
        createdAt,
        updatedAt: createdAt,
      },
    } satisfies OrchestrationEvent;
    const userMessageSent = {
      ...eventBase(2, createdAt),
      type: "thread.message-sent",
      payload: {
        threadId,
        messageId: userMessageId,
        entryId: userEntryId,
        parentEntryId: null,
        role: "user",
        text: "finish indicator is missing",
        turnId,
        streaming: false,
        createdAt,
        updatedAt: createdAt,
      },
    } satisfies OrchestrationEvent;
    const assistantMessageSent = {
      ...eventBase(3, completedAt),
      type: "thread.message-sent",
      payload: {
        threadId,
        messageId: assistantMessageId,
        entryId: assistantEntryId,
        parentEntryId: userEntryId,
        role: "assistant",
        text: "Done.",
        turnId,
        streaming: false,
        createdAt: completedAt,
        updatedAt: completedAt,
      },
    } satisfies OrchestrationEvent;

    const model = await Effect.runPromise(
      Effect.gen(function* () {
        const created = yield* projectEvent(createEmptyReadModel(createdAt), threadCreated);
        const withUserMessage = yield* projectEvent(created, userMessageSent);
        return yield* projectEvent(withUserMessage, assistantMessageSent);
      }),
    );

    expect(model.threads[0]?.latestTurn).toEqual({
      turnId,
      state: "completed",
      requestedAt: completedAt,
      startedAt: completedAt,
      completedAt,
      assistantMessageId,
    });
  });
});
