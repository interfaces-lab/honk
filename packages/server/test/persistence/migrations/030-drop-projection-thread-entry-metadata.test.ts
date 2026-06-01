import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../../../src/persistence/migrations.ts";
import * as NodeSqliteClient from "../../../src/persistence/NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("030-drop-projection-thread-entry-metadata", (it) => {
  it.effect("drops obsolete thread entry metadata columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 29 });
      yield* sql`
        ALTER TABLE projection_thread_entries
        ADD COLUMN target_entry_id TEXT
      `;
      yield* sql`
        ALTER TABLE projection_thread_entries
        ADD COLUMN label TEXT
      `;
      yield* sql`
        ALTER TABLE projection_thread_entries
        ADD COLUMN summary TEXT
      `;

      yield* runMigrations({ toMigrationInclusive: 30 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_entries)
      `;
      assert.deepStrictEqual(
        columns.map((column) => column.name),
        [
          "entry_id",
          "thread_id",
          "parent_entry_id",
          "kind",
          "message_id",
          "turn_id",
          "created_at",
        ],
      );
    }),
  );
});
