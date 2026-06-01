import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "./Errors.ts";
import {
  DeleteProjectionPendingTurnStartInput,
  DeleteProjectionTurnsByThreadInput,
  GetProjectionPendingTurnStartInput,
  GetProjectionTurnByTurnIdInput,
  ListProjectionTurnsByThreadInput,
  ProjectionPendingTurnStart,
  ProjectionTurn,
  ProjectionTurnById,
  ProjectionTurnRepository,
  type ProjectionTurnRepositoryShape,
} from "./ProjectionTurns.service.ts";

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionTurnRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionTurnById = SqlSchema.void({
    Request: ProjectionTurnById,
    execute: (row) =>
      sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          user_entry_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at
        )
        VALUES (
          ${row.threadId},
          ${row.turnId},
          ${row.pendingMessageId},
          ${row.userEntryId},
          ${row.sourceProposedPlanThreadId},
          ${row.sourceProposedPlanId},
          ${row.assistantMessageId},
          ${row.state},
          ${row.requestedAt},
          ${row.startedAt},
          ${row.completedAt}
        )
        ON CONFLICT (thread_id, turn_id)
        DO UPDATE SET
          pending_message_id = excluded.pending_message_id,
          user_entry_id = excluded.user_entry_id,
          source_proposed_plan_thread_id = excluded.source_proposed_plan_thread_id,
          source_proposed_plan_id = excluded.source_proposed_plan_id,
          assistant_message_id = excluded.assistant_message_id,
          state = excluded.state,
          requested_at = excluded.requested_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at
      `,
  });

  const insertPendingProjectionTurn = SqlSchema.void({
    Request: ProjectionPendingTurnStart,
    execute: (row) =>
      sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          user_entry_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at
        )
        VALUES (
          ${row.threadId},
          NULL,
          ${row.messageId},
          ${row.userEntryId},
          ${row.sourceProposedPlanThreadId},
          ${row.sourceProposedPlanId},
          NULL,
          'pending',
          ${row.requestedAt},
          NULL,
          NULL
        )
      `,
  });

  const getPendingProjectionTurn = SqlSchema.findOneOption({
    Request: GetProjectionPendingTurnStartInput,
    Result: ProjectionPendingTurnStart,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          pending_message_id AS "messageId",
          user_entry_id AS "userEntryId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          requested_at AS "requestedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id IS NULL
          AND state = 'pending'
          AND pending_message_id IS NOT NULL
        ORDER BY requested_at ASC, row_id ASC
        LIMIT 1
      `,
  });

  const deletePendingProjectionTurn = SqlSchema.void({
    Request: DeleteProjectionPendingTurnStartInput,
    execute: ({ threadId, messageId }) =>
      sql`
        DELETE FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id IS NULL
          AND state = 'pending'
          AND pending_message_id = ${messageId}
      `,
  });

  const listProjectionTurnsByThread = SqlSchema.findAll({
    Request: ListProjectionTurnsByThreadInput,
    Result: ProjectionTurn,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          pending_message_id AS "pendingMessageId",
          user_entry_id AS "userEntryId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          assistant_message_id AS "assistantMessageId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
        ORDER BY requested_at ASC, turn_id ASC
      `,
  });

  const getProjectionTurnByTurnId = SqlSchema.findOneOption({
    Request: GetProjectionTurnByTurnIdInput,
    Result: ProjectionTurnById,
    execute: ({ threadId, turnId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          pending_message_id AS "pendingMessageId",
          user_entry_id AS "userEntryId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          assistant_message_id AS "assistantMessageId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id = ${turnId}
        LIMIT 1
      `,
  });

  const deleteProjectionTurnsByThread = SqlSchema.void({
    Request: DeleteProjectionTurnsByThreadInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_turns
        WHERE thread_id = ${threadId}
      `,
  });

  const upsertByTurnId: ProjectionTurnRepositoryShape["upsertByTurnId"] = (row) =>
    upsertProjectionTurnById(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionTurnRepository.upsertByTurnId:query",
          "ProjectionTurnRepository.upsertByTurnId:encodeRequest",
        ),
      ),
    );

  const appendPendingTurnStart: ProjectionTurnRepositoryShape["appendPendingTurnStart"] = (row) =>
    insertPendingProjectionTurn(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionTurnRepository.appendPendingTurnStart:query",
          "ProjectionTurnRepository.appendPendingTurnStart:encodeRequest",
        ),
      ),
    );

  const getNextPendingTurnStartByThreadId: ProjectionTurnRepositoryShape["getNextPendingTurnStartByThreadId"] =
    (input) =>
      getPendingProjectionTurn(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionTurnRepository.getNextPendingTurnStartByThreadId:query"),
        ),
      );

  const deletePendingTurnStart: ProjectionTurnRepositoryShape["deletePendingTurnStart"] = (input) =>
    deletePendingProjectionTurn(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionTurnRepository.deletePendingTurnStart:query"),
      ),
    );

  const listByThreadId: ProjectionTurnRepositoryShape["listByThreadId"] = (input) =>
    listProjectionTurnsByThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionTurnRepository.listByThreadId:query",
          "ProjectionTurnRepository.listByThreadId:decodeRows",
        ),
      ),
      Effect.map((rows) => rows as ReadonlyArray<Schema.Schema.Type<typeof ProjectionTurn>>),
    );

  const getByTurnId: ProjectionTurnRepositoryShape["getByTurnId"] = (input) =>
    getProjectionTurnByTurnId(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionTurnRepository.getByTurnId:query",
          "ProjectionTurnRepository.getByTurnId:decodeRow",
        ),
      ),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) =>
            Effect.succeed(Option.some(row as Schema.Schema.Type<typeof ProjectionTurnById>)),
        }),
      ),
    );

  const deleteByThreadId: ProjectionTurnRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionTurnsByThread(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTurnRepository.deleteByThreadId:query")),
    );

  return {
    upsertByTurnId,
    appendPendingTurnStart,
    getNextPendingTurnStartByThreadId,
    deletePendingTurnStart,
    listByThreadId,
    getByTurnId,
    deleteByThreadId,
  } satisfies ProjectionTurnRepositoryShape;
});

export const ProjectionTurnRepositoryLive = Layer.effect(
  ProjectionTurnRepository,
  makeProjectionTurnRepository,
);
