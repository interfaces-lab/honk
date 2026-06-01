import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../../../src/persistence/migrations.ts";
import * as NodeSqliteClient from "../../../src/persistence/NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("032-drop-legacy-projection-columns", (it) => {
  it.effect("drops checkpoint columns and repairs stale thread leaf rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 31 });
      yield* sql`
        DROP TABLE projection_turns
      `;
      yield* sql`
        CREATE TABLE projection_turns (
          row_id INTEGER PRIMARY KEY AUTOINCREMENT,
          thread_id TEXT NOT NULL,
          turn_id TEXT,
          pending_message_id TEXT,
          user_entry_id TEXT,
          source_proposed_plan_thread_id TEXT,
          source_proposed_plan_id TEXT,
          assistant_message_id TEXT,
          state TEXT NOT NULL,
          requested_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          checkpoint_turn_count INTEGER,
          checkpoint_ref TEXT,
          checkpoint_status TEXT,
          checkpoint_files_json TEXT NOT NULL,
          UNIQUE (thread_id, turn_id),
          UNIQUE (thread_id, checkpoint_turn_count)
        )
      `;
      yield* sql`
        CREATE INDEX idx_projection_turns_thread_checkpoint_completed
        ON projection_turns(thread_id, checkpoint_turn_count, completed_at)
      `;
      yield* sql`
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
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES (
          'thread-1',
          'turn-1',
          'message-user-1',
          'entry-user-1',
          NULL,
          NULL,
          'message-assistant-1',
          'completed',
          '2026-05-30T00:00:00.000Z',
          '2026-05-30T00:00:01.000Z',
          '2026-05-30T00:00:02.000Z',
          1,
          'checkpoint-1',
          'captured',
          '[]'
        )
      `;
      yield* sql`
        CREATE TABLE checkpoint_diff_blobs (
          thread_id TEXT NOT NULL,
          from_turn_count INTEGER NOT NULL,
          to_turn_count INTEGER NOT NULL,
          diff TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (thread_id, from_turn_count, to_turn_count)
        )
      `;
      yield* sql`
        DROP TABLE projection_threads
      `;
      yield* sql`
        CREATE TABLE projection_threads (
          thread_id TEXT PRIMARY KEY,
          project_id TEXT,
          title TEXT NOT NULL,
          branch TEXT,
          worktree_path TEXT,
          latest_turn_id TEXT,
          active_entry_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          runtime_mode TEXT NOT NULL DEFAULT 'full-access',
          interaction_mode TEXT NOT NULL DEFAULT 'default',
          model_selection_json TEXT,
          archived_at TEXT,
          latest_user_message_at TEXT,
          pending_approval_count INTEGER NOT NULL DEFAULT 0,
          pending_user_input_count INTEGER NOT NULL DEFAULT 0,
          has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          branch,
          worktree_path,
          latest_turn_id,
          active_entry_id,
          created_at,
          updated_at,
          deleted_at,
          runtime_mode,
          interaction_mode,
          model_selection_json,
          archived_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread 1',
          NULL,
          NULL,
          'turn-1',
          'entry-leaf-1',
          '2026-05-30T00:00:00.000Z',
          '2026-05-30T00:00:01.000Z',
          NULL,
          'full-access',
          'default',
          '{"instanceId":"codex","model":"gpt-5-codex"}',
          NULL,
          '2026-05-30T00:00:02.000Z',
          0,
          0,
          0
        )
      `;

      yield* runMigrations();

      const turnColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_turns)
      `;
      assert.deepStrictEqual(
        turnColumns.map((column) => column.name),
        [
          "row_id",
          "thread_id",
          "turn_id",
          "pending_message_id",
          "user_entry_id",
          "source_proposed_plan_thread_id",
          "source_proposed_plan_id",
          "assistant_message_id",
          "state",
          "requested_at",
          "started_at",
          "completed_at",
        ],
      );

      const turnIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_turns)
      `;
      assert.equal(
        turnIndexes.some(
          (index) => index.name === "idx_projection_turns_thread_checkpoint_completed",
        ),
        false,
      );

      yield* sql`
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
          'thread-1',
          NULL,
          'message-user-2',
          'entry-user-2',
          NULL,
          NULL,
          NULL,
          'pending',
          '2026-05-30T00:00:03.000Z',
          NULL,
          NULL
        )
      `;

      const turnRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM projection_turns
      `;
      assert.deepStrictEqual(turnRows, [{ count: 2 }]);

      const checkpointTables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_schema
        WHERE type = 'table'
          AND name = 'checkpoint_diff_blobs'
      `;
      assert.deepStrictEqual(checkpointTables, []);

      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.equal(
        threadColumns.some((column) => column.name === "leaf_id"),
        true,
      );
      assert.equal(
        threadColumns.some((column) => column.name === "active_entry_id"),
        false,
      );

      const threadRows = yield* sql<{ readonly leafId: string | null }>`
        SELECT leaf_id AS "leafId"
        FROM projection_threads
        WHERE thread_id = 'thread-1'
      `;
      assert.deepStrictEqual(threadRows, [{ leafId: "entry-leaf-1" }]);
    }),
  );
});
