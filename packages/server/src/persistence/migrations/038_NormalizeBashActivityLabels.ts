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

const canonicalCommandActivitySummaries = [
  "Started command",
  "Running command",
  "Ran command",
  "Command failed",
] as const;

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projectionDetailPath = "$.detail";
  const projectionItemTypePath = "$.itemType";
  const projectionTitlePath = "$.title";
  const projectionDataToolNamePath = "$.data.toolName";
  const eventSummaryPath = "$.activity.summary";
  const eventDetailPath = "$.activity.payload.detail";
  const eventItemTypePath = "$.activity.payload.itemType";
  const eventTitlePath = "$.activity.payload.title";
  const eventDataToolNamePath = "$.activity.payload.data.toolName";

  for (const [legacySummary, canonicalSummary] of legacyCommandActivitySummaries) {
    yield* sql`
      UPDATE projection_thread_activities
      SET summary = ${canonicalSummary}
      WHERE kind IN ('tool.started', 'tool.updated', 'tool.completed')
        AND summary = ${legacySummary}
    `;

    yield* sql`
      UPDATE projection_thread_activities
      SET summary = ${canonicalSummary}
      WHERE kind IN ('tool.started', 'tool.updated', 'tool.completed')
        AND json_valid(payload_json)
        AND json_extract(payload_json, ${projectionDetailPath}) = ${legacySummary}
    `;

    yield* sql`
      UPDATE projection_thread_activities
      SET payload_json = json_remove(payload_json, ${projectionDetailPath})
      WHERE kind IN ('tool.started', 'tool.updated', 'tool.completed')
        AND json_valid(payload_json)
        AND json_extract(payload_json, ${projectionDetailPath}) = ${legacySummary}
    `;

    yield* sql`
      UPDATE orchestration_events
      SET payload_json = json_set(payload_json, ${eventSummaryPath}, ${canonicalSummary})
      WHERE event_type = 'thread.activity-appended'
        AND json_valid(payload_json)
        AND json_extract(payload_json, '$.activity.kind') IN (
          'tool.started',
          'tool.updated',
          'tool.completed'
        )
        AND json_extract(payload_json, ${eventSummaryPath}) = ${legacySummary}
    `;

    yield* sql`
      UPDATE orchestration_events
      SET payload_json = json_set(payload_json, ${eventSummaryPath}, ${canonicalSummary})
      WHERE event_type = 'thread.activity-appended'
        AND json_valid(payload_json)
        AND json_extract(payload_json, '$.activity.kind') IN (
          'tool.started',
          'tool.updated',
          'tool.completed'
        )
        AND json_extract(payload_json, ${eventDetailPath}) = ${legacySummary}
    `;

    yield* sql`
      UPDATE orchestration_events
      SET payload_json = json_remove(payload_json, ${eventDetailPath})
      WHERE event_type = 'thread.activity-appended'
        AND json_valid(payload_json)
        AND json_extract(payload_json, '$.activity.kind') IN (
          'tool.started',
          'tool.updated',
          'tool.completed'
        )
        AND json_extract(payload_json, ${eventDetailPath}) = ${legacySummary}
    `;
  }

  for (const canonicalSummary of canonicalCommandActivitySummaries) {
    yield* sql`
      UPDATE projection_thread_activities
      SET payload_json = json_set(
        payload_json,
        ${projectionItemTypePath},
        'command_execution',
        ${projectionTitlePath},
        'command'
      )
      WHERE kind IN ('tool.started', 'tool.updated', 'tool.completed')
        AND json_valid(payload_json)
        AND summary = ${canonicalSummary}
    `;

    yield* sql`
      UPDATE projection_thread_activities
      SET payload_json = json_set(payload_json, ${projectionDataToolNamePath}, 'bash')
      WHERE kind IN ('tool.started', 'tool.updated', 'tool.completed')
        AND json_valid(payload_json)
        AND json_type(payload_json, '$.data') = 'object'
        AND summary = ${canonicalSummary}
        AND json_extract(payload_json, ${projectionDataToolNamePath}) = 'tool'
    `;

    yield* sql`
      UPDATE orchestration_events
      SET payload_json = json_set(
        payload_json,
        ${eventItemTypePath},
        'command_execution',
        ${eventTitlePath},
        'command'
      )
      WHERE event_type = 'thread.activity-appended'
        AND json_valid(payload_json)
        AND json_extract(payload_json, '$.activity.kind') IN (
          'tool.started',
          'tool.updated',
          'tool.completed'
        )
        AND json_extract(payload_json, ${eventSummaryPath}) = ${canonicalSummary}
    `;

    yield* sql`
      UPDATE orchestration_events
      SET payload_json = json_set(payload_json, ${eventDataToolNamePath}, 'bash')
      WHERE event_type = 'thread.activity-appended'
        AND json_valid(payload_json)
        AND json_extract(payload_json, '$.activity.kind') IN (
          'tool.started',
          'tool.updated',
          'tool.completed'
        )
        AND json_type(payload_json, '$.activity.payload.data') = 'object'
        AND json_extract(payload_json, ${eventSummaryPath}) = ${canonicalSummary}
        AND json_extract(payload_json, ${eventDataToolNamePath}) = 'tool'
    `;
  }

  yield* sql`
    UPDATE projection_thread_activities
    SET payload_json = json_set(
      payload_json,
      ${projectionItemTypePath},
      'command_execution',
      ${projectionTitlePath},
      'command'
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
      'command'
    )
    WHERE event_type = 'thread.activity-appended'
      AND json_valid(payload_json)
      AND json_extract(payload_json, '$.activity.kind') IN (
        'tool.started',
        'tool.updated',
        'tool.completed'
      )
      AND json_extract(payload_json, ${eventTitlePath}) = 'bash'
  `;

  yield* sql`
    UPDATE projection_thread_activities
    SET payload_json = json_set(payload_json, ${projectionDataToolNamePath}, 'bash')
    WHERE kind IN ('tool.started', 'tool.updated', 'tool.completed')
      AND json_valid(payload_json)
      AND json_type(payload_json, '$.data') = 'object'
      AND json_extract(payload_json, ${projectionTitlePath}) = 'command'
      AND json_extract(payload_json, ${projectionItemTypePath}) = 'command_execution'
      AND json_extract(payload_json, ${projectionDataToolNamePath}) = 'tool'
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(payload_json, ${eventDataToolNamePath}, 'bash')
    WHERE event_type = 'thread.activity-appended'
      AND json_valid(payload_json)
      AND json_extract(payload_json, '$.activity.kind') IN (
        'tool.started',
        'tool.updated',
        'tool.completed'
      )
      AND json_type(payload_json, '$.activity.payload.data') = 'object'
      AND json_extract(payload_json, ${eventTitlePath}) = 'command'
      AND json_extract(payload_json, ${eventItemTypePath}) = 'command_execution'
      AND json_extract(payload_json, ${eventDataToolNamePath}) = 'tool'
  `;
});
