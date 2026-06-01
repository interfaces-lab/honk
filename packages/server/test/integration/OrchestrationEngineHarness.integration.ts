import { execFileSync } from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ApprovalRequestId,
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestrationEvent,
  type OrchestrationThread,
} from "@multi/contracts";
import {
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  PubSub,
  Schedule,
  Schema,
  Scope,
  Stream,
} from "effect";

import { GitCore, type GitCoreShape } from "../../src/git/GitCore.service.ts";
import { GitStatusBroadcaster } from "../../src/git/GitStatusBroadcaster.service.ts";
import { TextGeneration, type TextGenerationShape } from "../../src/git/TextGeneration.service.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../src/persistence/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../src/persistence/OrchestrationEventStore.ts";
import { ProjectionPendingApprovalRepositoryLive } from "../../src/persistence/ProjectionPendingApprovals.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../../src/persistence/ProviderSessionRuntime.ts";
import { makeSqlitePersistenceLive } from "../../src/persistence/Sqlite.ts";
import { ProjectionPendingApprovalRepository } from "../../src/persistence/ProjectionPendingApprovals.service.ts";
import { ProviderUnsupportedError } from "../../src/provider/Errors.ts";
import { ProviderAdapterRegistry } from "../../src/provider/ProviderAdapterRegistry.service.ts";
import { ProviderSessionDirectoryLive } from "../../src/provider/ProviderSessionDirectory.ts";
import { ServerSettingsService } from "../../src/server-settings.ts";
import { makeProviderServiceLive } from "../../src/provider/ProviderService.ts";
import { makeCodexAdapterLive } from "../../src/provider/CodexAdapter.ts";
import { CodexAdapter } from "../../src/provider/CodexAdapter.service.ts";
import { ProviderService } from "../../src/provider/ProviderService.service.ts";
import { AnalyticsService } from "../../src/telemetry/AnalyticsService.service.ts";
import { RepositoryIdentityResolverLive } from "../../src/project/RepositoryIdentityResolver.ts";
import { OrchestrationEngineLive } from "../../src/orchestration/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../../src/orchestration/ProjectionPipeline.ts";
import { ThreadProjectionLive } from "../../src/orchestration/ThreadProjection.ts";
import { OrchestrationReactorLive } from "../../src/orchestration/OrchestrationReactor.ts";
import { ProviderCommandReactorLive } from "../../src/orchestration/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionLive } from "../../src/orchestration/ProviderRuntimeIngestion.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../src/orchestration/OrchestrationEngine.service.ts";
import { OrchestrationReactor } from "../../src/orchestration/OrchestrationReactor.service.ts";
import { ThreadProjection } from "../../src/orchestration/ThreadProjection.service.ts";

import {
  makeTestProviderAdapterHarness,
  type TestProviderAdapterHarness,
} from "./TestProviderAdapter.integration.ts";
import { deriveServerPaths, ServerConfig } from "../../src/config.ts";
import { ServerRuntime } from "../../src/server-runtime.ts";

function runGit(cwd: string, args: ReadonlyArray<string>) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

const initializeGitProject = Effect.fn(function* (cwd: string) {
  runGit(cwd, ["init", "--initial-branch=main"]);
  runGit(cwd, ["config", "user.email", "test@example.com"]);
  runGit(cwd, ["config", "user.name", "Test User"]);
  const fileSystem = yield* FileSystem.FileSystem;
  const { join } = yield* Path.Path;
  yield* fileSystem.writeFileString(join(cwd, "README.md"), "v1\n");
  runGit(cwd, ["add", "."]);
  runGit(cwd, ["commit", "-m", "Initial"]);
});

export function gitRefExists(cwd: string, ref: string): boolean {
  try {
    runGit(cwd, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

export function gitShowFileAtRef(cwd: string, ref: string, filePath: string): string {
  return runGit(cwd, ["show", `${ref}:${filePath}`]);
}

class WaitForTimeoutError extends Schema.TaggedErrorClass<WaitForTimeoutError>()(
  "WaitForTimeoutError",
  {
    description: Schema.String,
  },
) {}

function waitFor<A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => boolean,
  description: string,
  timeoutMs?: number,
): Effect.Effect<A, never>;
function waitFor<A, B extends A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => value is B,
  description: string,
  timeoutMs?: number,
): Effect.Effect<B, never>;
function waitFor<A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => boolean,
  description: string,
  timeoutMs = 40_000,
): Effect.Effect<A, never> {
  const RETRY_SIGNAL = "wait_for_retry";
  const retryIntervalMs = 10;
  const maxRetries = Math.max(0, Math.floor(timeoutMs / retryIntervalMs));
  const retrySchedule = Schedule.spaced(`${retryIntervalMs} millis`);

  return read.pipe(
    Effect.filterOrFail(predicate, () => RETRY_SIGNAL),
    Effect.retry({
      schedule: retrySchedule,
      times: maxRetries,
      while: (error) => error === RETRY_SIGNAL,
    }),
    Effect.mapError((error) =>
      error === RETRY_SIGNAL ? new WaitForTimeoutError({ description }) : error,
    ),
    Effect.orDie,
  );
}

