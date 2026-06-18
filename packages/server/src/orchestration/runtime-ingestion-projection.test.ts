import {
  CommandId,
  MessageId,
  OrchestrationEvent,
  RuntimeIngestionRecordId,
  RuntimeSessionId,
  ThreadId,
  TurnId,
  threadEntryIdForMessageId,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type RuntimeIngestionRecord,
} from "@honk/contracts";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { internalCommandForRuntimeFact } from "../runtime/runtime-ingestion-http.ts";
import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const threadId = ThreadId.make("thread:ingest-projection");
const runtimeSessionId = RuntimeSessionId.make("runtime:ingest-projection");
const turnId = TurnId.make("thread:ingest-projection:turn:1");
const userMessageId = MessageId.make("message:ingest-user");
const assistantMessageId = MessageId.make("message:ingest-assistant");
const userEntryId = threadEntryIdForMessageId(userMessageId);
const assistantEntryId = threadEntryIdForMessageId(assistantMessageId);
const requestedAt = "2026-06-18T12:00:00.000Z";
const completedAt = "2026-06-18T12:00:05.000Z";

const decodeOrchestrationEvent = Schema.decodeUnknownSync(OrchestrationEvent);

function runningThread(): OrchestrationThread {
  return {
    id: threadId,
    projectId: null,
    title: "Ingest projection thread",
    modelSelection: {
      instanceId: "model:test",
      model: "gpt-test",
    },
    runtimeMode: "full-access",
    interactionMode: "agent",
    branch: null,
    worktreePath: null,
    latestTurn: {
      turnId,
      state: "running",
      requestedAt,
      startedAt: requestedAt,
      completedAt: null,
      assistantMessageId: null,
    },
    createdAt: requestedAt,
    updatedAt: requestedAt,
    archivedAt: null,
    deletedAt: null,
    messages: [
      {
        id: userMessageId,
        role: "user",
        text: "do the thing",
        turnId,
        streaming: false,
        createdAt: requestedAt,
        updatedAt: requestedAt,
      },
    ],
    leafId: userEntryId,
    entries: [
      {
        id: userEntryId,
        threadId,
        parentEntryId: null,
        kind: "message",
        messageId: userMessageId,
        turnId,
        createdAt: requestedAt,
      },
    ],
    proposedPlans: [],
    activities: [],
    session: null,
  };
}

function readModelWith(thread: OrchestrationThread): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [thread],
    updatedAt: requestedAt,
  };
}

function assistantCompletionRecord(): Extract<
  RuntimeIngestionRecord,
  { kind: "assistant.completion" }
> {
  return {
    recordId: RuntimeIngestionRecordId.make(
      `runtime-assistant:${threadId}:${runtimeSessionId}:runtime:assistant-entry`,
    ),
    threadId,
    runtimeSessionId,
    sourceEventId: "runtime:assistant-entry",
    kind: "assistant.completion",
    createdAt: completedAt,
    payload: {
      messageId: assistantMessageId,
      text: "Done.",
      turnId,
      parentEntryId: userEntryId,
    },
  };
}

describe("runtime ingestion projection chain", () => {
  it("drives assistant.completion through assistant complete to a completed SQLite turn", async () => {
    const record = assistantCompletionRecord();

    const command = internalCommandForRuntimeFact(record);
    expect(command).toMatchObject({
      type: "thread.message.assistant.complete",
      commandId: CommandId.make(record.recordId),
      threadId,
      messageId: assistantMessageId,
      parentEntryId: userEntryId,
      turnId,
    });

    const decided = await Effect.runPromise(
      decideOrchestrationCommand({
        readModel: readModelWith(runningThread()),
        command,
      }),
    );
    if (Array.isArray(decided)) {
      throw new Error("Expected a single decided event for an assistant completion.");
    }
    expect(decided).toMatchObject({
      type: "thread.message-sent",
      aggregateId: threadId,
      payload: {
        threadId,
        messageId: assistantMessageId,
        entryId: assistantEntryId,
        parentEntryId: userEntryId,
        role: "assistant",
        turnId,
        streaming: false,
      },
    });

    const event = decodeOrchestrationEvent({ ...decided, sequence: 1 });
    const projected = await Effect.runPromise(projectEvent(readModelWith(runningThread()), event));

    expect(projected.threads[0]?.latestTurn).toMatchObject({
      turnId,
      state: "completed",
      completedAt,
      assistantMessageId,
    });
  });

  it("is idempotent for a repeated assistant completion fact", async () => {
    const record = assistantCompletionRecord();
    const command = internalCommandForRuntimeFact(record);

    // Two ingests of the same fact resolve to the same deterministic command id, so the engine
    // would dedupe; the projection of the resulting event must also not double-apply if replayed.
    const decidedOnce = await Effect.runPromise(
      decideOrchestrationCommand({
        readModel: readModelWith(runningThread()),
        command,
      }),
    );
    if (Array.isArray(decidedOnce)) {
      throw new Error("Expected a single decided event for an assistant completion.");
    }
    expect(String(command.commandId)).toBe(String(record.recordId));
    expect(String(internalCommandForRuntimeFact(record).commandId)).toBe(String(command.commandId));

    const firstEvent = decodeOrchestrationEvent({ ...decidedOnce, sequence: 1 });
    const secondEvent = decodeOrchestrationEvent({ ...decidedOnce, sequence: 2 });

    const projected = await Effect.runPromise(
      Effect.gen(function* () {
        const once = yield* projectEvent(readModelWith(runningThread()), firstEvent);
        return yield* projectEvent(once, secondEvent);
      }),
    );

    const thread = projected.threads[0];
    expect(thread?.latestTurn).toMatchObject({
      turnId,
      state: "completed",
      assistantMessageId,
    });
    expect(thread?.messages.filter((message) => message.id === assistantMessageId)).toHaveLength(1);
    expect(thread?.messages).toHaveLength(2);
    expect(thread?.entries.filter((entry) => entry.id === assistantEntryId)).toHaveLength(1);
    expect(thread?.entries).toHaveLength(2);
  });

  it("starts from an empty read model without applying messages for an unknown thread", async () => {
    const record = assistantCompletionRecord();
    const command = internalCommandForRuntimeFact(record);
    const decided = await Effect.runPromise(
      decideOrchestrationCommand({
        readModel: readModelWith(runningThread()),
        command,
      }),
    );
    if (Array.isArray(decided)) {
      throw new Error("Expected a single decided event for an assistant completion.");
    }
    const event = decodeOrchestrationEvent({ ...decided, sequence: 1 });

    const projected = await Effect.runPromise(projectEvent(createEmptyReadModel(requestedAt), event));
    expect(projected.threads).toHaveLength(0);
  });
});
