import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as NodeServices from "@effect/platform-node/NodeServices";

import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  EventId,
  GitCommandError,
  KeybindingRule,
  MessageId,
  OpenError,
  TerminalNotRunningError,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ResolvedKeybindingRule,
  ThreadId,
  WS_METHODS,
  WsRpcGroup,
  EditorId,
} from "@multi/contracts";
import { assert, it } from "@effect/vitest";
import { assertFailure, assertInclude, assertTrue } from "@effect/vitest/utils";
import {
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Stream,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpRouter,
  HttpServer,
} from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";
import { vi } from "vitest";

import { ServerConfigShape } from "../../src/config.ts";
import { deriveServerPaths, ServerConfig } from "../../src/config.ts";
import { makeRoutesLayer } from "../../src/server-runtime.ts";
import { resolveAttachmentRelativePath } from "../../src/attachment-paths.ts";
import {
  CheckpointDiffQuery,
  type CheckpointDiffQueryShape,
} from "../../src/checkpointing/CheckpointDiffQuery.service.ts";
import { GitCore, type GitCoreShape } from "../../src/git/GitCore.service.ts";
import { GitManager, type GitManagerShape } from "../../src/git/GitManager.service.ts";
import { GitStatusBroadcasterLive } from "../../src/git/GitStatusBroadcaster.ts";
import {
  GitStatusBroadcaster,
  type GitStatusBroadcasterShape,
} from "../../src/git/GitStatusBroadcaster.service.ts";
import { Keybindings, type KeybindingsShape } from "../../src/keybindings.ts";
import { Open, type OpenShape } from "../../src/open.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../src/orchestration/OrchestrationEngine.service.ts";
import { OrchestrationListenerCallbackError } from "../../src/orchestration/Errors.ts";
import {
  ThreadProjection,
  type ThreadProjectionShape,
} from "../../src/orchestration/ThreadProjection.service.ts";
import { SqlitePersistenceMemory } from "../../src/persistence/Sqlite.ts";
import {
  ProviderRegistry,
  type ProviderRegistryShape,
} from "../../src/provider/ProviderRegistry.service.ts";
import {
  ServerLifecycleEvents,
  type ServerLifecycleEventsShape,
} from "../../src/server-lifecycle-events.ts";
import {
  ServerRuntimeStartup,
  type ServerRuntimeStartupShape,
} from "../../src/server-runtime-startup.ts";
import { ServerSettingsService, type ServerSettingsShape } from "../../src/server-settings.ts";
import { TerminalManager, type TerminalManagerShape } from "../../src/terminal/Manager.service.ts";
import { ProjectFaviconResolverLive } from "../../src/project/ProjectFaviconResolver.ts";
import {
  ProjectSetupScriptRunner,
  type ProjectSetupScriptRunnerShape,
} from "../../src/project/ProjectSetupScriptRunner.service.ts";
import {
  RepositoryIdentityResolver,
  type RepositoryIdentityResolverShape,
} from "../../src/project/RepositoryIdentityResolver.service.ts";
import {
  ServerEnvironment,
  type ServerEnvironmentShape,
} from "../../src/environment/ServerEnvironment.service.ts";
import { ProjectEntriesLive } from "../../src/project/ProjectEntries.ts";
import { ProjectFileSystemLive } from "../../src/project/ProjectFileSystem.ts";
import { ProjectPathsLive } from "../../src/project/ProjectPaths.ts";
import { ServerSecretStoreLive } from "../../src/auth/ServerSecretStore.ts";
import { ServerAuthLive } from "../../src/auth/ServerAuth.ts";

const defaultProjectId = ProjectId.make("project-default");
const defaultThreadId = ThreadId.make("thread-default");
const defaultDesktopBootstrapToken = "test-desktop-bootstrap-token";
const defaultModelSelection = {
  instanceId: "codex",
  model: "gpt-5-codex",
} as const;
const testEnvironmentDescriptor = {
  environmentId: EnvironmentId.make("environment-test"),
  label: "Test environment",
  platform: {
    os: "darwin",
    arch: "arm64",
  },
  serverVersion: "0.0.0-test",
  capabilities: {
    repositoryIdentity: true,
  },
} as const;
const makeDefaultOrchestrationReadModel = (): OrchestrationReadModel => {
  const now = new Date().toISOString();
  return {
    snapshotSequence: 0,
    updatedAt: now,
    projects: [
      {
        id: defaultProjectId,
        title: "Default Project",
        projectRoot: "/tmp/default-project",
        defaultModelSelection,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: defaultThreadId,
        projectId: defaultProjectId,
        title: "Default Thread",
        modelSelection: defaultModelSelection,
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        latestTurn: null,
        messages: [],
        session: null,
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        deletedAt: null,
      },
    ],
  } as const satisfies OrchestrationReadModel;
};

const projectAndProjectServicesLayer = Layer.mergeAll(
  ProjectPathsLive,
  ProjectEntriesLive.pipe(Layer.provide(ProjectPathsLive)),
  ProjectFileSystemLive.pipe(
    Layer.provide(ProjectPathsLive),
    Layer.provide(ProjectEntriesLive.pipe(Layer.provide(ProjectPathsLive))),
  ),
  ProjectFaviconResolverLive,
);

const authTestLayer = ServerAuthLive.pipe(
  Layer.provide(SqlitePersistenceMemory),
  Layer.provide(ServerSecretStoreLive),
);

const buildAppUnderTest = (options?: {
  config?: Partial<ServerConfigShape>;
  layers?: {
    keybindings?: Partial<KeybindingsShape>;
    providerRegistry?: Partial<ProviderRegistryShape>;
    serverSettings?: Partial<ServerSettingsShape>;
    open?: Partial<OpenShape>;
    gitCore?: Partial<GitCoreShape>;
    gitManager?: Partial<GitManagerShape>;
    gitStatusBroadcaster?: Partial<GitStatusBroadcasterShape>;
    projectSetupScriptRunner?: Partial<ProjectSetupScriptRunnerShape>;
    terminalManager?: Partial<TerminalManagerShape>;
    orchestrationEngine?: Partial<OrchestrationEngineShape>;
    threadProjection?: Partial<ThreadProjectionShape>;
    checkpointDiffQuery?: Partial<CheckpointDiffQueryShape>;
    serverLifecycleEvents?: Partial<ServerLifecycleEventsShape>;
    serverRuntimeStartup?: Partial<ServerRuntimeStartupShape>;
    serverEnvironment?: Partial<ServerEnvironmentShape>;
    repositoryIdentityResolver?: Partial<RepositoryIdentityResolverShape>;
  };
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const tempBaseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-router-test-" });
    const baseDir = options?.config?.baseDir ?? tempBaseDir;
    const devUrl = options?.config?.devUrl;
    const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
    const config: ServerConfigShape = {
      logLevel: "Info",
      traceMinLevel: "Info",
      traceTimingEnabled: true,
      traceBatchWindowMs: 200,
      traceMaxBytes: 10 * 1024 * 1024,
      traceMaxFiles: 10,
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpExportIntervalMs: 10_000,
      otlpServiceName: "multi-server",
      mode: "desktop",
      port: 0,
      host: "127.0.0.1",
      cwd: process.cwd(),
      baseDir,
      ...derivedPaths,
      staticDir: undefined,
      devUrl,
      noBrowser: true,
      startupPresentation: "browser",
      desktopBootstrapToken: defaultDesktopBootstrapToken,
      autoBootstrapProjectFromCwd: false,
      logWebSocketEvents: false,
      ...options?.config,
    };
    const layerConfig = Layer.succeed(ServerConfig, config);
    const gitManagerLayer = Layer.mock(GitManager)({
      ...options?.layers?.gitManager,
    });
    const gitStatusBroadcasterLayer = options?.layers?.gitStatusBroadcaster
      ? Layer.mock(GitStatusBroadcaster)({
          ...options.layers.gitStatusBroadcaster,
        })
      : GitStatusBroadcasterLive.pipe(Layer.provide(gitManagerLayer));

    const servedRoutesLayer = HttpRouter.serve(makeRoutesLayer, {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(
      Layer.provide(
        Layer.mock(Keybindings)({
          loadConfigState: Effect.succeed({
            keybindings: [],
            issues: [],
          }),
          streamChanges: Stream.empty,
          ...options?.layers?.keybindings,
        }),
      ),
      Layer.provide(
        Layer.mock(ProviderRegistry)({
          getProviders: Effect.succeed([]),
          refresh: () => Effect.succeed([]),
          streamChanges: Stream.empty,
          ...options?.layers?.providerRegistry,
        }),
      ),
      Layer.provide(
        Layer.mock(ServerSettingsService)({
          start: Effect.void,
          ready: Effect.void,
          getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
          updateSettings: () => Effect.succeed(DEFAULT_SERVER_SETTINGS),
          streamChanges: Stream.empty,
          ...options?.layers?.serverSettings,
        }),
      ),
      Layer.provide(
        Layer.mock(Open)({
          ...options?.layers?.open,
        }),
      ),
      Layer.provide(
        Layer.mock(GitCore)({
          ...options?.layers?.gitCore,
        }),
      ),
      Layer.provide(gitManagerLayer),
      Layer.provideMerge(gitStatusBroadcasterLayer),
      Layer.provide(
        Layer.mock(ProjectSetupScriptRunner)({
          runForThread: () => Effect.succeed({ status: "no-script" as const }),
          ...options?.layers?.projectSetupScriptRunner,
        }),
      ),
      Layer.provide(
        Layer.mock(TerminalManager)({
          ...options?.layers?.terminalManager,
        }),
      ),
      Layer.provide(
        Layer.mock(OrchestrationEngineService)({
          getReadModel: () => Effect.succeed(makeDefaultOrchestrationReadModel()),
          readEvents: () => Stream.empty,
          dispatch: () => Effect.succeed({ sequence: 0 }),
          streamDomainEvents: Stream.empty,
          ...options?.layers?.orchestrationEngine,
        }),
      ),
      Layer.provide(
        Layer.mock(ThreadProjection)({
          getSnapshot: () => Effect.succeed(makeDefaultOrchestrationReadModel()),
          getShellSnapshot: () =>
            Effect.succeed({
              snapshotSequence: 0,
              projects: [],
              threads: [],
              updatedAt: new Date(0).toISOString(),
            }),
          getProjectShellById: () => Effect.succeed(Option.none()),
          getThreadShellById: () => Effect.succeed(Option.none()),
          getThreadDetailById: () => Effect.succeed(Option.none()),
          getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
          getActiveProjectByProjectRoot: () => Effect.succeed(Option.none()),
          getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
          getThreadCheckpointContext: () => Effect.succeed(Option.none()),
          ...options?.layers?.threadProjection,
        }),
      ),
      Layer.provide(
        Layer.mock(CheckpointDiffQuery)({
          getTurnDiff: () =>
            Effect.succeed({
              threadId: defaultThreadId,
              fromTurnCount: 0,
              toTurnCount: 0,
              diff: "",
            }),
          getFullThreadDiff: () =>
            Effect.succeed({
              threadId: defaultThreadId,
              fromTurnCount: 0,
              toTurnCount: 0,
              diff: "",
            }),
          ...options?.layers?.checkpointDiffQuery,
        }),
      ),
    );

    const appLayer = servedRoutesLayer.pipe(
      Layer.provide(
        Layer.mock(ServerLifecycleEvents)({
          publish: (event) => Effect.succeed({ ...(event as any), sequence: 1 }),
          snapshot: Effect.succeed({ sequence: 0, events: [] }),
          stream: Stream.empty,
          ...options?.layers?.serverLifecycleEvents,
        }),
      ),
      Layer.provide(
        Layer.mock(ServerRuntimeStartup)({
          awaitCommandReady: Effect.void,
          markHttpListening: Effect.void,
          enqueueCommand: (effect) => effect,
          ...options?.layers?.serverRuntimeStartup,
        }),
      ),
      Layer.provide(
        Layer.mock(ServerEnvironment)({
          getEnvironmentId: Effect.succeed(testEnvironmentDescriptor.environmentId),
          getDescriptor: Effect.succeed(testEnvironmentDescriptor),
          ...options?.layers?.serverEnvironment,
        }),
      ),
      Layer.provide(
        Layer.mock(RepositoryIdentityResolver)({
          resolve: () => Effect.succeed(null),
          ...options?.layers?.repositoryIdentityResolver,
        }),
      ),
      Layer.provideMerge(authTestLayer),
      Layer.provide(projectAndProjectServicesLayer),
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provide(layerConfig),
    );

    yield* Layer.build(appLayer);
    return config;
  });

const parseSessionCookieFromWsUrl = (
  wsUrl: string,
): { readonly cookie: string | null; readonly url: string } => {
  const next = new URL(wsUrl);
  const cookie = next.hash.startsWith("#cookie=")
    ? decodeURIComponent(next.hash.slice("#cookie=".length))
    : null;
  next.hash = "";
  return {
    cookie,
    url: next.toString(),
  };
};

const wsRpcProtocolLayer = (wsUrl: string) => {
  const { cookie, url } = parseSessionCookieFromWsUrl(wsUrl);
  const webSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl, protocols) =>
      new NodeSocket.NodeWS.WebSocket(
        socketUrl,
        protocols,
        cookie ? { headers: { cookie } } : undefined,
      ) as unknown as globalThis.WebSocket,
  );

  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(url).pipe(Layer.provide(webSocketConstructorLayer))),
    Layer.provide(RpcSerialization.layerJson),
  );
};

