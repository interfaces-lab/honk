import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { ServerConfig } from "./config.ts";
import {
  attachmentsRouteLayer,
  projectFaviconRouteLayer,
  serverEnvironmentRouteLayer,
  staticAndDevRouteLayer,
  browserApiCorsLayer,
} from "./http.ts";
import { websocketRpcRouteLayer } from "./ws.ts";
import { OpenLive } from "./open.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Sqlite.ts";
import { ServerLifecycleEventsLive } from "./server-lifecycle-events.ts";
import { AnalyticsServiceLayerLive } from "./telemetry/AnalyticsService.ts";
import { makeEventNdjsonLogger } from "./provider/EventNdjsonLogger.ts";
import { ProviderSessionDirectoryLive } from "./provider/ProviderSessionDirectory.ts";
import { ProviderSessionReaperLive } from "./provider/ProviderSessionReaper.ts";
import { ProviderSessionRuntimeRepositoryLive } from "./persistence/ProviderSessionRuntime.ts";
import { makeCodexAdapterLive } from "./provider/CodexAdapter.ts";
import { makeClaudeAdapterLive } from "./provider/ClaudeAdapter.ts";
import { makeCursorAdapterLive } from "./provider/CursorAdapter.ts";
import { makeAmpAdapterLive } from "./provider/AmpAdapter.ts";
import { makeOpenCodeAdapterLive } from "./provider/OpenCodeAdapter.ts";
import { ProviderAdapterRegistryLive } from "./provider/ProviderAdapterRegistry.ts";
import { makeProviderServiceLive } from "./provider/ProviderService.ts";
import { OpenCodeRuntimeLive } from "./provider/opencodeRuntime.ts";
import { CheckpointDiffQueryLive } from "./checkpointing/CheckpointDiffQuery.ts";
import { CheckpointStoreLive } from "./checkpointing/CheckpointStore.ts";
import { GitCoreLive } from "./git/GitCore.ts";
import { GitHubCliLive } from "./git/GitHubCli.ts";
import { GitStatusBroadcasterLive } from "./git/GitStatusBroadcaster.ts";
import { RoutingTextGenerationLive } from "./git/RoutingTextGeneration.ts";
import { TerminalManagerLive } from "./terminal/Manager.ts";
import { GitManagerLive } from "./git/GitManager.ts";
import { KeybindingsLive } from "./keybindings.ts";
import { ServerRuntimeStartupLive } from "./server-runtime-startup.ts";
import { OrchestrationReactorLive } from "./orchestration/OrchestrationReactor.ts";
import { RuntimeReceiptBusLive } from "./orchestration/RuntimeReceiptBus.ts";
import { ProviderRuntimeIngestionLive } from "./orchestration/ProviderRuntimeIngestion.ts";
import { ProviderCommandReactorLive } from "./orchestration/ProviderCommandReactor.ts";
import { CheckpointReactorLive } from "./orchestration/CheckpointReactor.ts";
import { ProviderRegistryLive } from "./provider/ProviderRegistry.ts";
import { ServerSettingsLive } from "./server-settings.ts";
import { ProjectFaviconResolverLive } from "./project/ProjectFaviconResolver.ts";
import { RepositoryIdentityResolverLive } from "./project/RepositoryIdentityResolver.ts";
import { ProjectEntriesLive } from "./project/ProjectEntries.ts";
import { ProjectFileSystemLive } from "./project/ProjectFileSystem.ts";
import { ProjectPathsLive } from "./project/ProjectPaths.ts";
import { ProjectSetupScriptRunnerLive } from "./project/ProjectSetupScriptRunner.ts";
import { ObservabilityLive } from "./observability/Observability.ts";
import { ServerEnvironmentLive } from "./environment/ServerEnvironment.ts";
import {
  authBearerBootstrapRouteLayer,
  authBootstrapRouteLayer,
  authClientsRevokeOthersRouteLayer,
  authClientsRevokeRouteLayer,
  authClientsRouteLayer,
  authPairingLinksRevokeRouteLayer,
  authPairingLinksRouteLayer,
  authPairingCredentialRouteLayer,
  authSessionRouteLayer,
  authWebSocketTokenRouteLayer,
} from "./auth/http.ts";
import { ServerSecretStoreLive } from "./auth/ServerSecretStore.ts";
import { ServerAuthLive } from "./auth/ServerAuth.ts";
import { OrchestrationLayerLive } from "./orchestration/runtime-layer.ts";
import {
  orchestrationDispatchRouteLayer,
  orchestrationSnapshotRouteLayer,
} from "./orchestration/http.ts";

