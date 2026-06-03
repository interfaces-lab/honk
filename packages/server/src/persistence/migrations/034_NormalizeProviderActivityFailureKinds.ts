import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const legacyActivityKinds = [
  ["provider.turn.start.failed", "runtime.turn.start.failed"],
  ["provider.turn.interrupt.failed", "runtime.turn.interrupt.failed"],
  ["provider.approval.respond.failed", "runtime.approval.respond.failed"],
  ["provider.user-input.respond.failed", "runtime.user-input.respond.failed"],
  ["provider.session.stop.failed", "runtime.session.stop.failed"],
] as const;

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const activityKindJsonPath = "$.activity.kind";

  for (const [legacyKind, runtimeKind] of legacyActivityKinds) {
    yield* sql`
      UPDATE projection_thread_activities
      SET kind = ${runtimeKind}
      WHERE kind = ${legacyKind}
    `;

    yield* sql`
      UPDATE orchestration_events
      SET payload_json = json_set(payload_json, ${activityKindJsonPath}, ${runtimeKind})
      WHERE event_type = 'thread.activity-appended'
        AND json_valid(payload_json)
        AND json_extract(payload_json, ${activityKindJsonPath}) = ${legacyKind}
    `;
  }
});
