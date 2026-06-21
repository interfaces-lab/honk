import { NodeServices } from "@effect/platform-node";
import {
  CommandId,
  EventId,
  MessageId,
  OrchestrationEvent,
  RuntimeIngestionRecordId,
  RuntimeSessionId,
  ThreadId,
  TurnId,
  threadEntryIdForMessageId,
  type RuntimeIngestionRecord,
} from "@honk/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { ServerConfig } from "../config.ts";
import { OrchestrationEventStoreLive } from "../persistence/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Sqlite.ts";
import {
  clientCommandForRuntimeUserTurnStartRecord,
  internalCommandForRuntimeFact,
} from "../runtime/runtime-ingestion-http.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionPipeline } from "./ProjectionPipeline.service.ts";

const threadId = ThreadId.make("thread:ingest-projection");
const runtimeSessionId = RuntimeSessionId.make("runtime:ingest-projection");
const requestedAt = "2026-06-18T12:00:00.000Z";
const completedAt = "2026-06-18T12:00:05.000Z";
const userMessageId = MessageId.make("message:ingest-user");
const assistantMessageId = MessageId.make("message:ingest-assistant");
const userEntryId = threadEntryIdForMessageId(userMessageId);
const assistantEntryId = threadEntryIdForMessageId(assistantMessageId);
const assistantTurnId = TurnId.make(`${threadId}:turn:35`);

const decodeOrchestrationEvent = Schema.decodeUnknownSync(OrchestrationEvent);

const ProjectionTestLayer = OrchestrationProjectionPipelineLive.pipe(
  Layer.provideMerge(OrchestrationEventStoreLive),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "honk-runtime-ingestion-projection-" }),
  ),
  Layer.provide(NodeServices.layer),
);

function userTurnStartRecordWithBootstrap(): Extract<
  RuntimeIngestionRecord,
  { kind: "user.turn-start" }
> {
  return {
    recordId: RuntimeIngestionRecordId.make(
      `runtime-user-turn:${threadId}:${runtimeSessionId}:${userMessageId}`,
    ),
    threadId,
    runtimeSessionId,
    sourceEventId: `runtime-user-turn:${assistantTurnId}`,
    kind: "user.turn-start",
    createdAt: requestedAt,
    payload: {
      messageId: userMessageId,
      text: "do the thing",
      attachments: [],
      modelSelection: {
        instanceId: "model:test",
        model: "gpt-test",
      },
      titleSeed: "do the thing",
      runtimeMode: "full-access",
      interactionMode: "agent",
      bootstrap: {
        prepareWorktree: {
          projectCwd: "/repo",
          baseBranch: "main",
          branch: "wt/do-the-thing",
        },
        runSetupScript: true,
      },
    },
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
      turnId: assistantTurnId,
      parentEntryId: userEntryId,
    },
  };
}

function proposedPlanRecord(): Extract<RuntimeIngestionRecord, { kind: "proposed-plan" }> {
  return {
    recordId: RuntimeIngestionRecordId.make(
      `runtime-proposed-plan:${threadId}:${runtimeSessionId}:${assistantTurnId}`,
    ),
    threadId,
    runtimeSessionId,
    sourceEventId: "runtime:proposed-plan",
    kind: "proposed-plan",
    createdAt: completedAt,
    payload: {
      proposedPlan: {
        id: `plan:${threadId}:${assistantTurnId}`,
        turnId: assistantTurnId,
        planMarkdown: "# Plan\n\n1. Do the thing",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: completedAt,
        updatedAt: completedAt,
      },
    },
  };
}