export const PtyAdapterLive = Layer.unwrap(
  Effect.gen(function* () {
    if (typeof Bun !== "undefined") {
      const BunPTY = yield* Effect.promise(() => import("./terminal/BunPTY.ts"));
      return BunPTY.layer;
    }
    const NodePTY = yield* Effect.promise(() => import("./terminal/NodePTY.ts"));
    return NodePTY.layer;
  }),
);

export const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    if (typeof Bun !== "undefined") {
      const BunHttpServer = yield* Effect.promise(
        () => import("@effect/platform-bun/BunHttpServer"),
      );
      return BunHttpServer.layer({
        port: config.port,
        ...(config.host ? { hostname: config.host } : {}),
      });
    }

    const [NodeHttpServer, NodeHttp] = yield* Effect.all([
      Effect.promise(() => import("@effect/platform-node/NodeHttpServer")),
      Effect.promise(() => import("node:http")),
    ]);
    return NodeHttpServer.layer(NodeHttp.createServer, {
      host: config.host,
      port: config.port,
    });
  }),
);

const PlatformServicesLive = Layer.unwrap(
  Effect.gen(function* () {
    if (typeof Bun !== "undefined") {
      const { layer } = yield* Effect.promise(() => import("@effect/platform-bun/BunServices"));
      return layer;
    }
    const { layer } = yield* Effect.promise(() => import("@effect/platform-node/NodeServices"));
    return layer;
  }),
);

const ReactorLayerLive = Layer.empty.pipe(
  Layer.provideMerge(OrchestrationReactorLive),
  Layer.provideMerge(ProviderRuntimeIngestionLive),
  Layer.provideMerge(ProviderCommandReactorLive),
  Layer.provideMerge(CheckpointReactorLive),
  Layer.provideMerge(RuntimeReceiptBusLive),
);

const CheckpointingLayerLive = Layer.empty.pipe(
  Layer.provideMerge(CheckpointDiffQueryLive),
  Layer.provideMerge(CheckpointStoreLive),
);

const ProviderSessionDirectoryLayerLive = ProviderSessionDirectoryLive.pipe(
  Layer.provide(ProviderSessionRuntimeRepositoryLive),
);

const ProviderLayerLive = Layer.unwrap(
  Effect.gen(function* () {
    const { providerEventLogPath } = yield* ServerConfig;
    const nativeEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, {
      stream: "native",
    });
    const canonicalEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, {
      stream: "canonical",
    });
    const codexAdapterLayer = makeCodexAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const claudeAdapterLayer = makeClaudeAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const openCodeAdapterLayer = makeOpenCodeAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const ampAdapterLayer = makeAmpAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const cursorAdapterLayer = makeCursorAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const adapterRegistryLayer = ProviderAdapterRegistryLive.pipe(
      Layer.provide(codexAdapterLayer),
      Layer.provide(claudeAdapterLayer),
      Layer.provide(ampAdapterLayer),
      Layer.provide(openCodeAdapterLayer),
      Layer.provide(cursorAdapterLayer),
      Layer.provideMerge(ProviderSessionDirectoryLayerLive),
    );
    return makeProviderServiceLive(
      canonicalEventLogger ? { canonicalEventLogger } : undefined,
    ).pipe(
      Layer.provide(adapterRegistryLayer),
      Layer.provideMerge(ProviderSessionDirectoryLayerLive),
    );
  }),
);

const PersistenceLayerLive = Layer.empty.pipe(Layer.provideMerge(SqlitePersistenceLayerLive));

const GitManagerLayerLive = GitManagerLive.pipe(
  Layer.provideMerge(ProjectSetupScriptRunnerLive),
  Layer.provideMerge(GitCoreLive),
  Layer.provideMerge(GitHubCliLive),
  Layer.provideMerge(RoutingTextGenerationLive),
);

const GitLayerLive = Layer.empty.pipe(
  Layer.provideMerge(GitManagerLayerLive),
  Layer.provideMerge(GitStatusBroadcasterLive.pipe(Layer.provide(GitManagerLayerLive))),
  Layer.provideMerge(GitCoreLive),
);

