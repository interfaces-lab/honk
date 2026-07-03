import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { type CoreDiscovery, probeCore, resolveCoreHome } from "@honk/core";

import * as DesktopEnvironment from "../app/desktop-environment";
import * as EffectLogger from "@honk/shared/effect-logger";

const INITIAL_RESTART_DELAY = Duration.millis(500);
const MAX_RESTART_DELAY = Duration.seconds(10);
const DEFAULT_CORE_READINESS_TIMEOUT = Duration.minutes(1);
const DEFAULT_CORE_READINESS_INTERVAL = Duration.millis(100);
const DEFAULT_CORE_PROBE_TIMEOUT = Duration.seconds(1);
const DEFAULT_CORE_TERMINATE_GRACE = Duration.seconds(2);

type CoreProcessRunRequirements = ChildProcessSpawner.ChildProcessSpawner | Scope.Scope;

export interface DesktopCoreStartConfig {
  readonly executablePath: string;
  readonly entryPath: string;
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly home: string;
  readonly discoveryPath: string;
}

interface CoreProcessExit {
  readonly code: Option.Option<number>;
  readonly reason: string;
  readonly result: Result.Result<ChildProcessSpawner.ExitCode, PlatformError.PlatformError>;
}

export class CoreTimeoutError extends Data.TaggedError("CoreTimeoutError")<{
  readonly discoveryPath: string;
}> {
  override get message() {
    return `Timed out waiting for Core discovery at ${this.discoveryPath}.`;
  }
}