const makeWsRpcClient = RpcClient.make(WsRpcGroup);
type WsRpcClient =
  typeof makeWsRpcClient extends Effect.Effect<infer Client, any, any> ? Client : never;

const withWsRpcClient = <A, E, R>(
  wsUrl: string,
  f: (client: WsRpcClient) => Effect.Effect<A, E, R>,
) => makeWsRpcClient.pipe(Effect.flatMap(f), Effect.provide(wsRpcProtocolLayer(wsUrl)));

const appendSessionCookieToWsUrl = (url: string, sessionCookieHeader: string) => {
  const isAbsoluteUrl = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url);
  const next = new URL(url, "http://localhost");
  next.hash = `cookie=${encodeURIComponent(sessionCookieHeader)}`;
  return isAbsoluteUrl ? next.toString() : `${next.pathname}${next.search}${next.hash}`;
};

const getHttpServerUrl = (pathname = "") =>
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer;
    const address = server.address as HttpServer.TcpAddress;
    return `http://127.0.0.1:${address.port}${pathname}`;
  });

const bootstrapBrowserSession = (
  credential = defaultDesktopBootstrapToken,
  options?: {
    readonly headers?: Record<string, string>;
  },
) =>
  Effect.gen(function* () {
    const bootstrapUrl = yield* getHttpServerUrl("/api/auth/bootstrap");
    const response = yield* Effect.promise(() =>
      fetch(bootstrapUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...options?.headers,
        },
        body: JSON.stringify({
          credential,
        }),
      }),
    );
    const body = (yield* Effect.promise(() => response.json())) as {
      readonly authenticated: boolean;
      readonly sessionMethod: string;
      readonly expiresAt: string;
    };
    return {
      response,
      body,
      cookie: response.headers.get("set-cookie"),
    };
  });

const bootstrapBearerSession = (credential = defaultDesktopBootstrapToken) =>
  Effect.gen(function* () {
    const bootstrapUrl = yield* getHttpServerUrl("/api/auth/bootstrap/bearer");
    const response = yield* Effect.promise(() =>
      fetch(bootstrapUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          credential,
        }),
      }),
    );
    const body = (yield* Effect.promise(() => response.json())) as {
      readonly authenticated: boolean;
      readonly sessionMethod: string;
      readonly expiresAt: string;
      readonly sessionToken?: string;
      readonly error?: string;
    };
    return {
      response,
      body,
    };
  });

const getAuthenticatedSessionCookieHeader = (credential = defaultDesktopBootstrapToken) =>
  Effect.gen(function* () {
    const { response, cookie } = yield* bootstrapBrowserSession(credential);
    if (!response.ok) {
      return yield* Effect.fail(
        new Error(`Expected bootstrap session response to succeed, got ${response.status}`),
      );
    }

    if (!cookie) {
      return yield* Effect.fail(new Error("Expected bootstrap session response to set a cookie."));
    }

    return cookie.split(";")[0] ?? cookie;
  });

const getAuthenticatedBearerSessionToken = (credential = defaultDesktopBootstrapToken) =>
  Effect.gen(function* () {
    const { response, body } = yield* bootstrapBearerSession(credential);
    if (!response.ok) {
      return yield* Effect.fail(
        new Error(`Expected bearer bootstrap response to succeed, got ${response.status}`),
      );
    }

    if (!body.sessionToken) {
      return yield* Effect.fail(
        new Error("Expected bearer bootstrap response to include a session token."),
      );
    }

    return body.sessionToken;
  });

const extractSessionTokenFromSetCookie = (cookieHeader: string): string => {
  const [nameValue] = cookieHeader.split(";", 1);
  const token = nameValue?.split("=", 2)[1];
  if (!token) {
    throw new Error("Expected session cookie header to contain a token value.");
  }
  return token;
};

const splitHeaderTokens = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .toSorted();

const getWsServerUrl = (
  pathname = "",
  options?: { authenticated?: boolean; credential?: string },
) =>
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer;
    const address = server.address as HttpServer.TcpAddress;
    const baseUrl = `ws://127.0.0.1:${address.port}${pathname}`;
    if (options?.authenticated === false) {
      return baseUrl;
    }
    return appendSessionCookieToWsUrl(
      baseUrl,
      yield* getAuthenticatedSessionCookieHeader(options?.credential),
    );
  });

