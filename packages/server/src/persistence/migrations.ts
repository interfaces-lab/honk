/**
 * MigrationsLive - Migration runner with inline loader
 *
 * Uses Migrator.make with fromRecord to define migrations inline.
 * All migrations are statically imported - no dynamic file system loading.
 *
 * Migrations run automatically when the MigrationLayer is provided,
 * ensuring the database schema is always up-to-date before the application starts.
 */

import * as Migrator from "effect/unstable/sql/Migrator";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";

// Import all migrations statically
import Migration0001 from "./migrations/001_OrchestrationEvents.ts";
import Migration0002 from "./migrations/002_OrchestrationCommandReceipts.ts";
import Migration0004 from "./migrations/004_ProviderSessionRuntime.ts";
import Migration0005 from "./migrations/005_Projections.ts";
import Migration0006 from "./migrations/006_ProjectionThreadSessionRuntimeModeColumns.ts";
import Migration0007 from "./migrations/007_ProjectionThreadMessageAttachments.ts";
import Migration0008 from "./migrations/008_ProjectionThreadActivitySequence.ts";
import Migration0009 from "./migrations/009_ProviderSessionRuntimeMode.ts";
import Migration0010 from "./migrations/010_ProjectionThreadsRuntimeMode.ts";
import Migration0011 from "./migrations/011_OrchestrationThreadCreatedRuntimeMode.ts";
import Migration0012 from "./migrations/012_ProjectionThreadsInteractionMode.ts";
import Migration0013 from "./migrations/013_ProjectionThreadProposedPlans.ts";
import Migration0014 from "./migrations/014_ProjectionThreadProposedPlanImplementation.ts";
import Migration0015 from "./migrations/015_ProjectionTurnsSourceProposedPlan.ts";
import Migration0016 from "./migrations/016_CanonicalizeModelSelections.ts";
import Migration0017 from "./migrations/017_ProjectionThreadsArchivedAt.ts";
import Migration0018 from "./migrations/018_ProjectionThreadsArchivedAtIndex.ts";
import Migration0019 from "./migrations/019_ProjectionSnapshotLookupIndexes.ts";
import Migration0020 from "./migrations/020_AuthAccessManagement.ts";
import Migration0021 from "./migrations/021_AuthSessionClientMetadata.ts";
import Migration0022 from "./migrations/022_AuthSessionLastConnectedAt.ts";
import Migration0023 from "./migrations/023_ProjectionThreadShellSummary.ts";
import Migration0024 from "./migrations/024_BackfillProjectionThreadShellSummary.ts";
import Migration0025 from "./migrations/025_ProviderInstanceIdColumns.ts";
import Migration0026 from "./migrations/026_NormalizeCanonicalModelSelectionJson.ts";
import Migration0027 from "./migrations/027_ProjectionThreadEntries.ts";
import Migration0028 from "./migrations/028_ProjectionThreadMessageRichText.ts";
import Migration0030 from "./migrations/030-drop-projection-thread-entry-metadata.ts";
import Migration0031 from "./migrations/031-prune-legacy-thread-activities.ts";
import Migration0032 from "./migrations/032-drop-legacy-projection-columns.ts";
import Migration0033 from "./migrations/033_NormalizeInteractionModeDefaults.ts";
import Migration0034 from "./migrations/034_NormalizeProviderActivityFailureKinds.ts";
import Migration0035 from "./migrations/035_DropProviderSessionSchemaResidue.ts";
import Migration0036 from "./migrations/036_NormalizeSubagentActivityPayloadThreadIds.ts";

/**
 * Migration loader with all migrations defined inline.
 *
 * Key format: "{id}_{name}" where:
 * - id: numeric migration ID (determines execution order)
 * - name: descriptive name for the migration
 *
 * Uses Migrator.fromRecord which parses the key format and
 * returns migrations sorted by ID.
 */
