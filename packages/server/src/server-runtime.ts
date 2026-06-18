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
import { GitCoreLive } from "./git/GitCore.ts";
import { GitHubCliLive } from "./git/GitHubCli.ts";
import { GitStatusBroadcasterLive } from "./git/GitStatusBroadcaster.ts";
import { RoutingTextGenerationLive } from "./git/RoutingTextGeneration.ts";
import { TerminalManagerLive } from "./terminal/Manager.ts";
import { GitManagerLive } from "./git/GitManager.ts";
import { KeybindingsLive } from "./keybindings.ts";
import { ServerRuntimeStartupLive } from "./server-runtime-startup.ts";
import { OrchestrationReactorLive } from "./orchestration/OrchestrationReactor.ts";
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
  authBootstrapRouteLayer,
  authClientsRevokeOthersRouteLayer,
  authClientsRevokeRouteLayer,
  authClientsRouteLayer,
  authPairingLinksRevokeRouteLayer,
  authPairingLinksRouteLayer,
  authPairingCredentialRouteLayer,
  authSessionRouteLayer,
} from "./auth/http.ts";
import { ServerSecretStoreLive } from "./auth/ServerSecretStore.ts";
import { ServerAuthLive } from "./auth/ServerAuth.ts";
import { OrchestrationLayerLive } from "./orchestration/runtime-layer.ts";
import {
  orchestrationDispatchRouteLayer,
  orchestrationSnapshotRouteLayer,
} from "./orchestration/http.ts";
import { runtimeIngestionRouteLayer } from "./runtime/runtime-ingestion-http.ts";

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

const ReactorLayerLive = Layer.empty.pipe(Layer.provideMerge(OrchestrationReactorLive));

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

const RuntimeIngestionRouteLayerLive = runtimeIngestionRouteLayer.pipe(
  Layer.provide(GitManagerLayerLive),
);

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

const RuntimeDependenciesLive = ReactorLayerLive.pipe(
  Layer.provideMerge(GitLayerLive),
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provideMerge(TerminalLayerLive),
  Layer.provideMerge(PersistenceLayerLive),
  Layer.provideMerge(KeybindingsLive),
  Layer.provideMerge(ServerSettingsLive),
  Layer.provideMerge(ProjectLayerLive),
  Layer.provideMerge(ProjectFaviconResolverLive),
  Layer.provideMerge(RepositoryIdentityResolverLive),
  Layer.provideMerge(ServerEnvironmentLive),
  Layer.provideMerge(AuthLayerLive),
  Layer.provideMerge(AnalyticsServiceLayerLive),
  Layer.provideMerge(OpenLive),
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
  authBootstrapRouteLayer,
  authClientsRevokeOthersRouteLayer,
  authClientsRevokeRouteLayer,
  authClientsRouteLayer,
  authPairingLinksRevokeRouteLayer,
  authPairingLinksRouteLayer,
  authPairingCredentialRouteLayer,
  authSessionRouteLayer,
  attachmentsRouteLayer,
  orchestrationDispatchRouteLayer,
  orchestrationSnapshotRouteLayer,
  RuntimeIngestionRouteLayerLive,
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
