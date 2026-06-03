import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    DROP TABLE IF EXISTS provider_session_runtime
  `;

  yield* sql`
    DROP INDEX IF EXISTS idx_projection_thread_sessions_provider_session
  `;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_sessions)
  `;
  const columnNames = new Set(columns.map((column) => column.name));
  const hasProviderColumns =
    columnNames.has("provider_name") ||
    columnNames.has("provider_session_id") ||
    columnNames.has("provider_thread_id") ||
    columnNames.has("provider_instance_id");

  if (!hasProviderColumns) {
    return;
  }

  yield* sql`
    DROP TABLE IF EXISTS projection_thread_sessions_rebuild
  `;

  yield* sql`
    CREATE TABLE projection_thread_sessions_rebuild (
      thread_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      active_turn_id TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    INSERT INTO projection_thread_sessions_rebuild (
      thread_id,
      status,
      runtime_mode,
      active_turn_id,
      last_error,
      updated_at
    )
    SELECT
      thread_id,
      status,
      CASE
        WHEN runtime_mode IS NULL THEN 'full-access'
        ELSE runtime_mode
      END,
      active_turn_id,
      last_error,
      updated_at
    FROM projection_thread_sessions
  `;

  yield* sql`
    DROP TABLE projection_thread_sessions
  `;

  yield* sql`
    ALTER TABLE projection_thread_sessions_rebuild
    RENAME TO projection_thread_sessions
  `;
});
