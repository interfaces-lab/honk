import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const turnColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_turns)
  `;
  const turnColumnNames = new Set(turnColumns.map((column) => column.name));
  const hasLegacyCheckpointColumns =
    turnColumnNames.has("checkpoint_turn_count") ||
    turnColumnNames.has("checkpoint_ref") ||
    turnColumnNames.has("checkpoint_status") ||
    turnColumnNames.has("checkpoint_files_json");

  if (hasLegacyCheckpointColumns) {
    yield* sql`
      DROP TABLE IF EXISTS projection_turns_rebuild
    `;

    yield* sql`
      CREATE TABLE projection_turns_rebuild (
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
        UNIQUE (thread_id, turn_id)
      )
    `;

    yield* sql`
      INSERT INTO projection_turns_rebuild (
        row_id,
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
      SELECT
        row_id,
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
      FROM projection_turns
    `;

    yield* sql`
      DROP TABLE projection_turns
    `;

    yield* sql`
      ALTER TABLE projection_turns_rebuild
      RENAME TO projection_turns
    `;

    yield* sql`
      CREATE INDEX IF NOT EXISTS idx_projection_turns_thread_requested
      ON projection_turns(thread_id, requested_at)
    `;
  }

  yield* sql`
    DROP TABLE IF EXISTS checkpoint_diff_blobs
  `;

  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const threadColumnNames = new Set(threadColumns.map((column) => column.name));

  if (!threadColumnNames.has("leaf_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN leaf_id TEXT
    `;
  }

  if (threadColumnNames.has("active_entry_id")) {
    yield* sql`
      UPDATE projection_threads
      SET leaf_id = active_entry_id
      WHERE leaf_id IS NULL
    `;

    yield* sql`
      ALTER TABLE projection_threads
      DROP COLUMN active_entry_id
    `;
  }
});
