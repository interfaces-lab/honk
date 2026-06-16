import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const rebuiltProjectors = [
  "projection.thread-entries",
  "projection.thread-sessions",
  "projection.threads",
] as const;

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    DELETE FROM projection_thread_entries
  `;

  yield* sql`
    UPDATE projection_threads
    SET leaf_id = NULL
  `;

  yield* sql`
    DELETE FROM projection_thread_sessions
  `;

  for (const projector of rebuiltProjectors) {
    yield* sql`
      DELETE FROM projection_state
      WHERE projector = ${projector}
    `;
  }
});