export const migrationEntries = [
  [1, "OrchestrationEvents", Migration0001],
  [2, "OrchestrationCommandReceipts", Migration0002],
  [4, "ProviderSessionRuntime", Migration0004],
  [5, "Projections", Migration0005],
  [6, "ProjectionThreadSessionRuntimeModeColumns", Migration0006],
  [7, "ProjectionThreadMessageAttachments", Migration0007],
  [8, "ProjectionThreadActivitySequence", Migration0008],
  [9, "ProviderSessionRuntimeMode", Migration0009],
  [10, "ProjectionThreadsRuntimeMode", Migration0010],
  [11, "OrchestrationThreadCreatedRuntimeMode", Migration0011],
  [12, "ProjectionThreadsInteractionMode", Migration0012],
  [13, "ProjectionThreadProposedPlans", Migration0013],
  [14, "ProjectionThreadProposedPlanImplementation", Migration0014],
  [15, "ProjectionTurnsSourceProposedPlan", Migration0015],
  [16, "CanonicalizeModelSelections", Migration0016],
  [17, "ProjectionThreadsArchivedAt", Migration0017],
  [18, "ProjectionThreadsArchivedAtIndex", Migration0018],
  [19, "ProjectionSnapshotLookupIndexes", Migration0019],
  [20, "AuthAccessManagement", Migration0020],
  [21, "AuthSessionClientMetadata", Migration0021],
  [22, "AuthSessionLastConnectedAt", Migration0022],
  [23, "ProjectionThreadShellSummary", Migration0023],
  [24, "BackfillProjectionThreadShellSummary", Migration0024],
  [25, "ProviderInstanceIdColumns", Migration0025],
  [26, "NormalizeCanonicalModelSelectionJson", Migration0026],
  [27, "ProjectionThreadEntries", Migration0027],
  [28, "ProjectionThreadMessageRichText", Migration0028],
  [30, "DropProjectionThreadEntryMetadata", Migration0030],
  [31, "PruneLegacyThreadActivities", Migration0031],
  [32, "DropLegacyProjectionColumns", Migration0032],
  [33, "NormalizeInteractionModeDefaults", Migration0033],
  [34, "NormalizeProviderActivityFailureKinds", Migration0034],
  [35, "DropProviderSessionSchemaResidue", Migration0035],
  [36, "NormalizeSubagentActivityPayloadThreadIds", Migration0036],
] as const;

export const makeMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

/**
 * Migrator run function - no schema dumping needed
 * Uses the base Migrator.make without platform dependencies
 */
const run = Migrator.make({});

export interface RunMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

/**
 * Run all pending migrations.
 *
 * Creates the migrations tracking table (effect_sql_migrations) if it doesn't exist,
 * then runs any migrations with ID greater than the latest recorded migration.
 *
 * Returns array of [id, name] tuples for migrations that were run.
 *
 * @returns Effect containing array of executed migrations
 */
export const runMigrations = Effect.fn("runMigrations")(function* ({
  toMigrationInclusive,
}: RunMigrationsOptions = {}) {
  yield* Effect.log(
    toMigrationInclusive === undefined
      ? "Running all migrations..."
      : `Running migrations 1 through ${toMigrationInclusive}...`,
  );
  const executedMigrations = yield* run({ loader: makeMigrationLoader(toMigrationInclusive) });
  yield* Effect.log("Migrations ran successfully").pipe(
    Effect.annotateLogs({ migrations: executedMigrations.map(([id, name]) => `${id}_${name}`) }),
  );
  return executedMigrations;
});

/**
 * Layer that runs migrations when the layer is built.
 *
 * Use this to ensure migrations run before your application starts.
 * Migrations are run automatically - no separate script is needed.
 *
 * @example
 * ```typescript
 * import { MigrationsLive } from "@acme/db/Migrations"
 * import * as SqliteClient from "@acme/db/SqliteClient"
 *
 * // Migrations run automatically when SqliteClient is provided
 * const AppLayer = MigrationsLive.pipe(
 *   Layer.provideMerge(SqliteClient.layer({ filename: "database.sqlite" }))
 * )
 * ```
 */
export const MigrationsLive = Layer.effectDiscard(runMigrations());
