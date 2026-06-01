import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const removedKindPattern = `${"check"}point.%`;
  const activityKindJsonPath = "$.activity.kind";

  yield* sql`
    DELETE FROM projection_thread_activities
    WHERE kind LIKE ${removedKindPattern}
  `;

  yield* sql`
    DELETE FROM orchestration_events
    WHERE event_type = 'thread.activity-appended'
      AND json_valid(payload_json)
      AND json_extract(payload_json, ${activityKindJsonPath}) LIKE ${removedKindPattern}
  `;
});
