import { createServer } from "node:net";
import { randomBytes } from "node:crypto";

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
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { Path } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as DesktopEnvironment from "../app/desktop-environment";
import * as EffectLogger from "@honk/shared/effect-logger";
import { writeHonkOpencodeConfig } from "./opencode-config";

// Supervises a plain `opencode serve` process (the "sidecar") for the desktop.
//
// honk speaks to opencode at the sidecar altitude: Electron owns the process
// lifecycle (spawn / health-check / restart-on-crash / kill-on-quit) and the
// renderer talks to the server over HTTP with @opencode-ai/sdk. This mirrors the
// existing desktop Core supervisor (`desktop-core-manager.ts`) but readiness is
// an HTTP health probe against opencode's `/global/health` endpoint instead of a
// discovery file, since opencode has no discovery handshake.

const SIDECAR_HOST = "127.0.0.1";
const INITIAL_RESTART_DELAY = Duration.millis(500);
const MAX_RESTART_DELAY = Duration.seconds(10);
const HEALTH_TIMEOUT = Duration.minutes(1);
const HEALTH_INTERVAL = Duration.millis(150);
const HEALTH_REQUEST_TIMEOUT = Duration.seconds(3);
const TERMINATE_GRACE = Duration.seconds(5);
// Generous: the first-boot warm-up may trigger an on-demand npm plugin install
// inside opencode's cache before it can answer.
const WARMUP_REQUEST_TIMEOUT = Duration.seconds(90);

type SidecarRunRequirements = ChildProcessSpawner.ChildProcessSpawner | Scope.Scope;

export type OpencodeSidecarStatus =
  | "idle"
  | "starting"
  | "ready"
  | "restarting"
  | "stopped"
  | "error";

/** The endpoint snapshot exposed to the renderer through the desktop bridge. */
export interface OpencodeSidecarSnapshot {
  readonly status: OpencodeSidecarStatus;
  /** `http://127.0.0.1:<port>` once a port is reserved, else null. */
  readonly url: string | null;
  /**
   * Server password for HTTP Basic auth (`opencode:<password>`). opencode runs
   * unsecured without it; honk always sets one even on loopback.
   */
  readonly password: string | null;
}

export interface OpencodeSidecarShape {
  readonly start: Effect.Effect<void>;
  readonly stop: (options?: { readonly timeout?: Duration.Duration }) => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<OpencodeSidecarSnapshot>;
}

export class OpencodeSidecar extends Context.Service<OpencodeSidecar, OpencodeSidecarShape>()(
  "honk/desktop/OpencodeSidecar",
) {}

const elog = EffectLogger.create({ service: "desktop-opencode-sidecar" });

class OpencodeSidecarSpawnError extends Data.TaggedError("OpencodeSidecarSpawnError")<{
  readonly cause: PlatformError.PlatformError;
}> {
  override get message() {
    return `Failed to spawn opencode sidecar: ${this.cause.message}`;
  }
}

// Raised when HONK_OPENCODE_PORT names a port that is already taken. The message
// mirrors dev.ts's port-conflict reporting idiom (owner-lookup + free-it hint) so
// the fix is obvious in the log.
class OpencodeSidecarPortConflictError extends Data.TaggedError(
  "OpencodeSidecarPortConflictError",
)<{
  readonly port: number;
  readonly cause: Error;
}> {
  override get message() {
    return [
      `HONK_OPENCODE_PORT ${this.port} is already in use (${this.cause.message}).`,
      `Find the owner: lsof -nP -iTCP:${this.port} -sTCP:LISTEN`,
      `Then free it: kill <pid>`,
    ].join(" ");
  }
}

const MAX_PORT = 65_535;

// Parse an env-provided exact port. Returns undefined for unset/blank/invalid so
// the caller falls back to ephemeral allocation.
function parseOverridePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PORT) return undefined;
  return parsed;
}

interface SidecarSession {
  /** Resolved absolute path (or bare PATH name) of the opencode binary. */
  readonly binaryPath: string;
  readonly port: number;
  readonly password: string;
  readonly url: string;
  readonly configPath: string;
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
}

interface ActiveRun {
  readonly id: number;
  readonly scope: Scope.Closeable;
  readonly fiber: Option.Option<Fiber.Fiber<void>>;
  readonly pid: Option.Option<number>;
}