function eventBase(sequence: number, occurredAt: string) {
  return {
    sequence,
    eventId: EventId.make(`event:ingest-projection:${sequence}`),
    aggregateKind: "thread" as const,
    aggregateId: threadId,
    occurredAt,
    commandId: CommandId.make(`command:ingest-projection:${sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
  };
}

function threadCreated(sequence: number): OrchestrationEvent {
  return decodeOrchestrationEvent({
    ...eventBase(sequence, requestedAt),
    type: "thread.created",
    payload: {
      threadId,
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
      createdAt: requestedAt,
      updatedAt: requestedAt,
    },
  });
}

function userMessageSent(input: {
  readonly sequence: number;
  readonly messageId: MessageId;
  readonly parentEntryId: string | null;
  readonly text: string;
  readonly createdAt: string;
}): OrchestrationEvent {
  return decodeOrchestrationEvent({
    ...eventBase(input.sequence, input.createdAt),
    type: "thread.message-sent",
    payload: {
      threadId,
      messageId: input.messageId,
      entryId: threadEntryIdForMessageId(input.messageId),
      parentEntryId: input.parentEntryId,
      role: "user",
      text: input.text,
      attachments: [],
      turnId: null,
      streaming: false,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    },
  });
}

function turnStartRequested(input: {
  readonly sequence: number;
  readonly messageId: MessageId;
  readonly createdAt: string;
  readonly text: string;
}): OrchestrationEvent {
  return decodeOrchestrationEvent({
    ...eventBase(input.sequence, input.createdAt),
    type: "thread.turn-start-requested",
    payload: {
      threadId,
      messageId: input.messageId,
      userEntryId: threadEntryIdForMessageId(input.messageId),
      modelSelection: {
        instanceId: "model:test",
        model: "gpt-test",
      },
      titleSeed: input.text,
      runtimeMode: "full-access",
      interactionMode: "agent",
      createdAt: input.createdAt,
    },
  });
}

function runtimeActivity(input: {
  readonly sequence: number;
  readonly id: string;
  readonly turnId: TurnId;
  readonly createdAt: string;
}): OrchestrationEvent {
  return decodeOrchestrationEvent({
    ...eventBase(input.sequence, input.createdAt),
    type: "thread.activity-appended",
    payload: {
      threadId,
      activity: {
        id: EventId.make(input.id),
        tone: "tool",
        summary: "Ran command",
        turnId: input.turnId,
        createdAt: input.createdAt,
        kind: "tool.completed",
        payload: {
          itemType: "command_execution",
          itemId: input.id,
          status: "completed",
          title: "command",
        },
      },
    },
  });
}

function assistantMessageSent(input: {
  readonly sequence: number;
  readonly messageId: MessageId;
  readonly parentEntryId: string;
  readonly turnId: TurnId;
  readonly createdAt: string;
  readonly text?: string;
}): OrchestrationEvent {
  return decodeOrchestrationEvent({
    ...eventBase(input.sequence, input.createdAt),
    type: "thread.message-sent",
    payload: {
      threadId,
      messageId: input.messageId,
      entryId: threadEntryIdForMessageId(input.messageId),
      parentEntryId: input.parentEntryId,
      role: "assistant",
      text: input.text ?? "Done.",
      attachments: [],
      turnId: input.turnId,
      streaming: false,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    },
  });
}

function proposedPlanUpserted(input: {
  readonly sequence: number;
  readonly turnId: TurnId;
  readonly createdAt: string;
}): OrchestrationEvent {
  return decodeOrchestrationEvent({
    ...eventBase(input.sequence, input.createdAt),
    type: "thread.proposed-plan-upserted",
    payload: {
      threadId,
      proposedPlan: {
        id: `plan:${threadId}:${input.turnId}`,
        turnId: input.turnId,
        planMarkdown: "# Plan\n\n1. Do the thing",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      },
    },
  });
}

async function projectEvents(events: readonly OrchestrationEvent[]) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const pipeline = yield* OrchestrationProjectionPipeline;
        const sql = yield* SqlClient.SqlClient;
        yield* Effect.forEach(events, (event) => pipeline.projectEvent(event), {
          concurrency: 1,
        });
        const messages = yield* sql<{
          readonly messageId: string;
          readonly role: string;
          readonly turnId: string | null;
        }>`
          SELECT
            message_id AS "messageId",
            role,
            turn_id AS "turnId"
          FROM projection_thread_messages
          WHERE thread_id = ${threadId}
          ORDER BY created_at ASC, message_id ASC
        `;
        const entries = yield* sql<{
          readonly entryId: string;
          readonly parentEntryId: string | null;
          readonly turnId: string | null;
        }>`
          SELECT
            entry_id AS "entryId",
            parent_entry_id AS "parentEntryId",
            turn_id AS "turnId"
          FROM projection_thread_entries
          WHERE thread_id = ${threadId}
          ORDER BY created_at ASC, entry_id ASC
        `;
        const activities = yield* sql<{
          readonly activityId: string;
          readonly turnId: string | null;
          readonly createdAt: string;
        }>`
          SELECT
            activity_id AS "activityId",
            turn_id AS "turnId",
            created_at AS "createdAt"
          FROM projection_thread_activities
          WHERE thread_id = ${threadId}
          ORDER BY created_at ASC, activity_id ASC
        `;
        const turns = yield* sql<{
          readonly turnId: string | null;
          readonly pendingMessageId: string | null;
          readonly userEntryId: string | null;
          readonly assistantMessageId: string | null;
          readonly state: string;
          readonly requestedAt: string;
          readonly completedAt: string | null;
        }>`
          SELECT
            turn_id AS "turnId",
            pending_message_id AS "pendingMessageId",
            user_entry_id AS "userEntryId",
            assistant_message_id AS "assistantMessageId",
            state,
            requested_at AS "requestedAt",
            completed_at AS "completedAt"
          FROM projection_turns
          WHERE thread_id = ${threadId}
          ORDER BY requested_at ASC, turn_id ASC
        `;
        const threads = yield* sql<{
          readonly latestTurnId: string | null;
          readonly leafId: string | null;
        }>`
          SELECT
            latest_turn_id AS "latestTurnId",
            leaf_id AS "leafId"
          FROM projection_threads
          WHERE thread_id = ${threadId}
        `;
        const proposedPlans = yield* sql<{
          readonly planId: string;
          readonly turnId: string | null;
          readonly planMarkdown: string;
        }>`
          SELECT
            plan_id AS "planId",
            turn_id AS "turnId",
            plan_markdown AS "planMarkdown"
          FROM projection_thread_proposed_plans
          WHERE thread_id = ${threadId}
          ORDER BY created_at ASC, plan_id ASC
        `;
        return { messages, entries, activities, turns, threads, proposedPlans };
      }).pipe(Effect.provide(ProjectionTestLayer)),
    ),
  );
}

describe("runtime ingestion projection chain", () => {
  it("preserves git bootstrap metadata on canonical user turn records", () => {
    const record = userTurnStartRecordWithBootstrap();
    const command = clientCommandForRuntimeUserTurnStartRecord(record);

    expect(command).toMatchObject({
      type: "thread.turn.start",
      commandId: CommandId.make(record.recordId),
      threadId,
      bootstrap: record.payload.bootstrap,
    });
  });

  it("maps assistant.completion facts to assistant complete commands", () => {
    const record = assistantCompletionRecord();
    const command = internalCommandForRuntimeFact(record);

    expect(command).toMatchObject({
      type: "thread.message.assistant.complete",
      commandId: CommandId.make(record.recordId),
      threadId,
      messageId: assistantMessageId,
      parentEntryId: userEntryId,
      turnId: assistantTurnId,
    });
  });

  it("maps proposed-plan facts to proposed-plan upsert commands", () => {
    const record = proposedPlanRecord();
    const command = internalCommandForRuntimeFact(record);

    expect(command).toMatchObject({
      type: "thread.proposed-plan.upsert",
      commandId: CommandId.make(record.recordId),
      threadId,
      proposedPlan: record.payload.proposedPlan,
    });
  });

  it("binds a pending user message and prior Pi loop activities to the assistant turn", async () => {
    const oldToolTurnId = TurnId.make(`${threadId}:turn:1`);
    const rows = await projectEvents([
      threadCreated(1),
      userMessageSent({
        sequence: 2,
        messageId: userMessageId,
        parentEntryId: null,
        text: "do the thing",
        createdAt: requestedAt,
      }),
      turnStartRequested({
        sequence: 3,
        messageId: userMessageId,
        text: "do the thing",
        createdAt: requestedAt,
      }),
      runtimeActivity({
        sequence: 4,
        id: "runtime-activity:tool-before-assistant",
        turnId: oldToolTurnId,
        createdAt: "2026-06-18T12:00:01.000Z",
      }),
      assistantMessageSent({
        sequence: 5,
        messageId: assistantMessageId,
        parentEntryId: userEntryId,
        turnId: assistantTurnId,
        createdAt: completedAt,
      }),
    ]);

    expect(rows.messages).toEqual([
      { messageId: userMessageId, role: "user", turnId: assistantTurnId },
      { messageId: assistantMessageId, role: "assistant", turnId: assistantTurnId },
    ]);
    expect(rows.entries).toEqual([
      { entryId: userEntryId, parentEntryId: null, turnId: assistantTurnId },
      { entryId: assistantEntryId, parentEntryId: userEntryId, turnId: assistantTurnId },
    ]);
    expect(rows.activities).toEqual([
      {
        activityId: "runtime-activity:tool-before-assistant",
        turnId: assistantTurnId,
        createdAt: "2026-06-18T12:00:01.000Z",
      },
    ]);
    expect(rows.turns).toEqual([
      {
        turnId: assistantTurnId,
        pendingMessageId: userMessageId,
        userEntryId,
        assistantMessageId,
        state: "completed",
        requestedAt,
        completedAt,
      },
    ]);
    expect(rows.threads).toEqual([{ latestTurnId: assistantTurnId, leafId: assistantEntryId }]);
  });

  it("completes a plan-only turn from a proposed-plan upsert", async () => {
    const oldToolTurnId = TurnId.make(`${threadId}:turn:1`);
    const rows = await projectEvents([
      threadCreated(1),
      userMessageSent({
        sequence: 2,
        messageId: userMessageId,
        parentEntryId: null,
        text: "make a plan",
        createdAt: requestedAt,
      }),
      turnStartRequested({
        sequence: 3,
        messageId: userMessageId,
        text: "make a plan",
        createdAt: requestedAt,
      }),
      runtimeActivity({
        sequence: 4,
        id: "runtime-activity:tool-before-plan",
        turnId: oldToolTurnId,
        createdAt: "2026-06-18T12:00:01.000Z",
      }),
      proposedPlanUpserted({
        sequence: 5,
        turnId: assistantTurnId,
        createdAt: completedAt,
      }),
    ]);

    expect(rows.proposedPlans).toEqual([
      {
        planId: `plan:${threadId}:${assistantTurnId}`,
        turnId: assistantTurnId,
        planMarkdown: "# Plan\n\n1. Do the thing",
      },
    ]);
    expect(rows.messages).toEqual([{ messageId: userMessageId, role: "user", turnId: assistantTurnId }]);
    expect(rows.entries).toEqual([
      { entryId: userEntryId, parentEntryId: null, turnId: assistantTurnId },
    ]);
    expect(rows.activities).toEqual([
      {
        activityId: "runtime-activity:tool-before-plan",
        turnId: assistantTurnId,
        createdAt: "2026-06-18T12:00:01.000Z",
      },
    ]);
    expect(rows.turns).toEqual([
      {
        turnId: assistantTurnId,
        pendingMessageId: userMessageId,
        userEntryId,
        assistantMessageId: null,
        state: "completed",
        requestedAt,
        completedAt,
      },
    ]);
    expect(rows.threads).toEqual([{ latestTurnId: assistantTurnId, leafId: userEntryId }]);
  });

  it("does not move first-turn activities into an overlapping follow-up turn", async () => {
    const secondUserMessageId = MessageId.make("message:ingest-user-follow-up");
    const secondAssistantMessageId = MessageId.make("message:ingest-assistant-follow-up");
    const secondUserEntryId = threadEntryIdForMessageId(secondUserMessageId);
    const secondAssistantEntryId = threadEntryIdForMessageId(secondAssistantMessageId);
    const firstAssistantTurnId = TurnId.make(`${threadId}:turn:10`);
    const secondAssistantTurnId = TurnId.make(`${threadId}:turn:12`);
    const rows = await projectEvents([
      threadCreated(1),
      userMessageSent({
        sequence: 2,
        messageId: userMessageId,
        parentEntryId: null,
        text: "first",
        createdAt: "2026-06-18T12:00:00.000Z",
      }),
      turnStartRequested({
        sequence: 3,
        messageId: userMessageId,
        text: "first",
        createdAt: "2026-06-18T12:00:00.000Z",
      }),
      runtimeActivity({
        sequence: 4,
        id: "runtime-activity:first-before-follow-up",
        turnId: TurnId.make(`${threadId}:turn:1`),
        createdAt: "2026-06-18T12:00:01.000Z",
      }),
      userMessageSent({
        sequence: 5,
        messageId: secondUserMessageId,
        parentEntryId: userEntryId,
        text: "follow up",
        createdAt: "2026-06-18T12:00:02.000Z",
      }),
      turnStartRequested({
        sequence: 6,
        messageId: secondUserMessageId,
        text: "follow up",
        createdAt: "2026-06-18T12:00:02.000Z",
      }),
      runtimeActivity({
        sequence: 7,
        id: "runtime-activity:first-after-follow-up",
        turnId: TurnId.make(`${threadId}:turn:2`),
        createdAt: "2026-06-18T12:00:03.000Z",
      }),
      assistantMessageSent({
        sequence: 8,
        messageId: assistantMessageId,
        parentEntryId: userEntryId,
        turnId: firstAssistantTurnId,
        createdAt: "2026-06-18T12:00:04.000Z",
        text: "first done",
      }),
      runtimeActivity({
        sequence: 9,
        id: "runtime-activity:second-after-first-complete",
        turnId: TurnId.make(`${threadId}:turn:11`),
        createdAt: "2026-06-18T12:00:05.000Z",
      }),
      assistantMessageSent({
        sequence: 10,
        messageId: secondAssistantMessageId,
        parentEntryId: secondUserEntryId,
        turnId: secondAssistantTurnId,
        createdAt: "2026-06-18T12:00:06.000Z",
        text: "second done",
      }),
    ]);

    expect(rows.entries).toEqual([
      { entryId: userEntryId, parentEntryId: null, turnId: firstAssistantTurnId },
      { entryId: secondUserEntryId, parentEntryId: userEntryId, turnId: secondAssistantTurnId },
      { entryId: assistantEntryId, parentEntryId: userEntryId, turnId: firstAssistantTurnId },
      {
        entryId: secondAssistantEntryId,
        parentEntryId: secondUserEntryId,
        turnId: secondAssistantTurnId,
      },
    ]);
    expect(rows.activities).toEqual([
      {
        activityId: "runtime-activity:first-before-follow-up",
        turnId: firstAssistantTurnId,
        createdAt: "2026-06-18T12:00:01.000Z",
      },
      {
        activityId: "runtime-activity:first-after-follow-up",
        turnId: firstAssistantTurnId,
        createdAt: "2026-06-18T12:00:03.000Z",
      },
      {
        activityId: "runtime-activity:second-after-first-complete",
        turnId: secondAssistantTurnId,
        createdAt: "2026-06-18T12:00:05.000Z",
      },
    ]);
    expect(rows.messages).toEqual([
      { messageId: userMessageId, role: "user", turnId: firstAssistantTurnId },
      { messageId: secondUserMessageId, role: "user", turnId: secondAssistantTurnId },
      { messageId: assistantMessageId, role: "assistant", turnId: firstAssistantTurnId },
      { messageId: secondAssistantMessageId, role: "assistant", turnId: secondAssistantTurnId },
    ]);
    expect(rows.turns).toEqual([
      {
        turnId: firstAssistantTurnId,
        pendingMessageId: userMessageId,
        userEntryId,
        assistantMessageId,
        state: "completed",
        requestedAt: "2026-06-18T12:00:00.000Z",
        completedAt: "2026-06-18T12:00:04.000Z",
      },
      {
        turnId: secondAssistantTurnId,
        pendingMessageId: secondUserMessageId,
        userEntryId: secondUserEntryId,
        assistantMessageId: secondAssistantMessageId,
        state: "completed",
        requestedAt: "2026-06-18T12:00:02.000Z",
        completedAt: "2026-06-18T12:00:06.000Z",
      },
    ]);
  });
});