const TerminalLayerLive = TerminalManagerLive.pipe(Layer.provide(PtyAdapterLive));

const ProjectLayerLive = Layer.mergeAll(
  ProjectPathsLive,
  ProjectEntriesLive.pipe(Layer.provide(ProjectPathsLive)),
  ProjectFileSystemLive.pipe(
    Layer.provide(ProjectPathsLive),
    Layer.provide(ProjectEntriesLive.pipe(Layer.provide(ProjectPathsLive))),
  ),
);

const AuthLayerLive = ServerAuthLive.pipe(
  Layer.provideMerge(PersistenceLayerLive),
  Layer.provide(ServerSecretStoreLive),
);

const ProviderRuntimeLayerLive = ProviderSessionReaperLive.pipe(
  Layer.provideMerge(ProviderLayerLive),
  Layer.provideMerge(OrchestrationLayerLive),
);

const RuntimeDependenciesLive = ReactorLayerLive.pipe(
  Layer.provideMerge(CheckpointingLayerLive),
  Layer.provideMerge(GitLayerLive),
  Layer.provideMerge(ProviderRuntimeLayerLive),
  Layer.provideMerge(TerminalLayerLive),
  Layer.provideMerge(PersistenceLayerLive),
  Layer.provideMerge(KeybindingsLive),
  Layer.provideMerge(ProviderRegistryLive),
  Layer.provideMerge(ServerSettingsLive),
  Layer.provideMerge(ProjectLayerLive),
  Layer.provideMerge(ProjectFaviconResolverLive),
  Layer.provideMerge(RepositoryIdentityResolverLive),
  Layer.provideMerge(ServerEnvironmentLive),
  Layer.provideMerge(AuthLayerLive),
  Layer.provideMerge(AnalyticsServiceLayerLive),
  Layer.provideMerge(OpenLive),
  Layer.provideMerge(OpenCodeRuntimeLive),
  Layer.provideMerge(ServerLifecycleEventsLive),
);

const RuntimeServicesLive = ServerRuntimeStartupLive.pipe(
  Layer.provideMerge(RuntimeDependenciesLive),
);

export const ServerRuntimeLayer = RuntimeServicesLive.pipe(
  Layer.provideMerge(ObservabilityLive),
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(PlatformServicesLive),
);

export const makeRoutesLayer = Layer.mergeAll(
  authBearerBootstrapRouteLayer,
  authBootstrapRouteLayer,
  authClientsRevokeOthersRouteLayer,
  authClientsRevokeRouteLayer,
  authClientsRouteLayer,
  authPairingLinksRevokeRouteLayer,
  authPairingLinksRouteLayer,
  authPairingCredentialRouteLayer,
  authSessionRouteLayer,
  authWebSocketTokenRouteLayer,
  attachmentsRouteLayer,
  orchestrationDispatchRouteLayer,
  orchestrationSnapshotRouteLayer,
  projectFaviconRouteLayer,
  serverEnvironmentRouteLayer,
  staticAndDevRouteLayer,
  websocketRpcRouteLayer,
).pipe(Layer.provide(browserApiCorsLayer));

/**
 * Stable server runtime wrapper for non-server entrypoints and integration
 * utilities that need to run Effect services behind an explicit boundary.
 */
export class ServerRuntime<R, ER> {
  private constructor(private readonly runtime: ManagedRuntime.ManagedRuntime<R, ER>) {}

  static make<R, ER>(layer: Layer.Layer<R, ER, never>): ServerRuntime<R, ER> {
    return new ServerRuntime(ManagedRuntime.make(layer));
  }

  runPromise<A, E>(effect: Effect.Effect<A, E, R>, options?: Effect.RunOptions): Promise<A> {
    return this.runtime.runPromise(effect, options);
  }

  runPromiseExit<A, E>(
    effect: Effect.Effect<A, E, R>,
    options?: Effect.RunOptions,
  ): Promise<Exit.Exit<A, ER | E>> {
    return this.runtime.runPromiseExit(effect, options);
  }

  dispose(): Promise<void> {
    return this.runtime.dispose();
  }

  get disposeEffect(): Effect.Effect<void> {
    return this.runtime.disposeEffect;
  }
}
