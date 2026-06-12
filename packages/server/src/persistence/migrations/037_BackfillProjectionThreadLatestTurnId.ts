import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    WITH latest_turns AS (
      SELECT thread_id, turn_id, requested_at
      FROM (
        SELECT
          thread_id,
          turn_id,
          requested_at,
          row_number() OVER (
            PARTITION BY thread_id
            ORDER BY requested_at DESC, turn_id DESC
          ) AS row_number
        FROM projection_turns
        WHERE turn_id IS NOT NULL
      )
      WHERE row_number = 1
    )
    UPDATE projection_threads
    SET latest_turn_id = (
      SELECT latest_turns.turn_id
      FROM latest_turns
      WHERE latest_turns.thread_id = projection_threads.thread_id
    )
    WHERE EXISTS (
      SELECT 1
      FROM latest_turns
      WHERE latest_turns.thread_id = projection_threads.thread_id
    )
      AND (
        latest_turn_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM projection_turns current_turn
          WHERE current_turn.thread_id = projection_threads.thread_id
            AND current_turn.turn_id = projection_threads.latest_turn_id
        )
        OR (
          SELECT latest_turns.requested_at
          FROM latest_turns
          WHERE latest_turns.thread_id = projection_threads.thread_id
        ) > (
          SELECT current_turn.requested_at
          FROM projection_turns current_turn
          WHERE current_turn.thread_id = projection_threads.thread_id
            AND current_turn.turn_id = projection_threads.latest_turn_id
          LIMIT 1
        )
      )
  `;
});
