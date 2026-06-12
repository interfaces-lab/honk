import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_thread_activities
    SET payload_json = json_set(
      payload_json,
      '$.subagentThreadId',
      json_extract(payload_json, '$.providerThreadId')
    )
    WHERE kind LIKE 'subagent.%'
      AND json_valid(payload_json)
      AND json_extract(payload_json, '$.subagentThreadId') IS NULL
      AND json_extract(payload_json, '$.providerThreadId') IS NOT NULL
  `;

  yield* sql`
    UPDATE projection_thread_activities
    SET payload_json = json_set(
      payload_json,
      '$.parentThreadId',
      json_extract(payload_json, '$.parentProviderThreadId')
    )
    WHERE kind LIKE 'subagent.%'
      AND json_valid(payload_json)
      AND json_extract(payload_json, '$.parentThreadId') IS NULL
      AND json_extract(payload_json, '$.parentProviderThreadId') IS NOT NULL
  `;

  yield* sql`
    UPDATE projection_thread_activities
    SET payload_json = json_remove(
      payload_json,
      '$.providerThreadId',
      '$.parentProviderThreadId'
    )
    WHERE kind LIKE 'subagent.%'
      AND json_valid(payload_json)
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(
      payload_json,
      '$.activity.payload.subagentThreadId',
      json_extract(payload_json, '$.activity.payload.providerThreadId')
    )
    WHERE event_type = 'thread.activity-appended'
      AND json_valid(payload_json)
      AND json_extract(payload_json, '$.activity.kind') LIKE 'subagent.%'
      AND json_extract(payload_json, '$.activity.payload.subagentThreadId') IS NULL
      AND json_extract(payload_json, '$.activity.payload.providerThreadId') IS NOT NULL
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(
      payload_json,
      '$.activity.payload.parentThreadId',
      json_extract(payload_json, '$.activity.payload.parentProviderThreadId')
    )
    WHERE event_type = 'thread.activity-appended'
      AND json_valid(payload_json)
      AND json_extract(payload_json, '$.activity.kind') LIKE 'subagent.%'
      AND json_extract(payload_json, '$.activity.payload.parentThreadId') IS NULL
      AND json_extract(payload_json, '$.activity.payload.parentProviderThreadId') IS NOT NULL
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_remove(
      payload_json,
      '$.activity.payload.providerThreadId',
      '$.activity.payload.parentProviderThreadId'
    )
    WHERE event_type = 'thread.activity-appended'
      AND json_valid(payload_json)
      AND json_extract(payload_json, '$.activity.kind') LIKE 'subagent.%'
  `;
});
