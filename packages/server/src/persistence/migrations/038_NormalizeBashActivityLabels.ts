import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const legacyCommandActivitySummaries = [
  ["Started bash", "Started command"],
  ["Running bash", "Running command"],
  ["Ran bash", "Ran command"],
  ["Completed bash", "Ran command"],
  ["Bash failed", "Command failed"],
  ["bash failed", "Command failed"],
] as const;

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projectionDetailPath = "$.detail";
  const projectionItemTypePath = "$.itemType";
  const projectionTitlePath = "$.title";
  const projectionDataToolNamePath = "$.data.toolName";
  const eventKindPath = "$.activity.kind";
  const eventSummaryPath = "$.activity.summary";
  const eventDetailPath = "$.activity.payload.detail";
  const eventItemTypePath = "$.activity.payload.itemType";
  const eventTitlePath = "$.activity.payload.title";
  const eventDataToolNamePath = "$.activity.payload.data.toolName";

  for (const [legacySummary, canonicalSummary] of legacyCommandActivitySummaries) {
    yield* sql`
      UPDATE projection_thread_activities
      SET
        summary = ${canonicalSummary},
        payload_json = CASE
          WHEN json_valid(payload_json) THEN json_remove(
            json_set(
              payload_json,
              ${projectionItemTypePath},
              'command_execution',
              ${projectionTitlePath},
              'command',
              ${projectionDataToolNamePath},
              'bash'
            ),
            ${projectionDetailPath}
          )
          ELSE payload_json
        END
      WHERE kind IN ('tool.started', 'tool.updated', 'tool.completed')
        AND (
          summary = ${legacySummary}
          OR (
            json_valid(payload_json)
            AND json_extract(payload_json, ${projectionDetailPath}) = ${legacySummary}
          )
        )
    `;

    yield* sql`
      UPDATE orchestration_events
      SET payload_json = json_remove(
        json_set(
          payload_json,
          ${eventSummaryPath},
          ${canonicalSummary},
          ${eventItemTypePath},
          'command_execution',
          ${eventTitlePath},
          'command',
          ${eventDataToolNamePath},
          'bash'
        ),
        ${eventDetailPath}
      )
      WHERE event_type = 'thread.activity-appended'
        AND json_valid(payload_json)
        AND json_extract(payload_json, ${eventKindPath}) IN (
          'tool.started',
          'tool.updated',
          'tool.completed'
        )
        AND (
          json_extract(payload_json, ${eventSummaryPath}) = ${legacySummary}
          OR json_extract(payload_json, ${eventDetailPath}) = ${legacySummary}
        )
    `;
  }

  yield* sql`
    UPDATE projection_thread_activities
    SET payload_json = json_set(
      payload_json,
      ${projectionItemTypePath},
      'command_execution',
      ${projectionTitlePath},
      'command',
      ${projectionDataToolNamePath},
      'bash'
    )
    WHERE kind IN ('tool.started', 'tool.updated', 'tool.completed')
      AND json_valid(payload_json)
      AND json_extract(payload_json, ${projectionTitlePath}) = 'bash'
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(
      payload_json,
      ${eventItemTypePath},
      'command_execution',
      ${eventTitlePath},
      'command',
      ${eventDataToolNamePath},
      'bash'
    )
    WHERE event_type = 'thread.activity-appended'
      AND json_valid(payload_json)
      AND json_extract(payload_json, ${eventKindPath}) IN (
        'tool.started',
        'tool.updated',
        'tool.completed'
      )
      AND json_extract(payload_json, ${eventTitlePath}) = 'bash'
  `;
});