class OrchestrationHarnessRuntimeError extends Schema.TaggedErrorClass<OrchestrationHarnessRuntimeError>()(
  "OrchestrationHarnessRuntimeError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

const tryRuntimePromise = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new OrchestrationHarnessRuntimeError({ operation, cause }),
  });

const makeStaticRegistryLayer = (input: {
  readonly instanceId: string;
  readonly provider: ProviderDriverKind;
  readonly adapter: TestProviderAdapterHarness["adapter"];
}) =>
  Layer.effect(
    ProviderAdapterRegistry,
    Effect.gen(function* () {
      const changesPubSub = yield* PubSub.unbounded<void>();
      return {
        getByInstance: (instanceId) =>
          instanceId === input.instanceId
            ? Effect.succeed(input.adapter)
            : Effect.fail(new ProviderUnsupportedError({ provider: instanceId })),
        getInstanceInfo: (instanceId) =>
          instanceId === input.instanceId
            ? Effect.succeed({
                instanceId,
                driverKind: input.provider,
                enabled: true,
              })
            : Effect.fail(new ProviderUnsupportedError({ provider: instanceId })),
        listInstances: () => Effect.succeed([ProviderInstanceId.make(input.instanceId)]),
        streamChanges: Stream.fromPubSub(changesPubSub),
        subscribeChanges: PubSub.subscribe(changesPubSub),
      } as const;
    }),
  );

export interface OrchestrationIntegrationHarness {
  readonly rootDir: string;
  readonly projectDir: string;
  readonly dbPath: string;
  readonly adapterHarness: TestProviderAdapterHarness | null;
  readonly engine: OrchestrationEngineShape;
  readonly threadProjection: ThreadProjection["Service"];
  readonly providerService: ProviderService["Service"];
  readonly pendingApprovalRepository: ProjectionPendingApprovalRepository["Service"];
  readonly waitForThread: (
    threadId: string,
    predicate: (thread: OrchestrationThread) => boolean,
    timeoutMs?: number,
  ) => Effect.Effect<OrchestrationThread, never>;
  readonly waitForDomainEvent: (
    predicate: (event: OrchestrationEvent) => boolean,
    timeoutMs?: number,
  ) => Effect.Effect<ReadonlyArray<OrchestrationEvent>, never>;
  readonly waitForPendingApproval: (
    requestId: string,
    predicate: (row: {
      readonly status: "pending" | "resolved";
      readonly decision: "accept" | "acceptForSession" | "decline" | "cancel" | null;
      readonly resolvedAt: string | null;
    }) => boolean,
    timeoutMs?: number,
  ) => Effect.Effect<
    {
      readonly status: "pending" | "resolved";
      readonly decision: "accept" | "acceptForSession" | "decline" | "cancel" | null;
      readonly resolvedAt: string | null;
    },
    never
  >;
  readonly dispose: Effect.Effect<void, never>;
}

interface MakeOrchestrationIntegrationHarnessOptions {
  readonly provider?: ProviderDriverKind;
  readonly realCodex?: boolean;
}

