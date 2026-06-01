import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_entries (
      entry_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      parent_entry_id TEXT,
      kind TEXT NOT NULL,
      message_id TEXT,
      turn_id TEXT,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_entries_thread_created
    ON projection_thread_entries(thread_id, created_at, entry_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_entries_thread_parent
    ON projection_thread_entries(thread_id, parent_entry_id)
  `;

  const projectionThreadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!projectionThreadColumns.some((column) => column.name === "leaf_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN leaf_id TEXT
    `;
  }

  const projectionTurnColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_turns)
  `;
  if (!projectionTurnColumns.some((column) => column.name === "user_entry_id")) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN user_entry_id TEXT
    `;
  }

  yield* sql`
    INSERT OR IGNORE INTO projection_thread_entries (
      entry_id,
      thread_id,
      parent_entry_id,
      kind,
      message_id,
      turn_id,
      created_at
    )
    SELECT
      'message:' || message_id AS entry_id,
      thread_id,
      LAG('message:' || message_id) OVER (
        PARTITION BY thread_id
        ORDER BY created_at ASC, message_id ASC
      ) AS parent_entry_id,
      'message' AS kind,
      message_id,
      turn_id,
      created_at
    FROM projection_thread_messages
  `;

  yield* sql`
    UPDATE projection_turns
    SET user_entry_id = 'message:' || pending_message_id
    WHERE user_entry_id IS NULL
      AND pending_message_id IS NOT NULL
  `;

  yield* sql`
    UPDATE projection_threads
    SET leaf_id = (
      SELECT entry.entry_id
      FROM projection_thread_entries AS entry
      WHERE entry.thread_id = projection_threads.thread_id
        AND entry.kind = 'message'
      ORDER BY entry.created_at DESC, entry.entry_id DESC
      LIMIT 1
    )
    WHERE leaf_id IS NULL
  `;
});
