import {
  ClientOrchestrationCommand as ClientOrchestrationCommandSchema,
  type AgentRuntimeEvent,
  type MultiRuntimeHostEvent,
  type MultiRuntimeHostSnapshot,
  type SessionTreeProjection,
} from "@multi/contracts";
import {
  runtimeAssistantEntryIngestionKey,
  runtimeEventIngestionKey,
  runtimeSessionTreeAssistantCompleteCommand,
  runtimeToolCompletedActivityCommands,
} from "@multi/runtime";
import { formatSchemaError, formatSchemaIssues } from "@multi/shared/schema-json";
import * as EffectLogger from "@multi/shared/effect-logger";
import { Exit, Schema } from "effect";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as DesktopBackendManager from "../backend/desktop-backend-manager";
import {
  createDesktopOrchestrationClient,
  type DesktopOrchestrationClient,
  type DesktopOrchestrationClientConfig,
} from "./desktop-orchestration-client";

const decodeRuntimePersistenceCommand = Schema.decodeUnknownExit(ClientOrchestrationCommandSchema);
const elog = EffectLogger.create({ service: "desktop.runtime.ingestion" });
let installedClientConfig: DesktopOrchestrationClientConfig | null = null;

class RuntimeIngestionState {
  private readonly persistedRuntimeEventKeys = new Set<string>();
  private readonly persistedRuntimeAssistantEntryKeys = new Set<string>();
  private client: DesktopOrchestrationClient | null = null;
  private configurePromise: Promise<void> | null = null;
  private configuredClientConfig: DesktopOrchestrationClientConfig | null = null;

  configureForTests(config: DesktopOrchestrationClientConfig): void {
    this.configuredClientConfig = config;
    this.client = null;
    this.configurePromise = null;
  }

  async ensureConfigured(): Promise<DesktopOrchestrationClient> {
    if (this.client && !this.configurePromise) {
      return this.client;
    }
    if (this.configurePromise) {
      await this.configurePromise;
      if (!this.client) {
        throw new Error("Desktop runtime ingestion client failed to configure.");
      }
      return this.client;
    }

    this.configurePromise = this.configureClient();
    try {
      await this.configurePromise;
    } finally {
      this.configurePromise = null;
    }
    if (!this.client) {
      throw new Error("Desktop runtime ingestion client failed to configure.");
    }
    return this.client;
  }

  private async configureClient(): Promise<void> {
    const configuredClientConfig = this.configuredClientConfig;
    if (configuredClientConfig) {
      const client = createDesktopOrchestrationClient();
      await client.configure(configuredClientConfig);
      this.client = client;
      return;
    }

    if (!installedClientConfig) {
      throw new Error("Desktop backend is not configured for runtime ingestion.");
    }

    const client = createDesktopOrchestrationClient();
    await client.configure(installedClientConfig);
    this.client = client;
  }

  resetClient(): void {
    this.client?.reset();
    this.client = null;
    this.configurePromise = null;
    this.configuredClientConfig = null;
  }

  ingestHostEvent(event: MultiRuntimeHostEvent): void {
    switch (event.type) {
      case "snapshot":
        this.ingestSnapshot(event.snapshot);
        return;
      case "runtime-event":
        this.ingestRuntimeEvent(event.event);
        return;
      case "session-tree":
        this.ingestSessionTree(event.tree);
        return;
      default:
        return;
    }
  }

  ingestSnapshot(snapshot: MultiRuntimeHostSnapshot): void {
    for (const tree of snapshot.sessionTrees) {
      this.ingestSessionTree(tree);
    }
    for (const runtimeEvent of snapshot.runtimeEvents) {
      this.ingestRuntimeEvent(runtimeEvent);
    }
  }

  ingestSessionTree(tree: SessionTreeProjection): void {
    const entryById = new Map(tree.entries.map((entry) => [entry.id, entry] as const));
    for (const entry of tree.entries) {
      const command = runtimeSessionTreeAssistantCompleteCommand({
        tree,
        entry,
        entryById,
      });
      if (!command) {
        continue;
      }
      const entryKey = runtimeAssistantEntryIngestionKey(tree, entry);
      if (this.persistedRuntimeAssistantEntryKeys.has(entryKey)) {
        continue;
      }
      void this.dispatchCommand({
        command,
        persistenceKey: entryKey,
        persistedKeys: this.persistedRuntimeAssistantEntryKeys,
      });
    }
  }

  ingestRuntimeEvent(event: AgentRuntimeEvent): void {
    const eventKey = runtimeEventIngestionKey(event);
    if (this.persistedRuntimeEventKeys.has(eventKey)) {
      return;
    }
    const commands = runtimeToolCompletedActivityCommands(event);
    if (commands.length === 0) {
      return;
    }
    this.persistedRuntimeEventKeys.add(eventKey);
    for (const command of commands) {
      void this.dispatchCommand({
        command,
        persistenceKey: eventKey,
        persistedKeys: this.persistedRuntimeEventKeys,
      });
    }
  }

  private dispatchCommand(input: {
    readonly command: Parameters<DesktopOrchestrationClient["dispatchCommand"]>[0];
    readonly persistenceKey: string;
    readonly persistedKeys: Set<string>;
  }): void {
    const decoded = decodeRuntimePersistenceCommand(input.command, {
      errors: "all",
      propertyOrder: "original",
    });
    if (Exit.isFailure(decoded)) {
      input.persistedKeys.delete(input.persistenceKey);
      void Effect.runPromise(
        elog.error("Runtime orchestration persistence command failed schema validation", {
          issue: formatSchemaError(decoded.cause),
          issues: formatSchemaIssues(decoded.cause),
          commandType: input.command.type,
          commandId: input.command.commandId,
        }),
      );
      return;
    }

    input.persistedKeys.add(input.persistenceKey);
    void this.ensureConfigured()
      .then((client) => client.dispatchCommand(decoded.value))
      .catch((error: unknown) => {
        input.persistedKeys.delete(input.persistenceKey);
        void Effect.runPromise(
          elog.error("Runtime orchestration persistence failed", {
            commandType: input.command.type,
            commandId: input.command.commandId,
            cause: error instanceof Error ? error.message : String(error),
          }),
        );
      });
  }
}

let ingestionState: RuntimeIngestionState | null = null;

function getIngestionState(): RuntimeIngestionState {
  if (!ingestionState) {
    ingestionState = new RuntimeIngestionState();
  }
  return ingestionState;
}

export function ingestRuntimeHostEvent(event: MultiRuntimeHostEvent): void {
  getIngestionState().ingestHostEvent(event);
}

export const installRuntimeIngestion = Effect.acquireRelease(
  Effect.gen(function* () {
    const backendManager = yield* DesktopBackendManager.DesktopBackendManager;
    const config = yield* backendManager.currentConfig;
    if (Option.isNone(config)) {
      return yield* Effect.die(
        new Error("Desktop backend must be configured before runtime ingestion is installed."),
      );
    }
    installedClientConfig = {
      httpBaseUrl: config.value.httpBaseUrl,
      bootstrapToken: config.value.bootstrap.desktopBootstrapToken,
    };
    getIngestionState().resetClient();
    return () => {
      installedClientConfig = null;
      getIngestionState().resetClient();
    };
  }),
  (cleanup) => Effect.sync(cleanup),
);

export function __resetRuntimeIngestionForTests(): void {
  ingestionState?.resetClient();
  ingestionState = null;
}

export function __configureRuntimeIngestionForTests(
  config: DesktopOrchestrationClientConfig,
): void {
  getIngestionState().configureForTests(config);
}
