import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_entries)
  `;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columnNames.has("target_entry_id")) {
    yield* sql`
      ALTER TABLE projection_thread_entries
      DROP COLUMN target_entry_id
    `;
  }
  if (columnNames.has("label")) {
    yield* sql`
      ALTER TABLE projection_thread_entries
      DROP COLUMN label
    `;
  }
  if (columnNames.has("summary")) {
    yield* sql`
      ALTER TABLE projection_thread_entries
      DROP COLUMN summary
    `;
  }
});