interface SidecarState {
  readonly desiredRunning: boolean;
  readonly status: OpencodeSidecarStatus;
  readonly session: Option.Option<SidecarSession>;
  readonly active: Option.Option<ActiveRun>;
  readonly restartAttempt: number;
  readonly restartFiber: Option.Option<Fiber.Fiber<void>>;
  readonly nextRunId: number;
}

const initialState: SidecarState = {
  desiredRunning: false,
  status: "idle",
  session: Option.none(),
  active: Option.none(),
  restartAttempt: 0,
  restartFiber: Option.none(),
  nextRunId: 1,
};

const calculateRestartDelay = (attempt: number): Duration.Duration =>
  Duration.min(Duration.times(INITIAL_RESTART_DELAY, 2 ** attempt), MAX_RESTART_DELAY);

// Reserve a free loopback port by binding an ephemeral listener and releasing it.
// The tiny race window before the sidecar rebinds is acceptable on loopback and
// matches how the desktop reserves its Core port.
function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, SIDECAR_HOST, () => {
      const address = server.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(selected);
      });
    });
  });
}

// Verify an exact port is free on the sidecar host by binding it briefly. Rejects
// (e.g. EADDRINUSE) when taken so the caller can surface a clear conflict error.
// Only the sidecar host matters here: the server binds `--hostname 127.0.0.1`.
function reserveExactPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) =>
      reject(error instanceof Error ? error : new Error(String(error))),
    );
    server.listen(port, SIDECAR_HOST, () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
}

// Ordered opencode binary candidates. `HONK_OPENCODE_BIN` wins for local dev and
// tests; packaged builds resolve a bundled binary under resources; dev falls back
// to the pnpm-installed shim, then to `opencode` on PATH.
function opencodeBinaryCandidates(
  environment: DesktopEnvironment.DesktopEnvironmentShape,
): string[] {
  const path = environment.path;
  const binName = environment.platform === "win32" ? "opencode.exe" : "opencode";
  const override = process.env.HONK_OPENCODE_BIN?.trim();
  const candidates: string[] = [];
  if (override) candidates.push(override);
  if (environment.isPackaged) {
    candidates.push(path.join(environment.resourcesPath, "opencode", "bin", binName));
    candidates.push(path.join(environment.resourcesPath, "bin", binName));
  }
  candidates.push(path.join(environment.rootDir, "node_modules", ".bin", binName));
  return candidates;
}

const resolveOpencodeBinary = Effect.fn("desktop.opencodeSidecar.resolveBinary")(function* (
  environment: DesktopEnvironment.DesktopEnvironmentShape,
): Effect.fn.Return<string, never, FileSystem.FileSystem> {
  const fileSystem = yield* FileSystem.FileSystem;
  for (const candidate of opencodeBinaryCandidates(environment)) {
    const exists = yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false));
    if (exists) return candidate;
  }
  // Last resort: rely on PATH resolution. If opencode is not installed the spawn
  // fails, surfacing an error status and a restart backoff.
  return environment.platform === "win32" ? "opencode.exe" : "opencode";
});

