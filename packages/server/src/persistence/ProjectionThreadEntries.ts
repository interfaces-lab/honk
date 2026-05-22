import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer } from "effect";

import { toPersistenceSqlError } from "./Errors.ts";
import {
  DeleteProjectionThreadEntriesInput,
  GetProjectionThreadEntryInput,
  ListProjectionThreadEntriesInput,
  ProjectionThreadEntry,
  ProjectionThreadEntryRepository,
  type ProjectionThreadEntryRepositoryShape,
} from "./ProjectionThreadEntries.service.ts";

const makeProjectionThreadEntryRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadEntryRow = SqlSchema.void({
    Request: ProjectionThreadEntry,
    execute: (row) =>
      sql`
        INSERT INTO projection_thread_entries (
          entry_id,
          thread_id,
          parent_entry_id,
          kind,
          message_id,
          turn_id,
          target_entry_id,
          label,
          summary,
          created_at
        )
        VALUES (
          ${row.entryId},
          ${row.threadId},
          ${row.parentEntryId},
          ${row.kind},
          ${row.messageId},
          ${row.turnId},
          ${row.targetEntryId},
          ${row.label},
          ${row.summary},
          ${row.createdAt}
        )
        ON CONFLICT (entry_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          parent_entry_id = excluded.parent_entry_id,
          kind = excluded.kind,
          message_id = excluded.message_id,
          turn_id = excluded.turn_id,
          target_entry_id = excluded.target_entry_id,
          label = excluded.label,
          summary = excluded.summary,
          created_at = excluded.created_at
      `,
  });

  const getProjectionThreadEntryRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadEntryInput,
    Result: ProjectionThreadEntry,
    execute: ({ entryId }) =>
      sql`
        SELECT
          entry_id AS "entryId",
          thread_id AS "threadId",
          parent_entry_id AS "parentEntryId",
          kind,
          message_id AS "messageId",
          turn_id AS "turnId",
          target_entry_id AS "targetEntryId",
          label,
          summary,
          created_at AS "createdAt"
        FROM projection_thread_entries
        WHERE entry_id = ${entryId}
        LIMIT 1
      `,
  });

  const listProjectionThreadEntryRows = SqlSchema.findAll({
    Request: ListProjectionThreadEntriesInput,
    Result: ProjectionThreadEntry,
    execute: ({ threadId }) =>
      sql`
        SELECT
          entry_id AS "entryId",
          thread_id AS "threadId",
          parent_entry_id AS "parentEntryId",
          kind,
          message_id AS "messageId",
          turn_id AS "turnId",
          target_entry_id AS "targetEntryId",
          label,
          summary,
          created_at AS "createdAt"
        FROM projection_thread_entries
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, entry_id ASC
      `,
  });

  const deleteProjectionThreadEntryRows = SqlSchema.void({
    Request: DeleteProjectionThreadEntriesInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_entries
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionThreadEntryRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadEntryRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadEntryRepository.upsert:query")),
    );

  const getByEntryId: ProjectionThreadEntryRepositoryShape["getByEntryId"] = (input) =>
    getProjectionThreadEntryRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadEntryRepository.getByEntryId:query")),
    );

  const listByThreadId: ProjectionThreadEntryRepositoryShape["listByThreadId"] = (input) =>
    listProjectionThreadEntryRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadEntryRepository.listByThreadId:query"),
      ),
    );

  const deleteByThreadId: ProjectionThreadEntryRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionThreadEntryRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadEntryRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    getByEntryId,
    listByThreadId,
    deleteByThreadId,
  } satisfies ProjectionThreadEntryRepositoryShape;
});

export const ProjectionThreadEntryRepositoryLive = Layer.effect(
  ProjectionThreadEntryRepository,
  makeProjectionThreadEntryRepository,
);