class CoreDiscoveryProbeError extends Data.TaggedError("CoreDiscoveryProbeError")<{
  readonly discoveryPath: string;
  readonly cause: unknown;
}> {
  override get message() {
    const message = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Failed to probe Core discovery at ${this.discoveryPath}: ${message}`;
  }
}

class CoreProcessSpawnError extends Data.TaggedError("CoreProcessSpawnError")<{
  readonly cause: PlatformError.PlatformError;
}> {
  override get message() {
    return `Failed to spawn desktop Core process: ${this.cause.message}`;
  }
}

interface RunCoreProcessOptions extends DesktopCoreStartConfig {
  readonly readinessTimeout?: Duration.Duration;
  readonly onStarted?: (pid: number) => Effect.Effect<void>;
  readonly onReady?: (discovery: CoreDiscovery) => Effect.Effect<void>;
  readonly onReadinessFailure?: (error: CoreTimeoutError) => Effect.Effect<void>;
}

export interface DesktopCoreSnapshot {
  readonly desiredRunning: boolean;
  readonly ready: boolean;
  readonly activePid: Option.Option<number>;
  readonly restartAttempt: number;
  readonly restartScheduled: boolean;
  readonly discoveredOrigin: Option.Option<string>;
}

export interface DesktopCoreManagerShape {
  readonly start: Effect.Effect<void>;
  readonly stop: (options?: { readonly timeout?: Duration.Duration }) => Effect.Effect<void>;
  readonly currentConfig: Effect.Effect<Option.Option<DesktopCoreStartConfig>>;
  readonly snapshot: Effect.Effect<DesktopCoreSnapshot>;
}

export class DesktopCoreManager extends Context.Service<
  DesktopCoreManager,
  DesktopCoreManagerShape
>()("honk/desktop/CoreManager") {}

const elog = EffectLogger.create({ service: "desktop-core-manager" });

interface ActiveCoreRun {
  readonly id: number;
  readonly scope: Scope.Closeable;
  readonly fiber: Option.Option<Fiber.Fiber<void>>;
  readonly pid: Option.Option<number>;
}

interface CoreManagerState {
  readonly desiredRunning: boolean;
  readonly ready: boolean;
  readonly config: Option.Option<DesktopCoreStartConfig>;
  readonly active: Option.Option<ActiveCoreRun>;
  readonly discovered: Option.Option<CoreDiscovery>;
  readonly restartAttempt: number;
  readonly restartFiber: Option.Option<Fiber.Fiber<void>>;
  readonly nextRunId: number;
}

const initialState: CoreManagerState = {
  desiredRunning: false,
  ready: false,
  config: Option.none(),
  active: Option.none(),
  discovered: Option.none(),
  restartAttempt: 0,
  restartFiber: Option.none(),
  nextRunId: 1,
};

const activePid = (active: Option.Option<ActiveCoreRun>): Option.Option<number> =>
  Option.flatMap(active, (run) => run.pid);

const discoveredOrigin = (discovered: Option.Option<CoreDiscovery>): Option.Option<string> =>
  Option.map(discovered, (discovery) => discovery.origin);

const withActiveRun =
  (runId: number, f: (run: ActiveCoreRun) => ActiveCoreRun) =>
  (state: CoreManagerState): CoreManagerState => ({
    ...state,
    active: Option.map(state.active, (run) => (run.id === runId ? f(run) : run)),
  });

const calculateRestartDelay = (attempt: number): Duration.Duration =>
  Duration.min(Duration.times(INITIAL_RESTART_DELAY, 2 ** attempt), MAX_RESTART_DELAY);

const closeRun = (
  run: ActiveCoreRun,
  options?: { readonly timeout?: Duration.Duration },
): Effect.Effect<void> => {
  const close = Option.match(run.fiber, {
    onNone: () => Scope.close(run.scope, Exit.void),
    onSome: (fiber) => Fiber.interrupt(fiber).pipe(Effect.asVoid),
  });

  return (
    options?.timeout ? close.pipe(Effect.timeoutOption(options.timeout), Effect.asVoid) : close
  ).pipe(Effect.ignore);
};

const probeCoreDiscovery = Effect.fn("desktop.coreManager.probeCoreDiscovery")(function* (
  discoveryPath: string,
  timeout: Duration.Duration,
) {
  return yield* Effect.tryPromise({
    try: () => probeCore(discoveryPath, Duration.toMillis(timeout)),
    catch: (cause) => new CoreDiscoveryProbeError({ discoveryPath, cause }),
  });
});

const waitForCoreReady = Effect.fn("desktop.coreManager.waitForCoreReady")(function* (
  discoveryPath: string,
  timeout: Duration.Duration,
) {
  return yield* probeCoreDiscovery(discoveryPath, DEFAULT_CORE_PROBE_TIMEOUT).pipe(
    Effect.flatMap((discovery) =>
      Option.match(discovery, {
        onNone: () => Effect.fail("Core discovery is not ready"),
        onSome: (state) => Effect.succeed(state),
      }),
    ),
    Effect.retry(Schedule.spaced(DEFAULT_CORE_READINESS_INTERVAL)),
    Effect.timeout(timeout),
    Effect.mapError(() => new CoreTimeoutError({ discoveryPath })),
  );
});

function describeProcessExit(
  result: Result.Result<ChildProcessSpawner.ExitCode, PlatformError.PlatformError>,
): CoreProcessExit {
  if (Result.isSuccess(result)) {
    return {
      code: Option.some(result.success),
      reason: `code=${result.success}`,
      result,
    };
  }

  return {
    code: Option.none(),
    reason: result.failure.message,
    result,
  };
}

const runCoreProcess = Effect.fn("runCoreProcess")(function* (
  options: RunCoreProcessOptions,
): Effect.fn.Return<CoreProcessExit, CoreProcessSpawnError, CoreProcessRunRequirements> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = ChildProcess.make(
    options.executablePath,
    [options.entryPath, "serve", "--home", options.home],
    {
      cwd: options.cwd,
      env: options.env,
      extendEnv: true,
      // In Electron main, process.execPath points to the Electron binary.
      // Run the child in Node mode so this Core process does not become a GUI app instance.
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      killSignal: "SIGTERM",
      forceKillAfter: DEFAULT_CORE_TERMINATE_GRACE,
    },
  );

  const handle = yield* spawner
    .spawn(command)
    .pipe(Effect.mapError((cause) => new CoreProcessSpawnError({ cause })));

  yield* options.onStarted?.(handle.pid) ?? Effect.void;
  yield* waitForCoreReady(
    options.discoveryPath,
    options.readinessTimeout ?? DEFAULT_CORE_READINESS_TIMEOUT,
  ).pipe(
    Effect.tap((discovery) => options.onReady?.(discovery) ?? Effect.void),
    Effect.catch((error) => options.onReadinessFailure?.(error) ?? Effect.void),
    Effect.forkScoped,
  );

  return describeProcessExit(yield* Effect.result(handle.exitCode));
});

const resolveDesktopCoreStartConfig = Effect.fn("desktop.coreManager.resolveStartConfig")(
  function* (): Effect.fn.Return<
    DesktopCoreStartConfig,
    never,
    DesktopEnvironment.DesktopEnvironment
  > {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const coreHome = resolveCoreHome(environment.baseDir);

    return {
      executablePath: process.execPath,
      entryPath: environment.coreEntryPath,
      cwd: environment.backendCwd,
      env: {
        ELECTRON_RUN_AS_NODE: "1",
      },
      home: coreHome.root,
      discoveryPath: coreHome.discoveryPath,
    };
  },
);

const makeDesktopCoreManager = Effect.fn("makeDesktopCoreManager")(function* () {
  const parentScope = yield* Scope.Scope;
  const fileSystem = yield* FileSystem.FileSystem;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const state = yield* Ref.make(initialState);
  const mutex = yield* Semaphore.make(1);

  const updateActiveRun = (runId: number, f: (run: ActiveCoreRun) => ActiveCoreRun) =>
    Ref.update(state, withActiveRun(runId, f));

  const snapshot = Ref.get(state).pipe(
    Effect.map(
      (current): DesktopCoreSnapshot => ({
        desiredRunning: current.desiredRunning,
        ready: current.ready,
        activePid: activePid(current.active),
        restartAttempt: current.restartAttempt,
        restartScheduled: Option.isSome(current.restartFiber),
        discoveredOrigin: discoveredOrigin(current.discovered),
      }),
    ),
  );
  const currentConfig = Ref.get(state).pipe(Effect.map((current) => current.config));

  const cancelRestart = Effect.gen(function* () {
    const restartFiber = yield* Ref.modify(state, (current): readonly [
      Option.Option<Fiber.Fiber<void>>,
      CoreManagerState,
    ] => [
      current.restartFiber,
      {
        ...current,
        restartFiber: Option.none(),
      },
    ]);

    yield* Option.match(restartFiber, {
      onNone: () => Effect.void,
      onSome: (fiber) => Fiber.interrupt(fiber).pipe(Effect.asVoid),
    });
  });

  const start: Effect.Effect<void> = Effect.suspend(() =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        if (Option.isSome(current.active)) {
          return;
        }

        const config = yield* resolveDesktopCoreStartConfig().pipe(
          Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
        );
        yield* cancelRestart;
        yield* Ref.update(state, (latest) => ({
          ...latest,
          desiredRunning: true,
          ready: false,
          config: Option.some(config),
          discovered: Option.none(),
        }));

        const existing = yield* probeCoreDiscovery(
          config.discoveryPath,
          DEFAULT_CORE_PROBE_TIMEOUT,
        ).pipe(
          Effect.catch((error) =>
            elog.warn("Core discovery probe failed before spawn", {
              error: error.message,
            }).pipe(Effect.as(Option.none<CoreDiscovery>())),
          ),
        );
        if (Option.isSome(existing)) {
          yield* Ref.update(state, (latest) => ({
            ...latest,
            ready: true,
            restartAttempt: 0,
            discovered: existing,
          }));
          yield* elog.info("Core already live; desktop will not spawn or own it", {
            origin: existing.value.origin,
            pid: existing.value.pid,
          });
          return;
        }

        const entryExists = yield* fileSystem
          .exists(config.entryPath)
          .pipe(Effect.orElseSucceed(() => false));
        if (!entryExists) {
          yield* scheduleRestart(`missing Core entry at ${config.entryPath}`);
          return;
        }

        const runScope = yield* Scope.make("sequential");
        const runId = yield* Ref.modify(state, (latest): readonly [number, CoreManagerState] => [
          latest.nextRunId,
          {
            ...latest,
            active: Option.some({
              id: latest.nextRunId,
              scope: runScope,
              fiber: Option.none(),
              pid: Option.none(),
            } satisfies ActiveCoreRun),
            nextRunId: latest.nextRunId + 1,
          },
        ]);

        const finalizeRun = Effect.fn("desktop.coreManager.finalizeRun")(function* (
          reason: string,
        ) {
          yield* mutex.withPermits(1)(
            Effect.gen(function* () {
              const { isCurrentRun, nextState, pid } = yield* Ref.modify(
                state,
                (
                  latest,
                ): readonly [
                  {
                    readonly isCurrentRun: boolean;
                    readonly nextState: CoreManagerState;
                    readonly pid: Option.Option<number>;
                  },
                  CoreManagerState,
                ] => {
                  const currentRun = Option.getOrUndefined(latest.active);
                  if (currentRun?.id !== runId) {
                    return [
                      {
                        isCurrentRun: false,
                        nextState: latest,
                        pid: Option.none<number>(),
                      },
                      latest,
                    ];
                  }

                  const next: CoreManagerState = {
                    ...latest,
                    active: Option.none(),
                    ready: false,
                    discovered: Option.none(),
                  };
                  return [
                    {
                      isCurrentRun: true,
                      nextState: next,
                      pid: currentRun.pid,
                    },
                    next,
                  ];
                },
              );

              if (isCurrentRun && Option.isSome(pid)) {
                yield* elog.info("Core process ended", {
                  pid: pid.value,
                  reason,
                });
              }

              if (isCurrentRun && nextState.desiredRunning) {
                yield* scheduleRestart(reason);
              }
            }),
          );
        });

        const program = runCoreProcess({
          ...config,
          onStarted: Effect.fn("desktop.coreManager.onStarted")(function* (pid) {
            yield* updateActiveRun(runId, (run) => ({
              ...run,
              pid: Option.some(pid),
            }));
            yield* elog.info("Core process spawned", {
              pid,
              home: config.home,
              entryPath: config.entryPath,
            });
          }),
          onReady: Effect.fn("desktop.coreManager.onReady")(function* (discovery) {
            const isCurrentRun = yield* Ref.modify(state, (latest): readonly [
              boolean,
              CoreManagerState,
            ] => {
              const activeRun = Option.getOrUndefined(latest.active);
              if (activeRun?.id !== runId) {
                return [false, latest];
              }

              return [
                true,
                {
                  ...latest,
                  restartAttempt: 0,
                  ready: true,
                  discovered: Option.some(discovery),
                },
              ];
            });
            if (!isCurrentRun) {
              return;
            }

            yield* elog.info("Core discovery is ready", {
              origin: discovery.origin,
              pid: discovery.pid,
            });
          }),
          onReadinessFailure: (error) =>
            elog.warn("Core readiness check failed during bootstrap", {
              error: error.message,
            }),
        }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Scope.provide(runScope),
          Effect.matchEffect({
            onFailure: (error) => finalizeRun(error.message),
            onSuccess: (exit) => finalizeRun(exit.reason),
          }),
          Effect.ensuring(Scope.close(runScope, Exit.void).pipe(Effect.ignore)),
        );

        const fiber = yield* Effect.forkIn(program, parentScope);
        yield* updateActiveRun(runId, (run) => ({
          ...run,
          fiber: Option.some(fiber),
        }));
      }),
    ),
  ).pipe(Effect.withSpan("desktop.coreManager.start"));

  const scheduleRestart = Effect.fn("desktop.coreManager.scheduleRestart")(function* (
    reason: string,
  ) {
    const scheduled = yield* Ref.modify(state, (latest): readonly [
      Option.Option<Duration.Duration>,
      CoreManagerState,
    ] => {
      if (!latest.desiredRunning || Option.isSome(latest.restartFiber)) {
        return [Option.none<Duration.Duration>(), latest];
      }

      const delay = calculateRestartDelay(latest.restartAttempt);
      return [
        Option.some(delay),
        {
          ...latest,
          restartAttempt: latest.restartAttempt + 1,
        },
      ];
    });

    yield* Option.match(scheduled, {
      onNone: () => Effect.void,
      onSome: Effect.fn("desktop.coreManager.scheduleRestartFiber")(function* (delay) {
        yield* elog.error("Core exited unexpectedly; restart scheduled", {
          reason,
          delayMs: Duration.toMillis(delay),
        });
        const restartFiber = yield* Effect.forkIn(
          Effect.sleep(delay).pipe(
            Effect.andThen(
              Ref.modify(state, (latest): readonly [boolean, CoreManagerState] => {
                const shouldRestart = latest.desiredRunning;
                return [
                  shouldRestart,
                  {
                    ...latest,
                    restartFiber: Option.none(),
                  },
                ];
              }),
            ),
            Effect.flatMap((shouldRestart) => (shouldRestart ? start : Effect.void)),
            Effect.catchCause((cause) =>
              elog.error("desktop Core restart fiber failed", {
                cause: Cause.pretty(cause),
              }),
            ),
          ),
          parentScope,
        );
        yield* Ref.update(state, (latest) =>
          Option.isNone(latest.restartFiber)
            ? {
                ...latest,
                restartFiber: Option.some(restartFiber),
              }
            : latest,
        );
      }),
    });
  });

  const stop = Effect.fn("desktop.coreManager.stop")(function* (options?: {
    readonly timeout?: Duration.Duration;
  }) {
    const { active, restartFiber } = yield* mutex.withPermits(1)(
      Effect.gen(function* () {
        const result = yield* Ref.modify(
          state,
          (latest): readonly [
            {
              readonly active: Option.Option<ActiveCoreRun>;
              readonly restartFiber: Option.Option<Fiber.Fiber<void>>;
            },
            CoreManagerState,
          ] => [
            {
              active: latest.active,
              restartFiber: latest.restartFiber,
            },
            {
              ...latest,
              desiredRunning: false,
              ready: false,
              active: Option.none(),
              discovered: Option.none(),
              restartFiber: Option.none(),
            },
          ],
        );
        return result;
      }),
    );

    yield* Option.match(restartFiber, {
      onNone: () => Effect.void,
      onSome: (fiber) => Fiber.interrupt(fiber).pipe(Effect.asVoid),
    });
    yield* Option.match(active, {
      onNone: () => Effect.void,
      onSome: (run) => closeRun(run, options),
    });
  });

  yield* Effect.addFinalizer(() => stop());

  return DesktopCoreManager.of({
    start,
    stop,
    currentConfig,
    snapshot,
  });
});

export const layer = Layer.effect(DesktopCoreManager, makeDesktopCoreManager());
