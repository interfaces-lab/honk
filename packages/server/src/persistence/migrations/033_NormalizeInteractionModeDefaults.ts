import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_threads
    SET interaction_mode = 'agent'
    WHERE interaction_mode = 'default'
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(payload_json, '$.interactionMode', 'agent')
    WHERE json_valid(payload_json)
      AND json_extract(payload_json, '$.interactionMode') = 'default'
  `;
});