export const makeOrchestrationIntegrationHarness = (
  options?: MakeOrchestrationIntegrationHarnessOptions,
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fileSystem = yield* FileSystem.FileSystem;

    const provider = options?.provider ?? "codex";
    const useRealCodex = options?.realCodex === true;
    const adapterHarness = useRealCodex
      ? null
      : yield* makeTestProviderAdapterHarness({
          provider,
        });
    const fakeRegistry = adapterHarness
      ? makeStaticRegistryLayer({
          instanceId: adapterHarness.provider,
          provider: adapterHarness.provider,
          adapter: adapterHarness.adapter,
        })
      : null;
    const rootDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-orchestration-integration-",
    });
    const projectDir = path.join(rootDir, "project");
    const { stateDir, dbPath } = yield* deriveServerPaths(rootDir, undefined).pipe(
      Effect.provideService(Path.Path, path),
    );
    yield* fileSystem.makeDirectory(projectDir, { recursive: true });
    yield* fileSystem.makeDirectory(stateDir, { recursive: true });
    yield* initializeGitProject(projectDir);

    const persistenceLayer = makeSqlitePersistenceLive(dbPath);
    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    );
    const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
      Layer.provide(ProviderSessionRuntimeRepositoryLive),
    );
    const realCodexRegistry = Layer.effect(
      ProviderAdapterRegistry,
      Effect.gen(function* () {
        const codexAdapter = yield* CodexAdapter;
        const changesPubSub = yield* PubSub.unbounded<void>();
        return {
          getByInstance: (instanceId) =>
            instanceId === "codex"
              ? Effect.succeed(codexAdapter)
              : Effect.fail(new ProviderUnsupportedError({ provider: instanceId })),
          getInstanceInfo: (instanceId) =>
            instanceId === "codex"
              ? Effect.succeed({
                  instanceId,
                  driverKind: "codex",
                  enabled: true,
                })
              : Effect.fail(new ProviderUnsupportedError({ provider: instanceId })),
          listInstances: () => Effect.succeed([ProviderInstanceId.make("codex")]),
          streamChanges: Stream.fromPubSub(changesPubSub),
          subscribeChanges: PubSub.subscribe(changesPubSub),
        } as const;
      }),
    ).pipe(
      Layer.provide(makeCodexAdapterLive()),
      Layer.provideMerge(ServerConfig.layerTest(projectDir, rootDir)),
      Layer.provideMerge(NodeServices.layer),
      Layer.provideMerge(providerSessionDirectoryLayer),
    );
    const providerLayer = useRealCodex
      ? makeProviderServiceLive().pipe(
          Layer.provide(providerSessionDirectoryLayer),
          Layer.provide(realCodexRegistry),
          Layer.provide(AnalyticsService.layerTest),
        )
      : makeProviderServiceLive().pipe(
          Layer.provide(providerSessionDirectoryLayer),
          Layer.provide(fakeRegistry!),
          Layer.provide(AnalyticsService.layerTest),
        );

    const threadProjectionLayer = ThreadProjectionLive;
    const runtimeServicesLayer = Layer.mergeAll(
      threadProjectionLayer,
      orchestrationLayer.pipe(Layer.provide(threadProjectionLayer)),
      ProjectionPendingApprovalRepositoryLive,
      providerLayer,
    );
    const serverSettingsLayer = ServerSettingsService.layerTest();
    const runtimeIngestionLayer = ProviderRuntimeIngestionLive.pipe(
      Layer.provideMerge(runtimeServicesLayer),
      Layer.provideMerge(serverSettingsLayer),
    );
    const gitCoreLayer = Layer.succeed(GitCore, {
      renameBranch: (input: Parameters<GitCoreShape["renameBranch"]>[0]) =>
        Effect.succeed({ branch: input.newBranch }),
    } as unknown as GitCoreShape);
    const textGenerationLayer = Layer.succeed(TextGeneration, {
      generateBranchName: () => Effect.succeed({ branch: "update" }),
      generateThreadTitle: () => Effect.succeed({ title: "New thread" }),
    } as unknown as TextGenerationShape);
    const gitStatusBroadcasterLayer = Layer.succeed(GitStatusBroadcaster, {
      getStatus: () => Effect.die("getStatus should not be called in this test"),
      refreshLocalStatus: () =>
        Effect.succeed({
          isRepo: true,
          hasOriginRemote: false,
          isDefaultBranch: true,
          branch: "main",
          hasWorkingTreeChanges: false,
          workingTree: { files: [], insertions: 0, deletions: 0 },
        }),
      refreshStatus: () => Effect.die("refreshStatus should not be called in this test"),
      streamStatus: () => Stream.empty,
    });
    const providerCommandReactorLayer = ProviderCommandReactorLive.pipe(
      Layer.provideMerge(runtimeServicesLayer),
      Layer.provideMerge(gitCoreLayer),
      Layer.provideMerge(gitStatusBroadcasterLayer),
      Layer.provideMerge(textGenerationLayer),
      Layer.provideMerge(serverSettingsLayer),
    );
    const orchestrationReactorLayer = OrchestrationReactorLive.pipe(
      Layer.provideMerge(runtimeIngestionLayer),
      Layer.provideMerge(providerCommandReactorLayer),
    );
    const layer = Layer.empty.pipe(
      Layer.provideMerge(runtimeServicesLayer),
      Layer.provideMerge(orchestrationReactorLayer),
      Layer.provide(persistenceLayer),
      Layer.provideMerge(RepositoryIdentityResolverLive),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(ServerConfig.layerTest(projectDir, rootDir)),
      Layer.provideMerge(NodeServices.layer),
    );

    const runtime = ServerRuntime.make(layer);
    const engine = yield* tryRuntimePromise("load OrchestrationEngine service", () =>
      runtime.runPromise(Effect.service(OrchestrationEngineService)),
    ).pipe(Effect.orDie);
    const reactor = yield* tryRuntimePromise("load OrchestrationReactor service", () =>
      runtime.runPromise(Effect.service(OrchestrationReactor)),
    ).pipe(Effect.orDie);
    const threadProjection = yield* tryRuntimePromise("load ThreadProjection service", () =>
      runtime.runPromise(Effect.service(ThreadProjection)),
    ).pipe(Effect.orDie);
    const providerService = yield* tryRuntimePromise("load ProviderService service", () =>
      runtime.runPromise(Effect.service(ProviderService)),
    ).pipe(Effect.orDie);
    const pendingApprovalRepository = yield* tryRuntimePromise(
      "load ProjectionPendingApprovalRepository service",
      () => runtime.runPromise(Effect.service(ProjectionPendingApprovalRepository)),
    ).pipe(Effect.orDie);

    const scope = yield* Scope.make("sequential");
    yield* tryRuntimePromise("start OrchestrationReactor", () =>
      runtime.runPromise(reactor.start().pipe(Scope.provide(scope))),
    ).pipe(Effect.orDie);
    yield* Effect.sleep(10);

    const waitForThread: OrchestrationIntegrationHarness["waitForThread"] = (
      threadId,
      predicate,
      timeoutMs,
    ) =>
      waitFor(
        threadProjection
          .getSnapshot()
          .pipe(
            Effect.map(
              (snapshot) => snapshot.threads.find((thread) => thread.id === threadId) ?? null,
            ),
          ),
        (thread): thread is OrchestrationThread => thread !== null && predicate(thread),
        `projected thread '${threadId}'`,
        timeoutMs,
      ) as Effect.Effect<OrchestrationThread, never>;

    const waitForDomainEvent: OrchestrationIntegrationHarness["waitForDomainEvent"] = (
      predicate,
      timeoutMs,
    ) =>
      waitFor(
        Stream.runCollect(engine.readEvents(0)).pipe(
          Effect.map((chunk): ReadonlyArray<OrchestrationEvent> => Array.from(chunk)),
        ),
        (events) => events.some(predicate),
        "domain event",
        timeoutMs,
      );

    const waitForPendingApproval: OrchestrationIntegrationHarness["waitForPendingApproval"] = (
      requestId,
      predicate,
      timeoutMs,
    ) =>
      waitFor(
        pendingApprovalRepository
          .getByRequestId({ requestId: ApprovalRequestId.make(requestId) })
          .pipe(
            Effect.map((row) =>
              Option.match(row, {
                onNone: () => null,
                onSome: (value) => ({
                  status: value.status,
                  decision: value.decision,
                  resolvedAt: value.resolvedAt,
                }),
              }),
            ),
          ),
        (
          row,
        ): row is {
          readonly status: "pending" | "resolved";
          readonly decision: "accept" | "acceptForSession" | "decline" | "cancel" | null;
          readonly resolvedAt: string | null;
        } => row !== null && predicate(row),
        `pending approval '${requestId}'`,
        timeoutMs,
      ) as Effect.Effect<
        {
          readonly status: "pending" | "resolved";
          readonly decision: "accept" | "acceptForSession" | "decline" | "cancel" | null;
          readonly resolvedAt: string | null;
        },
        never
      >;

    let disposed = false;
    const dispose = Effect.gen(function* () {
      if (disposed) {
        return;
      }
      disposed = true;

      const shutdown = Effect.gen(function* () {
        const closeScopeExit = yield* Effect.exit(Scope.close(scope, Exit.void));
        const disposeRuntimeExit = yield* Effect.exit(Effect.promise(() => runtime.dispose()));

        const failureCause = Exit.isFailure(closeScopeExit)
          ? closeScopeExit.cause
          : Exit.isFailure(disposeRuntimeExit)
            ? disposeRuntimeExit.cause
            : null;

        if (failureCause) {
          return yield* Effect.failCause(failureCause);
        }
      });

      yield* shutdown;
    });

    return {
      rootDir,
      projectDir,
      dbPath,
      adapterHarness,
      engine,
      threadProjection,
      providerService,
      pendingApprovalRepository,
      waitForThread,
      waitForDomainEvent,
      waitForPendingApproval,
      dispose,
    } satisfies OrchestrationIntegrationHarness;
  });
