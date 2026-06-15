import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const commandActivitySummaries = [
  "Started command",
  "Running command",
  "Ran command",
  "Command failed",
] as const;

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projectionDetailPath = "$.detail";
  const projectionItemTypePath = "$.itemType";
  const eventKindPath = "$.activity.kind";
  const eventSummaryPath = "$.activity.summary";
  const eventDetailPath = "$.activity.payload.detail";
  const eventItemTypePath = "$.activity.payload.itemType";

  for (const summary of commandActivitySummaries) {
    yield* sql`
      DELETE FROM projection_thread_activities
      WHERE kind IN ('tool.started', 'tool.updated', 'tool.completed')
        AND summary = ${summary}
        AND json_valid(payload_json)
        AND json_extract(payload_json, ${projectionItemTypePath}) = 'command_execution'
        AND NULLIF(TRIM(COALESCE(json_extract(payload_json, ${projectionDetailPath}), '')), '') IS NULL
        AND json_type(payload_json, '$.data.args') IS NULL
        AND json_type(payload_json, '$.data.result') IS NULL
        AND json_type(payload_json, '$.data.partialResult') IS NULL
        AND json_type(payload_json, '$.data.item') IS NULL
        AND json_type(payload_json, '$.data.rawOutput') IS NULL
        AND NULLIF(TRIM(COALESCE(json_extract(payload_json, '$.data.command'), '')), '') IS NULL
        AND NULLIF(TRIM(COALESCE(json_extract(payload_json, '$.data.output'), '')), '') IS NULL
    `;

    yield* sql`
      DELETE FROM orchestration_events
      WHERE event_type = 'thread.activity-appended'
        AND json_valid(payload_json)
        AND json_extract(payload_json, ${eventKindPath}) IN (
          'tool.started',
          'tool.updated',
          'tool.completed'
        )
        AND json_extract(payload_json, ${eventSummaryPath}) = ${summary}
        AND json_extract(payload_json, ${eventItemTypePath}) = 'command_execution'
        AND NULLIF(TRIM(COALESCE(json_extract(payload_json, ${eventDetailPath}), '')), '') IS NULL
        AND json_type(payload_json, '$.activity.payload.data.args') IS NULL
        AND json_type(payload_json, '$.activity.payload.data.result') IS NULL
        AND json_type(payload_json, '$.activity.payload.data.partialResult') IS NULL
        AND json_type(payload_json, '$.activity.payload.data.item') IS NULL
        AND json_type(payload_json, '$.activity.payload.data.rawOutput') IS NULL
        AND NULLIF(
          TRIM(COALESCE(json_extract(payload_json, '$.activity.payload.data.command'), '')),
          ''
        ) IS NULL
        AND NULLIF(
          TRIM(COALESCE(json_extract(payload_json, '$.activity.payload.data.output'), '')),
          ''
        ) IS NULL
    `;
  }
});