// Probe opencode's health endpoint with HTTP Basic auth, matching opencode's own
// desktop sidecar health check (`/global/health`).
const checkHealth = (url: string, password: string): Effect.Effect<boolean> =>
  Effect.tryPromise({
    try: async () => {
      const auth = Buffer.from(`opencode:${password}`).toString("base64");
      const response = await fetch(new URL("/global/health", url), {
        method: "GET",
        headers: { authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(Duration.toMillis(HEALTH_REQUEST_TIMEOUT)),
      });
      return response.ok;
    },
    catch: () => false,
  }).pipe(Effect.orElseSucceed(() => false));

const waitForHealthy = (session: SidecarSession): Effect.Effect<void, string> =>
  checkHealth(session.url, session.password).pipe(
    Effect.flatMap((healthy) =>
      healthy ? Effect.void : Effect.fail("opencode sidecar not healthy yet"),
    ),
    Effect.retry(Schedule.spaced(HEALTH_INTERVAL)),
    Effect.timeout(HEALTH_TIMEOUT),
    Effect.mapError(() => "opencode sidecar failed health check within timeout"),
  );

// Force opencode to resolve the configured plugins BEFORE the sidecar reports
// ready, so provider auth methods and honk's own plugin are available when the
// renderer first asks for them.
//
// opencode does NOT load plugins at serve boot: the server creates a project
// instance per request keyed by the `directory` param / `x-opencode-directory`
// header (see opencode `cli/cmd/serve.ts`), and plugins load with that instance.
// npm plugins are installed on demand into opencode's own cache
// (`Npm.add` -> `<xdgCache>/opencode/packages/<pkg>@<version>`, flock-guarded and
// idempotent, using opencode's bundled installer — no external npm). Left alone,
// that install would run on the user's first prompt and could stall or fail
// offline. Instead honk issues the first instance request itself — listing agents
// for the backend directory — which triggers plugin resolution/install up front.
// Failure is non-fatal: opencode still resolves lazily on the first prompt, and
// `/global/health` already passed so the server is usable.
const warmUpPlugins = (session: SidecarSession): Effect.Effect<void> =>
  Effect.tryPromise({
    try: async () => {
      const auth = Buffer.from(`opencode:${session.password}`).toString("base64");
      const url = new URL("/agent", session.url);
      url.searchParams.set("directory", session.cwd);
      const response = await fetch(url, {
        method: "GET",
        headers: { authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(Duration.toMillis(WARMUP_REQUEST_TIMEOUT)),
      });
      if (!response.ok) throw new Error(`agent list returned HTTP ${response.status}`);
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(
    Effect.tap(() => elog.info("opencode plugins warmed up", { url: session.url })),
    Effect.tapError((error) =>
      elog.warn("opencode plugin warm-up failed; plugins will resolve on first prompt", {
        error: error.message,
      }),
    ),
    Effect.ignore,
  );

interface SidecarProcessExit {
  readonly reason: string;
}

function describeExit(
  result: Result.Result<ChildProcessSpawner.ExitCode, PlatformError.PlatformError>,
): SidecarProcessExit {
  return Result.isSuccess(result)
    ? { reason: `code=${result.success}` }
    : { reason: result.failure.message };
}

interface RunProcessOptions {
  readonly session: SidecarSession;
  readonly onStarted: (pid: number) => Effect.Effect<void>;
  readonly onReady: Effect.Effect<void>;
  readonly onReadinessFailure: (message: string) => Effect.Effect<void>;
}

const runOpencodeProcess = Effect.fn("desktop.opencodeSidecar.runProcess")(function* (
  options: RunProcessOptions,
): Effect.fn.Return<SidecarProcessExit, OpencodeSidecarSpawnError, SidecarRunRequirements> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { session } = options;
  const command = ChildProcess.make(
    session.binaryPath,
    ["serve", "--hostname", SIDECAR_HOST, "--port", String(session.port)],
    {
      cwd: session.cwd,
      env: session.env,
      extendEnv: true,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      killSignal: "SIGTERM",
      forceKillAfter: TERMINATE_GRACE,
    },
  );

  const handle = yield* spawner
    .spawn(command)
    .pipe(Effect.mapError((cause) => new OpencodeSidecarSpawnError({ cause })));

  yield* options.onStarted(handle.pid);
  yield* waitForHealthy(session).pipe(
    Effect.matchEffect({
      onFailure: (message) => options.onReadinessFailure(message),
      // Preinstall plugins before declaring ready so the first prompt never waits
      // on an on-demand plugin install.
      onSuccess: () => warmUpPlugins(session).pipe(Effect.andThen(options.onReady)),
    }),
    Effect.forkScoped,
  );

  return describeExit(yield* Effect.result(handle.exitCode));
});

const closeRun = (
  run: ActiveRun,
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

const makeOpencodeSidecar = Effect.fn("desktop.opencodeSidecar.make")(function* () {
  const parentScope = yield* Scope.Scope;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const state = yield* Ref.make(initialState);
  const mutex = yield* Semaphore.make(1);

  const snapshot = Ref.get(state).pipe(
    Effect.map(
      (current): OpencodeSidecarSnapshot => ({
        status: current.status,
        url: Option.match(current.session, {
          onNone: () => null,
          onSome: (session) => session.url,
        }),
        password: Option.match(current.session, {
          onNone: () => null,
          onSome: (session) => session.password,
        }),
      }),
    ),
  );

  // Resolve the run session once (stable port + password + generated config) and
  // cache it so restarts keep the same URL the renderer already read.
  const resolveSession = Effect.fn("desktop.opencodeSidecar.resolveSession")(function* () {
    const existing = yield* Ref.get(state).pipe(Effect.map((current) => current.session));
    if (Option.isSome(existing)) return existing.value;

    const location = yield* writeHonkOpencodeConfig({ stateDir: environment.stateDir }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
    const binaryPath = yield* resolveOpencodeBinary(environment).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
    );
    // Dev drives a deterministic sidecar (scripts/dev.ts) via these overrides so
    // it can point app-next's Vite at a known origin. Absent overrides, keep the
    // production behavior: ephemeral port + generated password.
    const portOverride = parseOverridePort(process.env.HONK_OPENCODE_PORT);
    const port =
      portOverride === undefined
        ? yield* Effect.promise(() => reserveLoopbackPort())
        : yield* Effect.tryPromise({
            try: () => reserveExactPort(portOverride),
            catch: (cause) =>
              new OpencodeSidecarPortConflictError({
                port: portOverride,
                cause: cause instanceof Error ? cause : new Error(String(cause)),
              }),
          }).pipe(Effect.as(portOverride));
    const passwordOverride = process.env.HONK_OPENCODE_PASSWORD?.trim();
    const password =
      passwordOverride && passwordOverride.length > 0
        ? passwordOverride
        : randomBytes(24).toString("hex");
    const session: SidecarSession = {
      binaryPath,
      port,
      password,
      url: `http://${SIDECAR_HOST}:${port}`,
      configPath: location.configPath,
      cwd: environment.backendCwd,
      env: {
        // Merge the honk-managed config on top of the user's own opencode config
        // rather than replacing it (nearest-wins). Never point at the user's dir.
        OPENCODE_CONFIG: location.configPath,
        OPENCODE_SERVER_PASSWORD: password,
        OPENCODE_CLIENT: "honk-desktop",
        NO_PROXY: mergeLoopbackNoProxy(process.env.NO_PROXY),
        no_proxy: mergeLoopbackNoProxy(process.env.no_proxy),
      },
    };
    yield* Ref.update(state, (current) => ({ ...current, session: Option.some(session) }));
    return session;
  });

  const cancelRestart = Effect.gen(function* () {
    const restartFiber = yield* Ref.modify(state, (current) => [
      current.restartFiber,
      { ...current, restartFiber: Option.none<Fiber.Fiber<void>>() },
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
        if (Option.isSome(current.active)) return;

        const sessionOption = yield* resolveSession().pipe(
          Effect.tapError((error) =>
            elog.error("failed to prepare opencode sidecar session", {
              error: error.message,
            }),
          ),
          Effect.option,
        );
        if (Option.isNone(sessionOption)) {
          yield* Ref.update(state, (latest) => ({
            ...latest,
            status: "error" as OpencodeSidecarStatus,
          }));
          yield* scheduleRestart("failed to prepare sidecar session");
          return;
        }
        const session = sessionOption.value;

        yield* cancelRestart;
        yield* Ref.update(state, (latest) => ({
          ...latest,
          desiredRunning: true,
          status: "starting" as OpencodeSidecarStatus,
        }));

        const runScope = yield* Scope.make("sequential");
        const runId = yield* Ref.modify(state, (latest) => [
          latest.nextRunId,
          {
            ...latest,
            active: Option.some<ActiveRun>({
              id: latest.nextRunId,
              scope: runScope,
              fiber: Option.none(),
              pid: Option.none(),
            }),
            nextRunId: latest.nextRunId + 1,
          },
        ]);

        const finalizeRun = Effect.fn("desktop.opencodeSidecar.finalizeRun")(function* (
          reason: string,
        ) {
          yield* mutex.withPermits(1)(
            Effect.gen(function* () {
              const isCurrentRun = yield* Ref.modify(state, (latest) => {
                const activeRun = Option.getOrUndefined(latest.active);
                if (activeRun?.id !== runId) return [false, latest] as const;
                return [
                  true,
                  {
                    ...latest,
                    active: Option.none<ActiveRun>(),
                    status: latest.desiredRunning
                      ? ("restarting" as OpencodeSidecarStatus)
                      : ("stopped" as OpencodeSidecarStatus),
                  },
                ] as const;
              });
              if (isCurrentRun) {
                yield* elog.info("opencode sidecar process ended", { reason });
                const shouldRestart = yield* Ref.get(state).pipe(
                  Effect.map((latest) => latest.desiredRunning),
                );
                if (shouldRestart) yield* scheduleRestart(reason);
              }
            }),
          );
        });

        const program = runOpencodeProcess({
          session,
          onStarted: (pid) =>
            Effect.gen(function* () {
              yield* Ref.update(state, (latest) => ({
                ...latest,
                active: Option.map(latest.active, (run) =>
                  run.id === runId ? { ...run, pid: Option.some(pid) } : run,
                ),
              }));
              yield* elog.info("opencode sidecar spawned", {
                pid,
                url: session.url,
                binary: session.binaryPath,
              });
            }),
          onReady: Effect.gen(function* () {
            const isCurrentRun = yield* Ref.modify(state, (latest) => {
              const activeRun = Option.getOrUndefined(latest.active);
              if (activeRun?.id !== runId) return [false, latest] as const;
              return [true, { ...latest, status: "ready" as const, restartAttempt: 0 }] as const;
            });
            if (isCurrentRun) yield* elog.info("opencode sidecar is healthy", { url: session.url });
          }),
          onReadinessFailure: (message) =>
            elog.warn("opencode sidecar health check failed", { message }),
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
        yield* Ref.update(state, (latest) => ({
          ...latest,
          active: Option.map(latest.active, (run) =>
            run.id === runId ? { ...run, fiber: Option.some(fiber) } : run,
          ),
        }));
      }),
    ),
  ).pipe(Effect.withSpan("desktop.opencodeSidecar.start"));

  const scheduleRestart = Effect.fn("desktop.opencodeSidecar.scheduleRestart")(function* (
    reason: string,
  ) {
    const delay = yield* Ref.modify(state, (latest) => {
      if (!latest.desiredRunning || Option.isSome(latest.restartFiber)) {
        return [Option.none<Duration.Duration>(), latest] as const;
      }
      return [
        Option.some(calculateRestartDelay(latest.restartAttempt)),
        { ...latest, restartAttempt: latest.restartAttempt + 1 },
      ] as const;
    });

    yield* Option.match(delay, {
      onNone: () => Effect.void,
      onSome: (duration) =>
        Effect.gen(function* () {
          yield* elog.error("opencode sidecar exited; restart scheduled", {
            reason,
            delayMs: Duration.toMillis(duration),
          });
          const restartFiber = yield* Effect.forkIn(
            Effect.sleep(duration).pipe(
              Effect.andThen(
                Ref.modify(state, (latest) => [
                  latest.desiredRunning,
                  { ...latest, restartFiber: Option.none<Fiber.Fiber<void>>() },
                ]),
              ),
              Effect.flatMap((shouldRestart) => (shouldRestart ? start : Effect.void)),
              Effect.catchCause((cause) =>
                elog.error("opencode sidecar restart fiber failed", { cause: Cause.pretty(cause) }),
              ),
            ),
            parentScope,
          );
          yield* Ref.update(state, (latest) =>
            Option.isNone(latest.restartFiber)
              ? { ...latest, restartFiber: Option.some(restartFiber) }
              : latest,
          );
        }),
    });
  });

  const stop = Effect.fn("desktop.opencodeSidecar.stop")(function* (options?: {
    readonly timeout?: Duration.Duration;
  }) {
    const { active, restartFiber } = yield* mutex.withPermits(1)(
      Ref.modify(state, (latest) => [
        { active: latest.active, restartFiber: latest.restartFiber },
        {
          ...latest,
          desiredRunning: false,
          status: "stopped" as OpencodeSidecarStatus,
          active: Option.none<ActiveRun>(),
          restartFiber: Option.none<Fiber.Fiber<void>>(),
        },
      ]),
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

  return OpencodeSidecar.of({ start, stop, snapshot });
});

// Ensure loopback hosts are in NO_PROXY so health checks and SDK calls to the
// sidecar never route through a corporate proxy.
function mergeLoopbackNoProxy(existing: string | undefined): string {
  const loopback = ["127.0.0.1", "localhost", "::1"];
  const items = (existing ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  for (const host of loopback) {
    if (!items.some((value) => value.toLowerCase() === host)) items.push(host);
  }
  return items.join(",");
}

export const layer = Layer.effect(OpencodeSidecar, makeOpencodeSidecar());
