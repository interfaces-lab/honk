import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const rebuiltProjectors = [
  "projection.thread-messages",
  "projection.thread-entries",
  "projection.thread-activities",
  "projection.thread-sessions",
  "projection.thread-turns",
  "projection.threads",
] as const;

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    DELETE FROM projection_thread_messages
  `;

  yield* sql`
    DELETE FROM projection_thread_entries
  `;

  yield* sql`
    DELETE FROM projection_thread_activities
  `;

  yield* sql`
    DELETE FROM projection_thread_sessions
  `;

  yield* sql`
    DELETE FROM projection_turns
  `;

  yield* sql`
    UPDATE projection_threads
    SET
      latest_turn_id = NULL,
      leaf_id = NULL,
      latest_user_message_at = NULL,
      pending_approval_count = 0,
      pending_user_input_count = 0,
      has_actionable_proposed_plan = 0
  `;

  for (const projector of rebuiltProjectors) {
    yield* sql`
      DELETE FROM projection_state
      WHERE projector = ${projector}
    `;
  }
});
