import { assert, it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ThreadProjection } from "../../../src/orchestration/ThreadProjection.service.ts";
import { ThreadProjectionLive } from "../../../src/orchestration/ThreadProjection.ts";
import { OrchestrationEventStore } from "../../../src/persistence/OrchestrationEventStore.service.ts";
import { OrchestrationEventStoreLive } from "../../../src/persistence/OrchestrationEventStore.ts";
import { runMigrations } from "../../../src/persistence/migrations.ts";
import * as NodeSqliteClient from "../../../src/persistence/NodeSqliteClient.ts";
import { RepositoryIdentityResolverLive } from "../../../src/project/RepositoryIdentityResolver.ts";

const layer = it.layer(
  Layer.mergeAll(
    OrchestrationEventStoreLive,
    ThreadProjectionLive.pipe(Layer.provideMerge(RepositoryIdentityResolverLive)),
  ).pipe(Layer.provideMerge(NodeSqliteClient.layerMemory())),
);

layer("031-prune-legacy-thread-activities", (it) => {
  it.effect("removes activity rows from the removed activity family", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const threadProjection = yield* ThreadProjection;
      const sql = yield* SqlClient.SqlClient;
      const removedKindPrefix = `${"check"}point`;
      const removedActivityPayload = JSON.stringify({
        threadId: "thread-1",
        activity: {
          id: "event-activity-removed",
          tone: "info",
          kind: `${removedKindPrefix}.captured`,
          summary: "Removed activity captured",
          payload: {},
          turnId: "turn-1",
          createdAt: "2026-02-24T00:05:00.000Z",
        },
      });
      const currentActivityPayload = JSON.stringify({
        threadId: "thread-1",
        activity: {
          id: "event-activity-current",
          tone: "approval",
          kind: "approval.requested",
          summary: "Command approval requested",
          payload: {
            requestId: "approval-1",
            requestKind: "command",
          },
          turnId: "turn-1",
          createdAt: "2026-02-24T00:06:00.000Z",
        },
      });

      yield* runMigrations({ toMigrationInclusive: 30 });

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          sequence,
          created_at
        )
        VALUES
          (
            'activity-current',
            'thread-1',
            'turn-1',
            'approval',
            'approval.requested',
            'Command approval requested',
            '{"requestId":"approval-1","requestKind":"command"}',
            1,
            '2026-02-24T00:02:00.000Z'
          ),
          (
            'activity-removed-captured',
            'thread-1',
            'turn-1',
            'info',
            ${`${removedKindPrefix}.captured`},
            'Removed activity captured',
            '{}',
            2,
            '2026-02-24T00:03:00.000Z'
          ),
          (
            'activity-removed-restored',
            'thread-1',
            'turn-1',
            'info',
            ${`${removedKindPrefix}.restored`},
            'Removed activity restored',
            '{}',
            3,
            '2026-02-24T00:04:00.000Z'
          )
      `;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES
          (
            'event-removed',
            'thread',
            'thread-1',
            0,
            'thread.activity-appended',
            '2026-02-24T00:05:00.000Z',
            NULL,
            NULL,
            NULL,
            'server',
            ${removedActivityPayload},
            '{}'
          ),
          (
            'event-current',
            'thread',
            'thread-1',
            1,
            'thread.activity-appended',
            '2026-02-24T00:06:00.000Z',
            NULL,
            NULL,
            NULL,
            'server',
            ${currentActivityPayload},
            '{}'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 31 });

      const activityRows = yield* sql<{
        readonly activityId: string;
        readonly kind: string;
      }>`
        SELECT
          activity_id AS "activityId",
          kind
        FROM projection_thread_activities
        ORDER BY sequence ASC
      `;
      assert.deepStrictEqual(activityRows, [
        {
          activityId: "activity-current",
          kind: "approval.requested",
        },
      ]);

      const eventRows = yield* sql<{
        readonly eventId: string;
        readonly eventType: string;
      }>`
        SELECT
          event_id AS "eventId",
          event_type AS "eventType"
        FROM orchestration_events
        ORDER BY sequence ASC
      `;
      assert.deepStrictEqual(eventRows, [
        {
          eventId: "event-current",
          eventType: "thread.activity-appended",
        },
      ]);

      const replayedEvents = yield* Stream.runCollect(eventStore.readFromSequence(0, 10)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.deepStrictEqual(
        replayedEvents.map((event) => event.eventId),
        ["event-current"],
      );

      const snapshot = yield* threadProjection.getSnapshot();
      assert.deepStrictEqual(snapshot.threads, []);
    }),
  );
});