it.layer(NodeServices.layer)("server router seam", (it) => {
  it.effect("serves static index content for GET / when staticDir is configured", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-router-static-" });
      const indexPath = path.join(staticDir, "index.html");
      yield* fileSystem.writeFileString(indexPath, "<html>router-static-ok</html>");

      yield* buildAppUnderTest({ config: { staticDir } });

      const response = yield* HttpClient.get("/");
      assert.equal(response.status, 200);
      assert.include(yield* response.text, "router-static-ok");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("redirects to dev URL when configured", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: { devUrl: new URL("http://127.0.0.1:5173") },
      });

      const url = yield* getHttpServerUrl("/foo/bar?token=test-token");
      const response = yield* Effect.promise(() => fetch(url, { redirect: "manual" }));

      assert.equal(response.status, 302);
      assert.equal(
        response.headers.get("location"),
        "http://127.0.0.1:5173/foo/bar?token=test-token",
      );
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("serves project favicon requests before the dev URL redirect", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-router-project-favicon-",
      });
      yield* fileSystem.writeFileString(
        path.join(projectDir, "favicon.svg"),
        "<svg>router-project-favicon</svg>",
      );

      yield* buildAppUnderTest({
        config: { devUrl: new URL("http://127.0.0.1:5173") },
      });

      const response = yield* HttpClient.get(
        `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`,
        {
          headers: {
            cookie: yield* getAuthenticatedSessionCookieHeader(),
          },
        },
      );

      assert.equal(response.status, 200);
      assert.equal(yield* response.text, "<svg>router-project-favicon</svg>");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("serves the fallback project favicon when no icon exists", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const projectDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-router-project-favicon-fallback-",
      });

      yield* buildAppUnderTest({
        config: { devUrl: new URL("http://127.0.0.1:5173") },
      });

      const response = yield* HttpClient.get(
        `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`,
        {
          headers: {
            cookie: yield* getAuthenticatedSessionCookieHeader(),
          },
        },
      );

      assert.equal(response.status, 200);
      assert.include(yield* response.text, 'data-fallback="project-favicon"');
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("serves the public environment descriptor without requiring auth", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const url = yield* getHttpServerUrl("/.well-known/multi/environment");
      const response = yield* Effect.promise(() => fetch(url));
      const body = (yield* Effect.promise(() =>
        response.json(),
      )) as typeof testEnvironmentDescriptor;

      assert.equal(response.status, 200);
      assert.deepEqual(body, testEnvironmentDescriptor);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("reports unauthenticated session state without requiring auth", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const url = yield* getHttpServerUrl("/api/auth/session");
      const response = yield* Effect.promise(() => fetch(url));
      const body = (yield* Effect.promise(() => response.json())) as {
        readonly authenticated: boolean;
        readonly auth: {
          readonly policy: string;
          readonly bootstrapMethods: ReadonlyArray<string>;
          readonly sessionMethods: ReadonlyArray<string>;
          readonly sessionCookieName: string;
        };
      };

      assert.equal(response.status, 200);
      assert.equal(body.authenticated, false);
      assert.equal(body.auth.policy, "desktop-managed-local");
      assert.deepEqual(body.auth.bootstrapMethods, ["desktop-bootstrap"]);
      assert.deepEqual(body.auth.sessionMethods, [
        "browser-session-cookie",
        "bearer-session-token",
      ]);
      assert.isTrue(body.auth.sessionCookieName.startsWith("t3_session_"));
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("bootstraps a browser session and authenticates the session endpoint via cookie", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const {
        response: bootstrapResponse,
        body: bootstrapBody,
        cookie: setCookie,
      } = yield* bootstrapBrowserSession();

      assert.equal(bootstrapResponse.status, 200);
      assert.equal(bootstrapBody.authenticated, true);
      assert.equal(bootstrapBody.sessionMethod, "browser-session-cookie");
      assert.isUndefined((bootstrapBody as { readonly sessionToken?: string }).sessionToken);
      assert.isDefined(setCookie);

      const sessionUrl = yield* getHttpServerUrl("/api/auth/session");
      const sessionResponse = yield* Effect.promise(() =>
        fetch(sessionUrl, {
          headers: {
            cookie: setCookie?.split(";")[0] ?? "",
          },
        }),
      );
      const sessionBody = (yield* Effect.promise(() => sessionResponse.json())) as {
        readonly authenticated: boolean;
        readonly sessionMethod?: string;
      };

      assert.equal(sessionResponse.status, 200);
      assert.equal(sessionBody.authenticated, true);
      assert.equal(sessionBody.sessionMethod, "browser-session-cookie");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect(
    "bootstraps a bearer session and authenticates the session endpoint via authorization header",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest();

        const { response: bootstrapResponse, body: bootstrapBody } =
          yield* bootstrapBearerSession();

        assert.equal(bootstrapResponse.status, 200);
        assert.equal(bootstrapBody.authenticated, true);
        assert.equal(bootstrapBody.sessionMethod, "bearer-session-token");
        assert.equal(typeof bootstrapBody.sessionToken, "string");
        assert.isTrue((bootstrapBody.sessionToken?.length ?? 0) > 0);

        const sessionUrl = yield* getHttpServerUrl("/api/auth/session");
        const sessionResponse = yield* Effect.promise(() =>
          fetch(sessionUrl, {
            headers: {
              authorization: `Bearer ${bootstrapBody.sessionToken ?? ""}`,
            },
          }),
        );
        const sessionBody = (yield* Effect.promise(() => sessionResponse.json())) as {
          readonly authenticated: boolean;
          readonly sessionMethod?: string;
        };

        assert.equal(sessionResponse.status, 200);
        assert.equal(sessionBody.authenticated, true);
        assert.equal(sessionBody.sessionMethod, "bearer-session-token");
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("issues short-lived websocket tokens for authenticated bearer sessions", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const bearerToken = yield* getAuthenticatedBearerSessionToken();
      const wsTokenUrl = yield* getHttpServerUrl("/api/auth/ws-token");
      const wsTokenResponse = yield* Effect.promise(() =>
        fetch(wsTokenUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${bearerToken}`,
          },
        }),
      );
      const wsTokenBody = (yield* Effect.promise(() => wsTokenResponse.json())) as {
        readonly token: string;
        readonly expiresAt: string;
      };

      assert.equal(wsTokenResponse.status, 200);
      assert.equal(typeof wsTokenBody.token, "string");
      assert.isTrue(wsTokenBody.token.length > 0);
      assert.equal(typeof wsTokenBody.expiresAt, "string");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect(
    "responds to remote auth websocket-token preflight requests with authorization CORS headers",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest();

        const wsTokenUrl = yield* getHttpServerUrl("/api/auth/ws-token");
        const response = yield* Effect.promise(() =>
          fetch(wsTokenUrl, {
            method: "OPTIONS",
            headers: {
              origin: "http://192.168.86.35:3773",
              "access-control-request-method": "POST",
              "access-control-request-headers": "authorization",
            },
          }),
        );

        assert.equal(response.status, 204);
        assert.equal(response.headers.get("access-control-allow-origin"), "*");
        assert.deepEqual(splitHeaderTokens(response.headers.get("access-control-allow-methods")), [
          "GET",
          "OPTIONS",
          "POST",
        ]);
        assert.deepEqual(splitHeaderTokens(response.headers.get("access-control-allow-headers")), [
          "authorization",
          "content-type",
        ]);
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("includes CORS headers on remote websocket-token auth failures", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const wsTokenUrl = yield* getHttpServerUrl("/api/auth/ws-token");
      const response = yield* Effect.promise(() =>
        fetch(wsTokenUrl, {
          method: "POST",
          headers: {
            origin: "http://192.168.86.35:3773",
          },
        }),
      );
      const body = (yield* Effect.promise(() => response.json())) as {
        readonly error?: string;
      };

      assert.equal(response.status, 401);
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(body.error, "Authentication required.");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("issues authenticated one-time pairing credentials for additional clients", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const response = yield* HttpClient.post("/api/auth/pairing-token", {
        headers: {
          cookie: yield* getAuthenticatedSessionCookieHeader(),
        },
      });
      const body = (yield* response.json) as {
        readonly credential: string;
        readonly expiresAt: string;
      };

      assert.equal(response.status, 200);
      assert.equal(typeof body.credential, "string");
      assert.isTrue(body.credential.length > 0);
      assert.equal(typeof body.expiresAt, "string");

      const bootstrapResult = yield* bootstrapBrowserSession(body.credential);
      assert.equal(bootstrapResult.response.status, 200);

      const reusedResult = yield* bootstrapBrowserSession(body.credential);
      assert.equal(reusedResult.response.status, 401);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("rejects unauthenticated pairing credential requests", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const response = yield* HttpClient.post("/api/auth/pairing-token");
      assert.equal(response.status, 401);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("lists and revokes pairing links for owner sessions", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: {
          host: "0.0.0.0",
        },
      });

      const ownerCookie = yield* getAuthenticatedSessionCookieHeader();
      const createdResponse = yield* HttpClient.post("/api/auth/pairing-token", {
        headers: {
          cookie: ownerCookie,
        },
      });
      const createdBody = (yield* createdResponse.json) as {
        readonly id: string;
        readonly credential: string;
      };

      const listResponse = yield* HttpClient.get("/api/auth/pairing-links", {
        headers: {
          cookie: ownerCookie,
        },
      });
      const listedLinks = (yield* listResponse.json) as ReadonlyArray<{
        readonly id: string;
        readonly credential: string;
      }>;

      const revokeUrl = yield* getHttpServerUrl("/api/auth/pairing-links/revoke");
      const revokeResponse = yield* Effect.promise(() =>
        fetch(revokeUrl, {
          method: "POST",
          headers: {
            cookie: ownerCookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ id: createdBody.id }),
        }),
      );
      const revokedBootstrap = yield* bootstrapBrowserSession(createdBody.credential);

      assert.equal(createdResponse.status, 200);
      assert.equal(listResponse.status, 200);
      assert.isTrue(listedLinks.some((entry) => entry.id === createdBody.id));
      assert.equal(revokeResponse.status, 200);
      assert.equal(revokedBootstrap.response.status, 401);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("rejects pairing credential requests from non-owner paired sessions", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: {
          host: "0.0.0.0",
        },
      });

      const ownerResponse = yield* HttpClient.post("/api/auth/pairing-token", {
        headers: {
          cookie: yield* getAuthenticatedSessionCookieHeader(),
        },
      });
      const ownerBody = (yield* ownerResponse.json) as {
        readonly credential: string;
      };
      assert.equal(ownerResponse.status, 200);

      const pairedSessionCookie = yield* getAuthenticatedSessionCookieHeader(ownerBody.credential);
      const pairedResponse = yield* HttpClient.post("/api/auth/pairing-token", {
        headers: {
          cookie: pairedSessionCookie,
        },
      });
      const pairedBody = (yield* pairedResponse.json) as {
        readonly error: string;
      };

      assert.equal(pairedResponse.status, 403);
      assert.equal(pairedBody.error, "Only owner sessions can create pairing credentials.");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("lists paired clients and revokes other sessions while keeping the owner", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: {
          host: "0.0.0.0",
        },
      });

      const ownerCookie = yield* getAuthenticatedSessionCookieHeader();
      const pairingTokenUrl = yield* getHttpServerUrl("/api/auth/pairing-token");
      const ownerPairingResponse = yield* Effect.promise(() =>
        fetch(pairingTokenUrl, {
          method: "POST",
          headers: {
            cookie: ownerCookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            label: "Julius iPhone",
          }),
        }),
      );
      const ownerPairingBody = (yield* Effect.promise(() => ownerPairingResponse.json())) as {
        readonly credential: string;
        readonly label?: string;
      };
      assert.equal(ownerPairingResponse.status, 200);
      const pairedSessionBootstrap = yield* bootstrapBrowserSession(ownerPairingBody.credential, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
        },
      });
      const pairedSessionCookie = pairedSessionBootstrap.cookie?.split(";")[0];
      assert.isDefined(pairedSessionCookie);

      const pairedSessionCookieHeader = pairedSessionCookie ?? "";
      const listClientsUrl = yield* getHttpServerUrl("/api/auth/clients");
      const listBeforeResponse = yield* Effect.promise(() =>
        fetch(listClientsUrl, {
          headers: {
            cookie: ownerCookie,
          },
        }),
      );
      const clientsBefore = (yield* Effect.promise(() =>
        listBeforeResponse.json(),
      )) as ReadonlyArray<{
        readonly sessionId: string;
        readonly current: boolean;
        readonly client: {
          readonly label?: string;
          readonly deviceType: string;
          readonly ipAddress?: string;
          readonly os?: string;
          readonly browser?: string;
        };
      }>;
      const pairedClientBefore = clientsBefore.find((entry) => !entry.current);
      const pairedSessionId = clientsBefore.find((entry) => !entry.current)?.sessionId;

      const revokeOthersResponse = yield* HttpClient.post("/api/auth/clients/revoke-others", {
        headers: {
          cookie: ownerCookie,
        },
      });
      const revokeOthersBody = (yield* revokeOthersResponse.json) as {
        readonly revokedCount: number;
      };

      const listAfterResponse = yield* HttpClient.get("/api/auth/clients", {
        headers: {
          cookie: ownerCookie,
        },
      });
      const clientsAfter = (yield* listAfterResponse.json) as ReadonlyArray<{
        readonly sessionId: string;
        readonly current: boolean;
      }>;

      const pairedClientPairingResponse = yield* HttpClient.post("/api/auth/pairing-token", {
        headers: {
          cookie: pairedSessionCookieHeader,
        },
      });
      const pairedClientPairingBody = (yield* pairedClientPairingResponse.json) as {
        readonly error: string;
      };

      assert.equal(listBeforeResponse.status, 200);
      assert.equal(ownerPairingBody.label, "Julius iPhone");
      assert.lengthOf(clientsBefore, 2);
      assert.isDefined(pairedSessionId);
      assert.isDefined(pairedClientBefore);
      assert.deepInclude(pairedClientBefore?.client, {
        label: "Julius iPhone",
        deviceType: "mobile",
        os: "iOS",
        browser: "Safari",
        ipAddress: "127.0.0.1",
      });
      assert.equal(revokeOthersResponse.status, 200);
      assert.equal(revokeOthersBody.revokedCount, 1);
      assert.equal(listAfterResponse.status, 200);
      assert.lengthOf(clientsAfter, 1);
      assert.equal(clientsAfter[0]?.current, true);
      assert.equal(pairedClientPairingResponse.status, 401);
      assert.equal(pairedClientPairingBody.error, "Unauthorized request.");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("revokes an individual paired client session", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: {
          host: "0.0.0.0",
        },
      });

      const ownerCookie = yield* getAuthenticatedSessionCookieHeader();
      const pairingResponse = yield* HttpClient.post("/api/auth/pairing-token", {
        headers: {
          cookie: ownerCookie,
        },
      });
      const pairingBody = (yield* pairingResponse.json) as {
        readonly credential: string;
      };
      const pairedSessionCookie = yield* getAuthenticatedSessionCookieHeader(
        pairingBody.credential,
      );

      const clientsResponse = yield* HttpClient.get("/api/auth/clients", {
        headers: {
          cookie: ownerCookie,
        },
      });
      const clients = (yield* clientsResponse.json) as ReadonlyArray<{
        readonly sessionId: string;
        readonly current: boolean;
      }>;
      const pairedSessionId = clients.find((entry) => !entry.current)?.sessionId;
      assert.isDefined(pairedSessionId);

      const revokeUrl = yield* getHttpServerUrl("/api/auth/clients/revoke");
      const revokeResponse = yield* Effect.promise(() =>
        fetch(revokeUrl, {
          method: "POST",
          headers: {
            cookie: ownerCookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ sessionId: pairedSessionId }),
        }),
      );
      const pairedClientPairingResponse = yield* HttpClient.post("/api/auth/pairing-token", {
        headers: {
          cookie: pairedSessionCookie,
        },
      });

      assert.equal(revokeResponse.status, 200);
      assert.equal(pairedClientPairingResponse.status, 401);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("rejects reusing the same bootstrap credential after it has been exchanged", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const first = yield* bootstrapBrowserSession();
      const second = yield* bootstrapBrowserSession();

      assert.equal(first.response.status, 200);
      assert.equal(second.response.status, 401);
      assert.equal(
        (second.body as { readonly error?: string }).error,
        "Invalid bootstrap credential.",
      );
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect(
    "does not accept session tokens via query parameters on authenticated HTTP routes",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const projectDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-router-project-favicon-query-token-",
        });

        yield* buildAppUnderTest();

        const { cookie } = yield* bootstrapBrowserSession();
        assert.isDefined(cookie);
        const sessionToken = extractSessionTokenFromSetCookie(cookie ?? "");

        const response = yield* HttpClient.get(
          `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}&token=${encodeURIComponent(sessionToken)}`,
        );

        assert.equal(response.status, 401);
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("accepts websocket rpc handshake with a bootstrapped browser session cookie", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const { response: bootstrapResponse, cookie } = yield* bootstrapBrowserSession();

      assert.equal(bootstrapResponse.status, 200);
      assert.isDefined(cookie);

      const wsUrl = appendSessionCookieToWsUrl(
        yield* getWsServerUrl("/ws", { authenticated: false }),
        cookie?.split(";")[0] ?? "",
      );
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.serverGetConfig]({})),
      );

      assert.equal(response.environment.environmentId, testEnvironmentDescriptor.environmentId);
      assert.equal(response.auth.policy, "desktop-managed-local");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect(
    "rejects websocket rpc handshake when a session token is only provided via query string",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest();

        const { cookie } = yield* bootstrapBrowserSession();
        assert.isDefined(cookie);
        const sessionToken = extractSessionTokenFromSetCookie(cookie ?? "");
        const wsUrl = `${yield* getWsServerUrl("/ws", { authenticated: false })}?token=${encodeURIComponent(sessionToken)}`;

        const error = yield* Effect.flip(
          Effect.scoped(withWsRpcClient(wsUrl, (client) => client[WS_METHODS.serverGetConfig]({}))),
        );

        assert.equal(error._tag, "RpcClientError");
        assertInclude(String(error), "SocketOpenError");
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect(
    "accepts websocket rpc handshake with a dedicated websocket token in the query string",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest();

        const bearerToken = yield* getAuthenticatedBearerSessionToken();
        const wsTokenUrl = yield* getHttpServerUrl("/api/auth/ws-token");
        const wsTokenResponse = yield* Effect.promise(() =>
          fetch(wsTokenUrl, {
            method: "POST",
            headers: {
              authorization: `Bearer ${bearerToken}`,
            },
          }),
        );
        const wsTokenBody = (yield* Effect.promise(() => wsTokenResponse.json())) as {
          readonly token: string;
        };
        const wsUrl = `${yield* getWsServerUrl("/ws", { authenticated: false })}?wsToken=${encodeURIComponent(wsTokenBody.token)}`;

        const response = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) => client[WS_METHODS.serverGetConfig]({})),
        );

        assert.equal(response.environment.environmentId, testEnvironmentDescriptor.environmentId);
        assert.equal(response.auth.policy, "desktop-managed-local");
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("serves attachment files from state dir", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const attachmentId = "thread-11111111-1111-4111-8111-111111111111";

      const config = yield* buildAppUnderTest();
      const attachmentPath = resolveAttachmentRelativePath({
        attachmentsDir: config.attachmentsDir,
        relativePath: `${attachmentId}.bin`,
      });
      assert.isNotNull(attachmentPath, "Attachment path should be resolvable");

      yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true });
      yield* fileSystem.writeFileString(attachmentPath, "attachment-ok");

      const response = yield* HttpClient.get(`/attachments/${attachmentId}`, {
        headers: {
          cookie: yield* getAuthenticatedSessionCookieHeader(),
        },
      });
      assert.equal(response.status, 200);
      assert.equal(yield* response.text, "attachment-ok");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("serves attachment files for URL-encoded paths", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const config = yield* buildAppUnderTest();
      const attachmentPath = resolveAttachmentRelativePath({
        attachmentsDir: config.attachmentsDir,
        relativePath: "thread%20folder/message%20folder/file%20name.png",
      });
      assert.isNotNull(attachmentPath, "Attachment path should be resolvable");

      yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true });
      yield* fileSystem.writeFileString(attachmentPath, "attachment-encoded-ok");

      const response = yield* HttpClient.get(
        "/attachments/thread%20folder/message%20folder/file%20name.png",
        {
          headers: {
            cookie: yield* getAuthenticatedSessionCookieHeader(),
          },
        },
      );
      assert.equal(response.status, 200);
      assert.equal(yield* response.text, "attachment-encoded-ok");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("returns 404 for missing attachment id lookups", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const response = yield* HttpClient.get(
        "/attachments/missing-11111111-1111-4111-8111-111111111111",
        {
          headers: {
            cookie: yield* getAuthenticatedSessionCookieHeader(),
          },
        },
      );
      assert.equal(response.status, 404);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc server.upsertKeybinding", () =>
    Effect.gen(function* () {
      const rule: KeybindingRule = {
        command: "terminal.toggle",
        key: "ctrl+k",
      };
      const resolved: ResolvedKeybindingRule = {
        command: "terminal.toggle",
        shortcut: {
          key: "k",
          metaKey: false,
          ctrlKey: true,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
      };

      yield* buildAppUnderTest({
        layers: {
          keybindings: {
            upsertKeybindingRule: () => Effect.succeed([resolved]),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.serverUpsertKeybinding](rule)),
      );

      assert.deepEqual(response.issues, []);
      assert.deepEqual(response.keybindings, [resolved]);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("rejects websocket rpc handshake when session authentication is missing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ws-auth-required-" });
      yield* fs.writeFileString(
        path.join(projectDir, "needle-file.ts"),
        "export const needle = 1;",
      );

      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws", { authenticated: false });
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.projectsSearchEntries]({
            cwd: projectDir,
            query: "needle",
            limit: 10,
          }),
        ).pipe(Effect.result),
      );

      assertTrue(result._tag === "Failure");
      assertInclude(String(result.failure), "SocketOpenError");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc subscribeServerConfig streams snapshot then update", () =>
    Effect.gen(function* () {
      const providers = [
        {
          instanceId: "codex",
          driver: "codex",
          enabled: true,
          installed: true,
          version: "1.0.0",
          status: "ready",
          auth: { status: "authenticated" as const },
          checkedAt: "2026-04-11T00:00:00.000Z",
          models: [],
          slashCommands: [],
          skills: [],
        },
      ] as const;
      const changeEvent = {
        keybindings: [],
        issues: [],
      } as const;

      yield* buildAppUnderTest({
        config: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        layers: {
          keybindings: {
            loadConfigState: Effect.succeed({
              keybindings: [],
              issues: [],
            }),
            streamChanges: Stream.succeed(changeEvent),
          },
          providerRegistry: {
            getProviders: Effect.succeed(providers),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const events = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.subscribeServerConfig]({}).pipe(Stream.take(2), Stream.runCollect),
        ),
      );

      const [first, second] = Array.from(events);
      assert.equal(first?.type, "snapshot");
      if (first?.type === "snapshot") {
        assert.equal(first.version, 1);
        assert.deepEqual(first.config.keybindings, []);
        assert.deepEqual(first.config.issues, []);
        assert.deepEqual(first.config.providers, providers);
        assert.equal(first.config.observability.logsDirectoryPath.endsWith("/logs"), true);
        assert.equal(first.config.observability.localTracingEnabled, true);
        assert.equal(first.config.observability.otlpTracesUrl, "http://localhost:4318/v1/traces");
        assert.equal(first.config.observability.otlpTracesEnabled, true);
        assert.equal(first.config.observability.otlpMetricsUrl, "http://localhost:4318/v1/metrics");
        assert.equal(first.config.observability.otlpMetricsEnabled, true);
        assert.deepEqual(first.config.settings, DEFAULT_SERVER_SETTINGS);
      }
      assert.deepEqual(second, {
        version: 1,
        type: "keybindingsUpdated",
        payload: { issues: [] },
      });
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc subscribeServerConfig emits provider status updates", () =>
    Effect.gen(function* () {
      const nextProviders = [
        {
          instanceId: "codex",
          driver: "codex",
          enabled: true,
          installed: true,
          version: "1.0.0",
          status: "ready",
          auth: { status: "authenticated" as const },
          checkedAt: "2026-04-11T00:00:00.000Z",
          models: [],
          slashCommands: [],
          skills: [],
        },
      ] as const;

      yield* buildAppUnderTest({
        layers: {
          keybindings: {
            loadConfigState: Effect.succeed({
              keybindings: [],
              issues: [],
            }),
            streamChanges: Stream.empty,
          },
          providerRegistry: {
            getProviders: Effect.succeed([]),
            streamChanges: Stream.succeed(nextProviders),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const events = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.subscribeServerConfig]({}).pipe(Stream.take(2), Stream.runCollect),
        ),
      );

      const [first, second] = Array.from(events);
      assert.equal(first?.type, "snapshot");
      if (first?.type === "snapshot") {
        assert.deepEqual(first.config.providers, []);
      }
      assert.deepEqual(second, {
        version: 1,
        type: "providerStatuses",
        payload: { providers: nextProviders },
      });
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect(
    "routes websocket rpc subscribeServerLifecycle replays snapshot and streams updates",
    () =>
      Effect.gen(function* () {
        const lifecycleEvents = [
          {
            version: 1,
            sequence: 1,
            type: "welcome",
            payload: {
              environment: testEnvironmentDescriptor,
              cwd: "/tmp/project",
              projectName: "project",
            },
          },
        ] as const;
        const liveEvents = Stream.make({
          version: 1,
          sequence: 2,
          type: "ready",
          payload: { at: new Date().toISOString(), environment: testEnvironmentDescriptor },
        });

        yield* buildAppUnderTest({
          layers: {
            serverLifecycleEvents: {
              snapshot: Effect.succeed({
                sequence: 1,
                events: lifecycleEvents,
              }),
              stream: liveEvents,
            },
          },
        });

        const wsUrl = yield* getWsServerUrl("/ws");
        const events = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.subscribeServerLifecycle]({}).pipe(Stream.take(2), Stream.runCollect),
          ),
        );

        const [first, second] = Array.from(events);
        assert.equal(first?.type, "welcome");
        assert.equal(first?.sequence, 1);
        assert.equal(second?.type, "ready");
        assert.equal(second?.sequence, 2);
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc projects.searchEntries", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ws-project-search-" });
      yield* fs.writeFileString(
        path.join(projectDir, "needle-file.ts"),
        "export const needle = 1;",
      );

      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.projectsSearchEntries]({
            cwd: projectDir,
            query: "needle",
            limit: 10,
          }),
        ),
      );

      assert.isAtLeast(response.entries.length, 1);
      assert.isTrue(response.entries.some((entry) => entry.path === "needle-file.ts"));
      assert.equal(response.truncated, false);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc projects.listDirectory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ws-project-list-" });
      yield* fs.makeDirectory(path.join(projectDir, "src"), { recursive: true });
      yield* fs.writeFileString(path.join(projectDir, "src", "index.ts"), "export {};");

      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.projectsListDirectory]({
            cwd: projectDir,
            relativeDir: "",
          }),
        ),
      );

      assert.isTrue(
        response.entries.some((entry) => entry.path === "src" && entry.kind === "directory"),
      );
      assert.equal(response.truncated, false);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc projects.searchEntries errors", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws");
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.projectsSearchEntries]({
            cwd: "/definitely/not/a/real/project/path",
            query: "needle",
            limit: 10,
          }),
        ).pipe(Effect.result),
      );

      assertTrue(result._tag === "Failure");
      assertTrue(result.failure._tag === "ProjectSearchEntriesError");
      assertInclude(
        result.failure.message,
        "Project root does not exist: /definitely/not/a/real/project/path",
      );
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc projects.readFile", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ws-project-read-" });
      yield* fs.makeDirectory(path.join(projectDir, "src"), { recursive: true });
      yield* fs.writeFileString(path.join(projectDir, "src", "index.ts"), "export {};\n");

      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.projectsReadFile]({
            cwd: projectDir,
            relativePath: "src/index.ts",
          }),
        ),
      );

      assert.equal(response.relativePath, "src/index.ts");
      assert.equal(response.contents, "export {};\n");
      assert.equal(response.truncated, false);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc projects.writeFile", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ws-project-write-" });

      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.projectsWriteFile]({
            cwd: projectDir,
            relativePath: "nested/created.txt",
            contents: "written-by-rpc",
          }),
        ),
      );

      assert.equal(response.relativePath, "nested/created.txt");
      const persisted = yield* fs.readFileString(path.join(projectDir, "nested", "created.txt"));
      assert.equal(persisted, "written-by-rpc");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("creates a missing project root during websocket project.create dispatch", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parentDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ws-project-create-" });
      const missingProjectRoot = path.join(parentDir, "nested", "new-project");

      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
            type: "project.create",
            commandId: CommandId.make("cmd-project-create-missing-root"),
            projectId: ProjectId.make("project-create-missing-root"),
            title: "New Project",
            projectRoot: missingProjectRoot,
            createProjectRootIfMissing: true,
            defaultModelSelection: {
              instanceId: "codex",
              model: "gpt-5-codex",
            },
            createdAt: new Date().toISOString(),
          }),
        ),
      );
      const stat = yield* fs.stat(missingProjectRoot);

      assert.isAtLeast(response.sequence, 0);
      assert.equal(stat.type, "Directory");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc projects.writeFile errors", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ws-project-write-" });

      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws");
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.projectsWriteFile]({
            cwd: projectDir,
            relativePath: "../escape.txt",
            contents: "nope",
          }),
        ).pipe(Effect.result),
      );

      assertTrue(result._tag === "Failure");
      assertTrue(result.failure._tag === "ProjectWriteFileError");
      assert.equal(result.failure.message, "Project file path must stay within the project root.");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc shell.openInEditor", () =>
    Effect.gen(function* () {
      let openedInput: { cwd: string; editor: EditorId } | null = null;
      yield* buildAppUnderTest({
        layers: {
          open: {
            openInEditor: (input) =>
              Effect.sync(() => {
                openedInput = input;
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.shellOpenInEditor]({
            cwd: "/tmp/project",
            editor: "cursor",
          }),
        ),
      );

      assert.deepEqual(openedInput, { cwd: "/tmp/project", editor: "cursor" });
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc shell.openInEditor errors", () =>
    Effect.gen(function* () {
      const openError = new OpenError({ message: "Editor command not found: cursor" });
      yield* buildAppUnderTest({
        layers: {
          open: {
            openInEditor: () => Effect.fail(openError),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.shellOpenInEditor]({
            cwd: "/tmp/project",
            editor: "cursor",
          }),
        ).pipe(Effect.result),
      );

      assertFailure(result, openError);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc git methods", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        layers: {
          gitManager: {
            invalidateLocalStatus: () => Effect.void,
            invalidateRemoteStatus: () => Effect.void,
            invalidateStatus: () => Effect.void,
            localStatus: () =>
              Effect.succeed({
                isRepo: true,
                hasOriginRemote: true,
                isDefaultBranch: true,
                branch: "main",
                hasWorkingTreeChanges: false,
                workingTree: { files: [], insertions: 0, deletions: 0 },
              }),
            remoteStatus: () =>
              Effect.succeed({
                hasUpstream: true,
                aheadCount: 0,
                behindCount: 0,
                pr: null,
              }),
            status: () =>
              Effect.succeed({
                isRepo: true,
                hasOriginRemote: true,
                isDefaultBranch: true,
                branch: "main",
                hasWorkingTreeChanges: false,
                workingTree: { files: [], insertions: 0, deletions: 0 },
                hasUpstream: true,
                aheadCount: 0,
                behindCount: 0,
                pr: null,
              }),
            runStackedAction: (input, options) =>
              Effect.gen(function* () {
                const result = {
                  action: "commit",
                  branch: { status: "skipped_not_requested" as const },
                  commit: {
                    status: "created" as const,
                    commitSha: "abc123",
                    subject: "feat: demo",
                  },
                  push: { status: "skipped_not_requested" as const },
                  pr: { status: "skipped_not_requested" as const },
                  toast: {
                    title: "Committed abc123",
                    description: "feat: demo",
                    cta: {
                      kind: "run_action",
                      label: "Push",
                      action: {
                        kind: "push",
                      },
                    },
                  },
                } as const;

                yield* (
                  options?.progressReporter?.publish({
                    actionId: options.actionId ?? input.actionId,
                    cwd: input.cwd,
                    action: input.action,
                    kind: "phase_started",
                    phase: "commit",
                    label: "Committing...",
                  }) ?? Effect.void
                );

                yield* (
                  options?.progressReporter?.publish({
                    actionId: options.actionId ?? input.actionId,
                    cwd: input.cwd,
                    action: input.action,
                    kind: "action_finished",
                    result,
                  }) ?? Effect.void
                );

                return result;
              }),
            resolvePullRequest: () =>
              Effect.succeed({
                pullRequest: {
                  number: 1,
                  title: "Demo PR",
                  url: "https://example.com/pr/1",
                  baseBranch: "main",
                  headBranch: "feature/demo",
                  state: "open",
                },
              }),
            preparePullRequestThread: () =>
              Effect.succeed({
                pullRequest: {
                  number: 1,
                  title: "Demo PR",
                  url: "https://example.com/pr/1",
                  baseBranch: "main",
                  headBranch: "feature/demo",
                  state: "open",
                },
                branch: "feature/demo",
                worktreePath: null,
              }),
          },
          gitCore: {
            pullCurrentBranch: () =>
              Effect.succeed({
                status: "pulled",
                branch: "main",
                upstreamBranch: "origin/main",
              }),
            listBranches: () =>
              Effect.succeed({
                branches: [
                  {
                    name: "main",
                    current: true,
                    isDefault: true,
                    worktreePath: null,
                  },
                ],
                isRepo: true,
                hasOriginRemote: true,
                nextCursor: null,
                totalCount: 1,
              }),
            createWorktree: () =>
              Effect.succeed({
                worktree: { path: "/tmp/wt", branch: "feature/demo" },
              }),
            removeWorktree: () => Effect.void,
            createBranch: (input) => Effect.succeed({ branch: input.branch }),
            checkoutBranch: (input) => Effect.succeed({ branch: input.branch }),
            initRepo: () => Effect.void,
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");

      const pull = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.gitPull]({ cwd: "/tmp/repo" })),
      );
      assert.equal(pull.status, "pulled");

      const refreshedStatus = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitRefreshStatus]({ cwd: "/tmp/repo" }),
        ),
      );
      assert.equal(refreshedStatus.isRepo, true);

      const stackedEvents = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitRunStackedAction]({
            actionId: "action-1",
            cwd: "/tmp/repo",
            action: "commit",
          }).pipe(
            Stream.runCollect,
            Effect.map((events) => Array.from(events)),
          ),
        ),
      );
      const lastStackedEvent = stackedEvents.at(-1);
      assert.equal(lastStackedEvent?.kind, "action_finished");
      if (lastStackedEvent?.kind === "action_finished") {
        assert.equal(lastStackedEvent.result.action, "commit");
      }

      const resolvedPr = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitResolvePullRequest]({
            cwd: "/tmp/repo",
            reference: "1",
          }),
        ),
      );
      assert.equal(resolvedPr.pullRequest.number, 1);

      const prepared = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitPreparePullRequestThread]({
            cwd: "/tmp/repo",
            reference: "1",
            mode: "local",
          }),
        ),
      );
      assert.equal(prepared.branch, "feature/demo");

      const branches = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitListBranches]({ cwd: "/tmp/repo" }),
        ),
      );
      assert.equal(branches.branches[0]?.name, "main");

      const worktree = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitCreateWorktree]({
            cwd: "/tmp/repo",
            branch: "main",
            path: null,
          }),
        ),
      );
      assert.equal(worktree.worktree.branch, "feature/demo");

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitRemoveWorktree]({
            cwd: "/tmp/repo",
            path: "/tmp/wt",
          }),
        ),
      );

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitCreateBranch]({
            cwd: "/tmp/repo",
            branch: "feature/new",
          }),
        ),
      );

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitCheckout]({
            cwd: "/tmp/repo",
            branch: "main",
          }),
        ),
      );

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitInit]({
            cwd: "/tmp/repo",
          }),
        ),
      );
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc git.pull errors", () =>
    Effect.gen(function* () {
      const gitError = new GitCommandError({
        operation: "pull",
        command: "git pull --ff-only",
        cwd: "/tmp/repo",
        detail: "upstream missing",
      });
      let invalidationCalls = 0;
      let statusCalls = 0;
      yield* buildAppUnderTest({
        layers: {
          gitCore: {
            pullCurrentBranch: () => Effect.fail(gitError),
          },
          gitManager: {
            invalidateLocalStatus: () =>
              Effect.sync(() => {
                invalidationCalls += 1;
              }),
            invalidateRemoteStatus: () =>
              Effect.sync(() => {
                invalidationCalls += 1;
              }),
            invalidateStatus: () =>
              Effect.sync(() => {
                invalidationCalls += 1;
              }),
            localStatus: () =>
              Effect.succeed({
                isRepo: true,
                hasOriginRemote: true,
                isDefaultBranch: true,
                branch: "main",
                hasWorkingTreeChanges: true,
                workingTree: { files: [], insertions: 0, deletions: 0 },
              }),
            remoteStatus: () =>
              Effect.sync(() => {
                statusCalls += 1;
                return {
                  hasUpstream: true,
                  aheadCount: 0,
                  behindCount: 0,
                  pr: null,
                };
              }),
            status: () =>
              Effect.sync(() => {
                statusCalls += 1;
                return {
                  isRepo: true,
                  hasOriginRemote: true,
                  isDefaultBranch: true,
                  branch: "main",
                  hasWorkingTreeChanges: true,
                  workingTree: { files: [], insertions: 0, deletions: 0 },
                  hasUpstream: true,
                  aheadCount: 0,
                  behindCount: 0,
                  pr: null,
                };
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.gitPull]({ cwd: "/tmp/repo" })).pipe(
          Effect.result,
        ),
      );

      assertFailure(result, gitError);
      assert.equal(invalidationCalls, 0);
      assert.equal(statusCalls, 0);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc git.runStackedAction errors after refreshing git status", () =>
    Effect.gen(function* () {
      const gitError = new GitCommandError({
        operation: "commit",
        command: "git commit",
        cwd: "/tmp/repo",
        detail: "nothing to commit",
      });
      let invalidationCalls = 0;
      let statusCalls = 0;
      yield* buildAppUnderTest({
        layers: {
          gitManager: {
            invalidateLocalStatus: () =>
              Effect.sync(() => {
                invalidationCalls += 1;
              }),
            invalidateRemoteStatus: () =>
              Effect.sync(() => {
                invalidationCalls += 1;
              }),
            invalidateStatus: () =>
              Effect.sync(() => {
                invalidationCalls += 1;
              }),
            localStatus: () =>
              Effect.succeed({
                isRepo: true,
                hasOriginRemote: true,
                isDefaultBranch: false,
                branch: "feature/demo",
                hasWorkingTreeChanges: true,
                workingTree: { files: [], insertions: 0, deletions: 0 },
              }),
            remoteStatus: () =>
              Effect.sync(() => {
                statusCalls += 1;
                return {
                  hasUpstream: true,
                  aheadCount: 0,
                  behindCount: 0,
                  pr: null,
                };
              }),
            status: () =>
              Effect.sync(() => {
                statusCalls += 1;
                return {
                  isRepo: true,
                  hasOriginRemote: true,
                  isDefaultBranch: false,
                  branch: "feature/demo",
                  hasWorkingTreeChanges: true,
                  workingTree: { files: [], insertions: 0, deletions: 0 },
                  hasUpstream: true,
                  aheadCount: 0,
                  behindCount: 0,
                  pr: null,
                };
              }),
            runStackedAction: () => Effect.fail(gitError),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitRunStackedAction]({
            actionId: "action-1",
            cwd: "/tmp/repo",
            action: "commit",
          }).pipe(Stream.runCollect, Effect.result),
        ),
      );

      assertFailure(result, gitError);
      assert.equal(invalidationCalls, 0);
      assert.equal(statusCalls, 0);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("completes websocket rpc git.pull before background git status refresh finishes", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        layers: {
          gitCore: {
            pullCurrentBranch: () =>
              Effect.succeed({
                status: "pulled",
                branch: "main",
                upstreamBranch: "origin/main",
              }),
          },
          gitManager: {
            invalidateLocalStatus: () => Effect.void,
            invalidateRemoteStatus: () => Effect.void,
            localStatus: () =>
              Effect.succeed({
                isRepo: true,
                hasOriginRemote: true,
                isDefaultBranch: true,
                branch: "main",
                hasWorkingTreeChanges: false,
                workingTree: { files: [], insertions: 0, deletions: 0 },
              }),
            remoteStatus: () =>
              Effect.sleep(Duration.seconds(2)).pipe(
                Effect.as({
                  hasUpstream: true,
                  aheadCount: 0,
                  behindCount: 0,
                  pr: null,
                }),
              ),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const startedAt = Date.now();
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.gitPull]({ cwd: "/tmp/repo" })),
      );
      const elapsedMs = Date.now() - startedAt;

      assert.equal(result.status, "pulled");
      assertTrue(elapsedMs < 1_000);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect(
    "completes websocket rpc git.runStackedAction before background git status refresh finishes",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest({
          layers: {
            gitManager: {
              invalidateLocalStatus: () => Effect.void,
              invalidateRemoteStatus: () => Effect.void,
              localStatus: () =>
                Effect.succeed({
                  isRepo: true,
                  hasOriginRemote: true,
                  isDefaultBranch: false,
                  branch: "feature/demo",
                  hasWorkingTreeChanges: false,
                  workingTree: { files: [], insertions: 0, deletions: 0 },
                }),
              remoteStatus: () =>
                Effect.sleep(Duration.seconds(2)).pipe(
                  Effect.as({
                    hasUpstream: true,
                    aheadCount: 0,
                    behindCount: 0,
                    pr: null,
                  }),
                ),
              runStackedAction: () =>
                Effect.succeed({
                  action: "commit",
                  branch: { status: "skipped_not_requested" as const },
                  commit: {
                    status: "created",
                    commitSha: "abc123",
                    subject: "feat: demo",
                  },
                  push: { status: "skipped_not_requested" as const },
                  pr: { status: "skipped_not_requested" as const },
                  toast: {
                    title: "Committed abc123",
                    description: "feat: demo",
                    cta: {
                      kind: "run_action",
                      label: "Push",
                      action: {
                        kind: "push",
                      },
                    },
                  },
                }),
            },
          },
        });

        const wsUrl = yield* getWsServerUrl("/ws");
        const startedAt = Date.now();
        yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.gitRunStackedAction]({
              actionId: "action-1",
              cwd: "/tmp/repo",
              action: "commit",
            }).pipe(Stream.runCollect),
          ),
        );
        const elapsedMs = Date.now() - startedAt;

        assertTrue(elapsedMs < 1_000);
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect(
    "starts a background local git status refresh after a successful git.runStackedAction",
    () =>
      Effect.gen(function* () {
        const localRefreshStarted = yield* Deferred.make<void>();

        yield* buildAppUnderTest({
          layers: {
            gitManager: {
              invalidateLocalStatus: () => Effect.void,
              invalidateRemoteStatus: () => Effect.void,
              localStatus: () =>
                Deferred.succeed(localRefreshStarted, undefined).pipe(
                  Effect.ignore,
                  Effect.andThen(
                    Effect.succeed({
                      isRepo: true,
                      hasOriginRemote: true,
                      isDefaultBranch: false,
                      branch: "feature/demo",
                      hasWorkingTreeChanges: false,
                      workingTree: { files: [], insertions: 0, deletions: 0 },
                    }),
                  ),
                ),
              remoteStatus: () =>
                Effect.sleep(Duration.seconds(2)).pipe(
                  Effect.as({
                    hasUpstream: true,
                    aheadCount: 0,
                    behindCount: 0,
                    pr: null,
                  }),
                ),
              runStackedAction: () =>
                Effect.succeed({
                  action: "commit",
                  branch: { status: "skipped_not_requested" as const },
                  commit: {
                    status: "created",
                    commitSha: "abc123",
                    subject: "feat: demo",
                  },
                  push: { status: "skipped_not_requested" as const },
                  pr: { status: "skipped_not_requested" as const },
                  toast: {
                    title: "Committed abc123",
                    description: "feat: demo",
                    cta: {
                      kind: "run_action",
                      label: "Push",
                      action: {
                        kind: "push",
                      },
                    },
                  },
                }),
            },
          },
        });

        const wsUrl = yield* getWsServerUrl("/ws");
        yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.gitRunStackedAction]({
              actionId: "action-1",
              cwd: "/tmp/repo",
              action: "commit",
            }).pipe(Stream.runCollect),
          ),
        );

        yield* Deferred.await(localRefreshStarted);
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc orchestration methods", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const snapshot = {
        snapshotSequence: 1,
        updatedAt: now,
        projects: [
          {
            id: ProjectId.make("project-a"),
            title: "Project A",
            projectRoot: "/tmp/project-a",
            defaultModelSelection,
            scripts: [],
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
        ],
        threads: [
          {
            id: ThreadId.make("thread-1"),
            projectId: ProjectId.make("project-a"),
            title: "Thread A",
            modelSelection: defaultModelSelection,
            interactionMode: "default",
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            latestTurn: null,
            messages: [],
            session: null,
            activities: [],
            proposedPlans: [],
            checkpoints: [],
            deletedAt: null,
          },
        ],
      } as const satisfies OrchestrationReadModel;

      yield* buildAppUnderTest({
        layers: {
          threadProjection: {
            getSnapshot: () => Effect.succeed(snapshot),
          },
          orchestrationEngine: {
            dispatch: () => Effect.succeed({ sequence: 7 }),
            readEvents: () => Stream.empty,
          },
          checkpointDiffQuery: {
            getTurnDiff: () =>
              Effect.succeed({
                threadId: ThreadId.make("thread-1"),
                fromTurnCount: 0,
                toTurnCount: 1,
                diff: "turn-diff",
              }),
            getFullThreadDiff: () =>
              Effect.succeed({
                threadId: ThreadId.make("thread-1"),
                fromTurnCount: 0,
                toTurnCount: 1,
                diff: "full-diff",
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const dispatchResult = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
            type: "thread.session.stop",
            commandId: CommandId.make("cmd-1"),
            threadId: ThreadId.make("thread-1"),
            createdAt: now,
          }),
        ),
      );
      assert.equal(dispatchResult.sequence, 7);

      const turnDiffResult = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.getTurnDiff]({
            threadId: ThreadId.make("thread-1"),
            fromTurnCount: 0,
            toTurnCount: 1,
          }),
        ),
      );
      assert.equal(turnDiffResult.diff, "turn-diff");

      const fullDiffResult = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.getFullThreadDiff]({
            threadId: ThreadId.make("thread-1"),
            toTurnCount: 1,
          }),
        ),
      );
      assert.equal(fullDiffResult.diff, "full-diff");

      const replayResult = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.replayEvents]({
            fromSequenceExclusive: 0,
          }),
        ),
      );
      assert.deepEqual(replayResult, []);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("keeps thread subscriptions live while the initial detail snapshot is missing", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const threadId = ThreadId.make("thread-racy");
      const event = {
        sequence: 1,
        eventId: EventId.make("event-racy-message"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-racy-message"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-racy-message"),
        metadata: {},
        type: "thread.message-sent",
        payload: {
          threadId,
          messageId: MessageId.make("message-racy"),
          role: "user",
          text: "hello from the live stream",
          attachments: [],
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      } satisfies Extract<OrchestrationEvent, { type: "thread.message-sent" }>;

      yield* buildAppUnderTest({
        layers: {
          threadProjection: {
            getThreadDetailById: () => Effect.succeed(Option.none()),
          },
          orchestrationEngine: {
            streamDomainEvents: Stream.make(event),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const items = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.subscribeThread]({ threadId }).pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.map((chunk) => Array.from(chunk)),
          ),
        ),
      );

      assert.deepEqual(items, [{ kind: "event", event }]);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("enriches replayed project events with repository identity metadata", () =>
    Effect.gen(function* () {
      const repositoryIdentity = {
        canonicalKey: "github.com/interfaces-co/multi",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "git@github.com:interfaces-co/Multi.git",
        },
        displayName: "interfaces-co/multi",
        provider: "github",
        owner: "interfaces-co",
        name: "multi",
      } as const;

      yield* buildAppUnderTest({
        layers: {
          orchestrationEngine: {
            readEvents: (_fromSequenceExclusive) =>
              Stream.make({
                sequence: 1,
                eventId: EventId.make("event-1"),
                aggregateKind: "project",
                aggregateId: defaultProjectId,
                occurredAt: "2026-04-05T00:00:00.000Z",
                commandId: null,
                causationEventId: null,
                correlationId: null,
                metadata: {},
                type: "project.created",
                payload: {
                  projectId: defaultProjectId,
                  title: "Default Project",
                  projectRoot: "/tmp/default-project",
                  defaultModelSelection,
                  scripts: [],
                  createdAt: "2026-04-05T00:00:00.000Z",
                  updatedAt: "2026-04-05T00:00:00.000Z",
                },
              } satisfies Extract<OrchestrationEvent, { type: "project.created" }>),
          },
          repositoryIdentityResolver: {
            resolve: () => Effect.succeed(repositoryIdentity),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const replayResult = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.replayEvents]({
            fromSequenceExclusive: 0,
          }),
        ),
      );

      const replayedEvent = replayResult[0];
      assert.equal(replayedEvent?.type, "project.created");
      assert.deepEqual(
        replayedEvent && replayedEvent.type === "project.created"
          ? replayedEvent.payload.repositoryIdentity
          : null,
        repositoryIdentity,
      );
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("closes thread terminals after a successful archive command", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-archive");
      const closeInputs: Array<Parameters<TerminalManagerShape["close"]>[0]> = [];

      yield* buildAppUnderTest({
        layers: {
          terminalManager: {
            close: (input) =>
              Effect.sync(() => {
                closeInputs.push(input);
              }),
          },
          orchestrationEngine: {
            dispatch: () => Effect.succeed({ sequence: 8 }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const dispatchResult = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
            type: "thread.archive",
            commandId: CommandId.make("cmd-thread-archive"),
            threadId,
          }),
        ),
      );

      assert.equal(dispatchResult.sequence, 8);
      assert.deepEqual(closeInputs, [{ threadId }]);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect(
    "bootstraps first-send worktree turns on the server before dispatching turn start",
    () =>
      Effect.gen(function* () {
        const dispatchedCommands: Array<OrchestrationCommand> = [];
        const refreshStatus = vi.fn((_: string) =>
          Effect.succeed({
            isRepo: true,
            hasOriginRemote: true,
            isDefaultBranch: false,
            branch: "multi/bootstrap-branch",
            hasWorkingTreeChanges: false,
            workingTree: {
              files: [],
              insertions: 0,
              deletions: 0,
            },
            hasUpstream: true,
            aheadCount: 0,
            behindCount: 0,
            pr: null,
          }),
        );
        const createWorktree = vi.fn((_: Parameters<GitCoreShape["createWorktree"]>[0]) =>
          Effect.succeed({
            worktree: {
              branch: "multi/bootstrap-branch",
              path: "/tmp/bootstrap-worktree",
            },
          }),
        );
        const runForThread = vi.fn(
          (_: Parameters<ProjectSetupScriptRunnerShape["runForThread"]>[0]) =>
            Effect.succeed({
              status: "started" as const,
              scriptId: "setup",
              scriptName: "Setup",
              terminalId: "setup-setup",
              cwd: "/tmp/bootstrap-worktree",
            }),
        );

        yield* buildAppUnderTest({
          layers: {
            gitCore: {
              createWorktree,
            },
            gitStatusBroadcaster: {
              refreshStatus,
            },
            orchestrationEngine: {
              dispatch: (command) =>
                Effect.sync(() => {
                  dispatchedCommands.push(command);
                  return { sequence: dispatchedCommands.length };
                }),
              readEvents: () => Stream.empty,
            },
            projectSetupScriptRunner: {
              runForThread,
            },
          },
        });

        const createdAt = new Date().toISOString();
        const wsUrl = yield* getWsServerUrl("/ws");
        const response = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
              type: "thread.turn.start",
              commandId: CommandId.make("cmd-bootstrap-turn-start"),
              threadId: ThreadId.make("thread-bootstrap"),
              message: {
                messageId: MessageId.make("msg-bootstrap"),
                role: "user",
                text: "hello",
                attachments: [],
              },
              modelSelection: defaultModelSelection,
              runtimeMode: "full-access",
              interactionMode: "default",
              bootstrap: {
                createThread: {
                  projectId: defaultProjectId,
                  title: "Bootstrap Thread",
                  modelSelection: defaultModelSelection,
                  runtimeMode: "full-access",
                  interactionMode: "default",
                  branch: "main",
                  worktreePath: null,
                  createdAt,
                },
                prepareWorktree: {
                  projectCwd: "/tmp/project",
                  baseBranch: "main",
                  branch: "multi/bootstrap-branch",
                },
                runSetupScript: true,
              },
              createdAt,
            }),
          ),
        );

        assert.equal(response.sequence, 5);
        assert.deepEqual(
          dispatchedCommands.map((command) => command.type),
          [
            "thread.create",
            "thread.meta.update",
            "thread.activity.append",
            "thread.activity.append",
            "thread.turn.start",
          ],
        );
        assert.deepEqual(createWorktree.mock.calls[0]?.[0], {
          cwd: "/tmp/project",
          branch: "main",
          newBranch: "multi/bootstrap-branch",
          path: null,
        });
        assert.deepEqual(runForThread.mock.calls[0]?.[0], {
          threadId: ThreadId.make("thread-bootstrap"),
          projectId: defaultProjectId,
          projectCwd: "/tmp/project",
          worktreePath: "/tmp/bootstrap-worktree",
        });
        assert.deepEqual(refreshStatus.mock.calls[0]?.[0], "/tmp/bootstrap-worktree");

        const setupActivities = dispatchedCommands.filter(
          (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
            command.type === "thread.activity.append",
        );
        assert.deepEqual(
          setupActivities.map((command) => command.activity.kind),
          ["setup-script.requested", "setup-script.started"],
        );
        const finalCommand = dispatchedCommands[4];
        assertTrue(finalCommand?.type === "thread.turn.start");
        if (finalCommand?.type === "thread.turn.start") {
          assert.equal(finalCommand.bootstrap, undefined);
        }
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("records setup-script failures without aborting bootstrap turn start", () =>
    Effect.gen(function* () {
      const dispatchedCommands: Array<OrchestrationCommand> = [];
      const createWorktree = vi.fn((_: Parameters<GitCoreShape["createWorktree"]>[0]) =>
        Effect.succeed({
          worktree: {
            branch: "multi/bootstrap-branch",
            path: "/tmp/bootstrap-worktree",
          },
        }),
      );
      const runForThread = vi.fn(
        (_: Parameters<ProjectSetupScriptRunnerShape["runForThread"]>[0]) =>
          Effect.fail(new Error("pty unavailable")),
      );

      yield* buildAppUnderTest({
        layers: {
          gitCore: {
            createWorktree,
          },
          orchestrationEngine: {
            dispatch: (command) =>
              Effect.sync(() => {
                dispatchedCommands.push(command);
                return { sequence: dispatchedCommands.length };
              }),
            readEvents: () => Stream.empty,
          },
          projectSetupScriptRunner: {
            runForThread,
          },
        },
      });

      const createdAt = new Date().toISOString();
      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
            type: "thread.turn.start",
            commandId: CommandId.make("cmd-bootstrap-turn-start-setup-failure"),
            threadId: ThreadId.make("thread-bootstrap-setup-failure"),
            message: {
              messageId: MessageId.make("msg-bootstrap-setup-failure"),
              role: "user",
              text: "hello",
              attachments: [],
            },
            modelSelection: defaultModelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            bootstrap: {
              createThread: {
                projectId: defaultProjectId,
                title: "Bootstrap Thread",
                modelSelection: defaultModelSelection,
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: "main",
                worktreePath: null,
                createdAt,
              },
              prepareWorktree: {
                projectCwd: "/tmp/project",
                baseBranch: "main",
                branch: "multi/bootstrap-branch",
              },
              runSetupScript: true,
            },
            createdAt,
          }),
        ),
      );

      assert.equal(response.sequence, 4);
      assert.deepEqual(
        dispatchedCommands.map((command) => command.type),
        ["thread.create", "thread.meta.update", "thread.activity.append", "thread.turn.start"],
      );
      const setupFailureActivity = dispatchedCommands.find(
        (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
          command.type === "thread.activity.append",
      );
      assert.equal(setupFailureActivity?.activity.kind, "setup-script.failed");
      assert.deepEqual(setupFailureActivity?.activity.payload, {
        detail: "pty unavailable",
        worktreePath: "/tmp/bootstrap-worktree",
      });
      assertTrue(dispatchedCommands.every((command) => command.type !== "thread.delete"));
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("does not misattribute setup activity dispatch failures as setup launch failures", () =>
    Effect.gen(function* () {
      const dispatchedCommands: Array<OrchestrationCommand> = [];
      const createWorktree = vi.fn((_: Parameters<GitCoreShape["createWorktree"]>[0]) =>
        Effect.succeed({
          worktree: {
            branch: "multi/bootstrap-branch",
            path: "/tmp/bootstrap-worktree",
          },
        }),
      );
      const runForThread = vi.fn(
        (_: Parameters<ProjectSetupScriptRunnerShape["runForThread"]>[0]) =>
          Effect.succeed({
            status: "started" as const,
            scriptId: "setup",
            scriptName: "Setup",
            terminalId: "setup-setup",
            cwd: "/tmp/bootstrap-worktree",
          }),
      );
      let setupActivityAppendAttempt = 0;

      yield* buildAppUnderTest({
        layers: {
          gitCore: {
            createWorktree,
          },
          orchestrationEngine: {
            dispatch: (command) => {
              if (
                command.type === "thread.activity.append" &&
                command.activity.kind.startsWith("setup-script.")
              ) {
                setupActivityAppendAttempt += 1;
                if (setupActivityAppendAttempt === 2) {
                  return Effect.fail(
                    new OrchestrationListenerCallbackError({
                      listener: "domain-event",
                      detail: "failed to append setup-script.started activity",
                    }),
                  );
                }
              }

              return Effect.sync(() => {
                dispatchedCommands.push(command);
                return { sequence: dispatchedCommands.length };
              });
            },
            readEvents: () => Stream.empty,
          },
          projectSetupScriptRunner: {
            runForThread,
          },
        },
      });

      const createdAt = new Date().toISOString();
      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
            type: "thread.turn.start",
            commandId: CommandId.make("cmd-bootstrap-turn-start-setup-activity-failure"),
            threadId: ThreadId.make("thread-bootstrap-setup-activity-failure"),
            message: {
              messageId: MessageId.make("msg-bootstrap-setup-activity-failure"),
              role: "user",
              text: "hello",
              attachments: [],
            },
            modelSelection: defaultModelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            bootstrap: {
              createThread: {
                projectId: defaultProjectId,
                title: "Bootstrap Thread",
                modelSelection: defaultModelSelection,
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: "main",
                worktreePath: null,
                createdAt,
              },
              prepareWorktree: {
                projectCwd: "/tmp/project",
                baseBranch: "main",
                branch: "multi/bootstrap-branch",
              },
              runSetupScript: true,
            },
            createdAt,
          }),
        ),
      );

      assert.equal(response.sequence, 4);
      assert.deepEqual(
        dispatchedCommands.map((command) => command.type),
        ["thread.create", "thread.meta.update", "thread.activity.append", "thread.turn.start"],
      );
      const setupActivities = dispatchedCommands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
          command.type === "thread.activity.append",
      );
      assert.deepEqual(
        setupActivities.map((command) => command.activity.kind),
        ["setup-script.requested"],
      );
      assertTrue(
        setupActivities.every((command) => command.activity.kind !== "setup-script.failed"),
      );
      assertTrue(dispatchedCommands.every((command) => command.type !== "thread.delete"));
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("cleans up created bootstrap threads when worktree creation defects", () =>
    Effect.gen(function* () {
      const dispatchedCommands: Array<OrchestrationCommand> = [];
      const createWorktree = vi.fn((_: Parameters<GitCoreShape["createWorktree"]>[0]) =>
        Effect.die(new Error("worktree exploded")),
      );

      yield* buildAppUnderTest({
        layers: {
          gitCore: {
            createWorktree,
          },
          orchestrationEngine: {
            dispatch: (command) =>
              Effect.sync(() => {
                dispatchedCommands.push(command);
                return { sequence: dispatchedCommands.length };
              }),
            readEvents: () => Stream.empty,
          },
        },
      });

      const createdAt = new Date().toISOString();
      const wsUrl = yield* getWsServerUrl("/ws");
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
            type: "thread.turn.start",
            commandId: CommandId.make("cmd-bootstrap-turn-start-defect"),
            threadId: ThreadId.make("thread-bootstrap-defect"),
            message: {
              messageId: MessageId.make("msg-bootstrap-defect"),
              role: "user",
              text: "hello",
              attachments: [],
            },
            modelSelection: defaultModelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            bootstrap: {
              createThread: {
                projectId: defaultProjectId,
                title: "Bootstrap Thread",
                modelSelection: defaultModelSelection,
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: "main",
                worktreePath: null,
                createdAt,
              },
              prepareWorktree: {
                projectCwd: "/tmp/project",
                baseBranch: "main",
                branch: "multi/bootstrap-branch",
              },
              runSetupScript: false,
            },
            createdAt,
          }),
        ).pipe(Effect.result),
      );

      assertTrue(result._tag === "Failure");
      assertTrue(result.failure._tag === "OrchestrationDispatchCommandError");
      assert.include(result.failure.message, "worktree exploded");
      assert.deepEqual(
        dispatchedCommands.map((command) => command.type),
        ["thread.create", "thread.delete"],
      );
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc terminal methods", () =>
    Effect.gen(function* () {
      const snapshot = {
        threadId: "thread-1",
        terminalId: "default",
        cwd: "/tmp/project",
        worktreePath: null,
        status: "running" as const,
        pid: 1234,
        history: "",
        exitCode: null,
        exitSignal: null,
        updatedAt: new Date().toISOString(),
      } as const;

      yield* buildAppUnderTest({
        layers: {
          terminalManager: {
            open: () => Effect.succeed(snapshot),
            write: () => Effect.void,
            resize: () => Effect.void,
            clear: () => Effect.void,
            restart: () => Effect.succeed(snapshot),
            close: () => Effect.void,
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");

      const opened = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.terminalOpen]({
            threadId: "thread-1",
            terminalId: "default",
            cwd: "/tmp/project",
          }),
        ),
      );
      assert.equal(opened.terminalId, "default");

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.terminalWrite]({
            threadId: "thread-1",
            terminalId: "default",
            data: "echo hi\n",
          }),
        ),
      );

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.terminalResize]({
            threadId: "thread-1",
            terminalId: "default",
            cols: 120,
            rows: 40,
          }),
        ),
      );

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.terminalClear]({
            threadId: "thread-1",
            terminalId: "default",
          }),
        ),
      );

      const restarted = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.terminalRestart]({
            threadId: "thread-1",
            terminalId: "default",
            cwd: "/tmp/project",
            cols: 120,
            rows: 40,
          }),
        ),
      );
      assert.equal(restarted.terminalId, "default");

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.terminalClose]({
            threadId: "thread-1",
            terminalId: "default",
          }),
        ),
      );
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("routes websocket rpc terminal.write errors", () =>
    Effect.gen(function* () {
      const terminalError = new TerminalNotRunningError({
        threadId: "thread-1",
        terminalId: "default",
      });
      yield* buildAppUnderTest({
        layers: {
          terminalManager: {
            write: () => Effect.fail(terminalError),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.terminalWrite]({
            threadId: "thread-1",
            terminalId: "default",
            data: "echo fail\n",
          }),
        ).pipe(Effect.result),
      );

      assertFailure(result, terminalError);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );
});
