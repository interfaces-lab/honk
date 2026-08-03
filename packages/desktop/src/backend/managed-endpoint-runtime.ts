import {
  ManagedCloudflaredConfigurationError,
  startManagedCloudflaredConnector,
  type ManagedCloudflaredConnector,
} from "@honk/cli/host";
import {
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Ref,
  Result,
  Schedule,
  Schema,
  Scope,
} from "effect";

const INITIAL_RESTART_DELAY_MS = 500;
const MAX_RESTART_DELAY_MS = 30_000;
const HEALTHY_WINDOW_MS = 30_000;
const CLOSE_DEADLINE_MS = 5_000;

export type Status =
  | "starting"
  | "connected"
  | "backoff"
  | "invalid_enrollment"
  | "failed"
  | "disabled";

export interface Snapshot {
  readonly status: Status;
  readonly configurationKey: string | null;
  readonly restartAttempt: number;
}

export interface ConnectorStartInput {
  readonly executable: string;
  readonly configPath: string;
  readonly tunnelId: string;
  readonly redactValues?: readonly string[];
  readonly readyTimeoutMs?: number;
  readonly closeGraceMs?: number;
  readonly platform?: NodeJS.Platform;
}

export type DesiredState =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      /**
       * A nonsecret fingerprint of the allocation generation and opaque secret
       * reference. Secret bytes must never be part of this value. Reconcile
       * compares only this key, so callers must change it when startInput changes.
       */
      readonly configurationKey: string;
      readonly startInput: ConnectorStartInput;
    };

export class ConnectorConfigurationError extends Schema.TaggedErrorClass<ConnectorConfigurationError>()(
  "ManagedEndpointRuntime.ConnectorConfigurationError",
  {},
) {}

// Credential-aware factories emit this typed signal. The supervisor never
// guesses enrollment validity from cloudflared output.
export class ConnectorInvalidEnrollmentError extends Schema.TaggedErrorClass<ConnectorInvalidEnrollmentError>()(
  "ManagedEndpointRuntime.ConnectorInvalidEnrollmentError",
  {},
) {}

export class ConnectorTransientError extends Schema.TaggedErrorClass<ConnectorTransientError>()(
  "ManagedEndpointRuntime.ConnectorTransientError",
  {},
) {}

export type ConnectorError =
  | ConnectorConfigurationError
  | ConnectorInvalidEnrollmentError
  | ConnectorTransientError;

export interface OwnedConnector {
  readonly ready: Effect.Effect<void, ConnectorError>;
  readonly exited: Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}

export interface ConnectorFactoryShape {
  /**
   * Transfers process ownership immediately after spawn. Readiness belongs on
   * the returned handle so cancellation can still close a starting process.
   */
  readonly open: (input: ConnectorStartInput) => Effect.Effect<OwnedConnector, ConnectorError>;
}

export class ConnectorFactory extends Context.Service<ConnectorFactory, ConnectorFactoryShape>()(
  "honk/desktop/ManagedEndpointConnectorFactory",
) {}

export type TimerPurpose = "backoff" | "healthy";

export interface TimingShape {
  readonly sleep: (milliseconds: number, purpose: TimerPurpose) => Effect.Effect<void>;
  readonly jitter: (milliseconds: number, attempt: number) => Effect.Effect<number>;
  readonly closeWithinDeadline: (close: Effect.Effect<void>) => Effect.Effect<void>;
}

export class Timing extends Context.Service<Timing, TimingShape>()(
  "honk/desktop/ManagedEndpointRuntimeTiming",
) {}

export interface ConnectivityShape {
  readonly isOnline: Effect.Effect<boolean>;
  readonly waitUntilOnline: Effect.Effect<void>;
}

export class Connectivity extends Context.Service<Connectivity, ConnectivityShape>()(
  "honk/desktop/ManagedEndpointRuntimeConnectivity",
) {}

export interface Shape {
  readonly reconcile: (desired: DesiredState) => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<Snapshot>;
}

export class ManagedEndpointRuntime extends Context.Service<ManagedEndpointRuntime, Shape>()(
  "honk/desktop/ManagedEndpointRuntime",
) {}

interface DesiredRecord {
  readonly revision: number;
  readonly shutdown: boolean;
  readonly value: DesiredState;
}

interface ActiveConnector {
  readonly handle: OwnedConnector;
  readonly scope: Scope.Closeable;
  readonly phase: "starting" | "connected";
  readonly healthy: boolean;
}

interface WorkerState {
  readonly revision: number;
  readonly configurationKey: string | null;
  readonly connector: ActiveConnector | null;
  readonly restartAttempt: number;
  readonly terminal: boolean;
}

class RuntimeShutdown extends Schema.TaggedErrorClass<RuntimeShutdown>()(
  "ManagedEndpointRuntime.Shutdown",
  {},
) {}

const initialSnapshot = makeSnapshot("disabled", null, 0);

const initialWorkerState: WorkerState = {
  revision: 0,
  configurationKey: null,
  connector: null,
  restartAttempt: 0,
  terminal: false,
};

const make = Effect.fn("desktop.managedEndpointRuntime.make")(function* () {
  const connectorFactory = yield* ConnectorFactory;
  const timing = yield* Timing;
  const connectivity = yield* Connectivity;
  const desiredRef = yield* Ref.make<DesiredRecord>({
    revision: 0,
    shutdown: false,
    value: { enabled: false },
  });
  const workerRef = yield* Ref.make(initialWorkerState);
  const snapshotRef = yield* Ref.make(initialSnapshot);
  const revisions = yield* Queue.sliding<void>(1);
  const workerScope = yield* Scope.make("sequential");
  const ownedConnectorRef = yield* Ref.make<ActiveConnector | null>(null);
  yield* Effect.addFinalizer((exit) => Scope.close(workerScope, exit));

  const publish = (status: Status, configurationKey: string | null, restartAttempt: number) =>
    Ref.set(snapshotRef, makeSnapshot(status, configurationKey, restartAttempt));

  const closeConnector = Effect.fnUntraced(function* (connector: ActiveConnector) {
    yield* Scope.close(connector.scope, Exit.void);
    yield* Ref.update(ownedConnectorRef, (current) => (current === connector ? null : current));
  });

  const ownConnector = Effect.fnUntraced(function* (
    connector: OwnedConnector,
  ): Effect.fn.Return<ActiveConnector> {
    const scope = yield* Scope.make("sequential");
    yield* Scope.addFinalizer(scope, timing.closeWithinDeadline(connector.close));
    const owned = {
      handle: connector,
      scope,
      phase: "starting" as const,
      healthy: false,
    };
    yield* Ref.set(ownedConnectorRef, owned);
    return owned;
  });

  const releaseOwnedConnector = Ref.get(ownedConnectorRef).pipe(
    Effect.flatMap((connector) => (connector === null ? Effect.void : closeConnector(connector))),
  );
  yield* Scope.addFinalizer(workerScope, releaseOwnedConnector);

  const awaitRevision = Effect.fnUntraced(function* (
    currentRevision: number,
  ): Effect.fn.Return<number> {
    const desired = yield* Ref.get(desiredRef);
    if (desired.revision > currentRevision) return desired.revision;
    yield* Queue.take(revisions);
    return yield* awaitRevision(currentRevision);
  });

  const waitForBackoff = Effect.fnUntraced(function* (
    desired: Extract<DesiredState, { readonly enabled: true }>,
    revision: number,
    attempt: number,
  ) {
    const baseDelay = Math.min(
      INITIAL_RESTART_DELAY_MS * 2 ** Math.min(attempt, 30),
      MAX_RESTART_DELAY_MS,
    );
    const jitteredDelay = yield* timing.jitter(baseDelay, attempt);
    const delay =
      Number.isFinite(jitteredDelay) && jitteredDelay >= 0
        ? Math.min(Math.round(jitteredDelay), MAX_RESTART_DELAY_MS)
        : baseDelay;

    yield* Ref.update(workerRef, (current) =>
      current.revision === revision
        ? {
            ...current,
            connector: null,
            restartAttempt: attempt + 1,
          }
        : current,
    );
    yield* publish("backoff", desired.configurationKey, attempt + 1);
    yield* Effect.raceFirst(
      connectivity.waitUntilOnline.pipe(Effect.andThen(timing.sleep(delay, "backoff"))),
      awaitRevision(revision).pipe(Effect.asVoid),
    );
  });

  const handleConnectorError = Effect.fnUntraced(function* (
    error: ConnectorError,
    desired: Extract<DesiredState, { readonly enabled: true }>,
    revision: number,
    attempt: number,
  ) {
    if (error._tag === "ManagedEndpointRuntime.ConnectorConfigurationError") {
      yield* Ref.update(workerRef, (current) =>
        current.revision === revision ? { ...current, connector: null, terminal: true } : current,
      );
      yield* publish("failed", desired.configurationKey, attempt);
      return;
    }

    if (error._tag === "ManagedEndpointRuntime.ConnectorInvalidEnrollmentError") {
      yield* Ref.update(workerRef, (current) =>
        current.revision === revision ? { ...current, connector: null, terminal: true } : current,
      );
      yield* publish("invalid_enrollment", desired.configurationKey, attempt);
      return;
    }

    yield* waitForBackoff(desired, revision, attempt);
  });

  const runPass = Effect.fnUntraced(function* () {
    const desiredRecord = yield* Ref.get(desiredRef);
    const worker = yield* Ref.get(workerRef);

    if (desiredRecord.shutdown) {
      if (worker.connector !== null) yield* closeConnector(worker.connector);
      yield* Ref.set(workerRef, {
        ...initialWorkerState,
        revision: desiredRecord.revision,
      });
      yield* publish("disabled", null, 0);
      return yield* new RuntimeShutdown({});
    }

    if (!desiredRecord.value.enabled) {
      if (worker.connector !== null) yield* closeConnector(worker.connector);
      yield* Ref.set(workerRef, {
        ...initialWorkerState,
        revision: desiredRecord.revision,
      });
      yield* publish("disabled", null, 0);
      yield* awaitRevision(desiredRecord.revision);
      return;
    }

    const desired = desiredRecord.value;
    if (desired.configurationKey.trim().length === 0) {
      if (worker.connector !== null) yield* closeConnector(worker.connector);
      yield* Ref.set(workerRef, {
        revision: desiredRecord.revision,
        configurationKey: desired.configurationKey,
        connector: null,
        restartAttempt: 0,
        terminal: true,
      });
      yield* publish("failed", desired.configurationKey, 0);
      yield* awaitRevision(desiredRecord.revision);
      return;
    }

    if (
      worker.revision !== desiredRecord.revision ||
      worker.configurationKey !== desired.configurationKey
    ) {
      if (worker.connector !== null) yield* closeConnector(worker.connector);
      yield* Ref.set(workerRef, {
        revision: desiredRecord.revision,
        configurationKey: desired.configurationKey,
        connector: null,
        restartAttempt: 0,
        terminal: false,
      });
      yield* publish("starting", desired.configurationKey, 0);
      return;
    }

    if (worker.terminal) {
      yield* awaitRevision(desiredRecord.revision);
      return;
    }

    if (worker.connector === null) {
      const isOnline = yield* connectivity.isOnline;
      if (!isOnline) {
        yield* publish("backoff", desired.configurationKey, worker.restartAttempt);
        yield* Effect.raceFirst(
          connectivity.waitUntilOnline,
          awaitRevision(desiredRecord.revision).pipe(Effect.asVoid),
        );
        return;
      }

      yield* publish("starting", desired.configurationKey, worker.restartAttempt);
      const opened = yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const result = yield* Effect.result(restore(connectorFactory.open(desired.startInput)));
          if (Result.isFailure(result)) return Result.fail(result.failure);
          return Result.succeed(yield* ownConnector(result.success));
        }),
      );
      const latestDesired = yield* Ref.get(desiredRef);
      if (latestDesired.shutdown || latestDesired.revision !== desiredRecord.revision) {
        if (Result.isSuccess(opened)) yield* closeConnector(opened.success);
        return;
      }
      if (Result.isFailure(opened)) {
        yield* handleConnectorError(
          opened.failure,
          desired,
          desiredRecord.revision,
          worker.restartAttempt,
        );
        return;
      }

      yield* Ref.update(workerRef, (current) =>
        current.revision === desiredRecord.revision
          ? {
              ...current,
              connector: opened.success,
            }
          : current,
      );
      return;
    }

    if (worker.connector.phase === "starting") {
      const activeConnector = worker.connector;
      const connector = activeConnector.handle;
      const readiness = yield* Effect.raceFirst(
        Effect.result(connector.ready).pipe(
          Effect.map((result) => ({ type: "ready" as const, result })),
        ),
        awaitRevision(desiredRecord.revision).pipe(
          Effect.map(() => ({ type: "desired_changed" as const })),
        ),
      );
      const latestDesired = yield* Ref.get(desiredRef);
      const latestWorker = yield* Ref.get(workerRef);
      const isCurrent =
        !latestDesired.shutdown &&
        latestDesired.revision === desiredRecord.revision &&
        latestWorker.connector?.handle === connector;

      if (readiness.type === "desired_changed" || !isCurrent) {
        yield* closeConnector(activeConnector);
        yield* Ref.update(workerRef, (current) =>
          current.connector?.handle === connector ? { ...current, connector: null } : current,
        );
        return;
      }

      if (Result.isFailure(readiness.result)) {
        yield* closeConnector(activeConnector);
        yield* Ref.update(workerRef, (current) =>
          current.connector?.handle === connector ? { ...current, connector: null } : current,
        );
        yield* handleConnectorError(
          readiness.result.failure,
          desired,
          desiredRecord.revision,
          worker.restartAttempt,
        );
        return;
      }

      yield* Ref.update(workerRef, (current) =>
        current.connector?.handle === connector
          ? {
              ...current,
              connector: {
                ...current.connector,
                phase: "connected" as const,
                healthy: false,
              },
            }
          : current,
      );
      yield* publish("connected", desired.configurationKey, worker.restartAttempt);
      return;
    }

    const activeConnector = worker.connector;
    const connector = activeConnector.handle;
    const event = yield* Effect.raceAllFirst([
      connector.exited.pipe(Effect.as({ type: "exited" as const })),
      awaitRevision(desiredRecord.revision).pipe(Effect.as({ type: "desired_changed" as const })),
      ...(worker.connector.healthy
        ? []
        : [
            timing
              .sleep(HEALTHY_WINDOW_MS, "healthy")
              .pipe(Effect.as({ type: "healthy" as const })),
          ]),
    ]);
    const latestDesired = yield* Ref.get(desiredRef);
    const latestWorker = yield* Ref.get(workerRef);
    const isCurrent =
      !latestDesired.shutdown &&
      latestDesired.revision === desiredRecord.revision &&
      latestWorker.connector?.handle === connector;

    if (event.type === "desired_changed" || !isCurrent) {
      yield* closeConnector(activeConnector);
      yield* Ref.update(workerRef, (current) =>
        current.connector?.handle === connector ? { ...current, connector: null } : current,
      );
      return;
    }

    if (event.type === "healthy") {
      yield* Ref.update(workerRef, (current) =>
        current.connector?.handle === connector
          ? {
              ...current,
              restartAttempt: 0,
              connector: { ...current.connector, healthy: true },
            }
          : current,
      );
      yield* publish("connected", desired.configurationKey, 0);
      return;
    }

    yield* closeConnector(activeConnector);
    yield* Ref.update(workerRef, (current) =>
      current.connector?.handle === connector ? { ...current, connector: null } : current,
    );
    yield* waitForBackoff(desired, desiredRecord.revision, worker.restartAttempt);
  });

  const worker = runPass().pipe(
    Effect.repeat(Schedule.forever),
    Effect.catchTag("ManagedEndpointRuntime.Shutdown", () => Effect.void),
    Effect.ensuring(releaseOwnedConnector),
  );
  const workerFiber = yield* Effect.forkIn(worker, workerScope);

  const reconcile = Effect.fn("desktop.managedEndpointRuntime.reconcile")((desired: DesiredState) =>
    Effect.gen(function* () {
      const changed = yield* Ref.modify(desiredRef, (current) => {
        if (sameDesiredState(current.value, desired)) return [false, current] as const;
        return [
          true,
          {
            revision: current.revision + 1,
            shutdown: current.shutdown,
            value: desired,
          },
        ] as const;
      });
      if (changed) yield* Queue.offer(revisions, undefined);
    }).pipe(Effect.uninterruptible),
  );

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const revision = yield* Ref.modify(desiredRef, (current) => {
        const nextRevision = current.revision + 1;
        return [
          nextRevision,
          {
            revision: nextRevision,
            shutdown: true,
            value: { enabled: false } as const,
          },
        ] as const;
      });
      yield* Queue.offer(revisions, undefined);
      yield* Fiber.await(workerFiber);
      const finalWorker = yield* Ref.get(workerRef);
      if (finalWorker.connector !== null) yield* closeConnector(finalWorker.connector);
      yield* Ref.set(workerRef, {
        ...initialWorkerState,
        revision,
      });
      yield* publish("disabled", null, 0);
    }).pipe(Effect.uninterruptible),
  );

  return ManagedEndpointRuntime.of({
    reconcile,
    snapshot: Ref.get(snapshotRef),
  });
});

export const layer = Layer.effect(ManagedEndpointRuntime, make());

export const connectorFactoryLayer = Layer.succeed(
  ConnectorFactory,
  ConnectorFactory.of({
    open: Effect.fn("desktop.managedEndpointConnectorFactory.open")(function* (
      input: ConnectorStartInput,
    ) {
      const connector = yield* Effect.try({
        try: () => startManagedCloudflaredConnector(input),
        catch: classifyConnectorError,
      });
      return ownedCloudflaredConnector(connector);
    }),
  }),
);

export const timingLayer = Layer.succeed(
  Timing,
  Timing.of({
    sleep: (milliseconds) => Effect.sleep(Duration.millis(milliseconds)),
    jitter: (milliseconds) => Effect.sync(() => milliseconds * (0.8 + Math.random() * 0.4)),
    closeWithinDeadline: (close) =>
      close.pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(CLOSE_DEADLINE_MS),
          orElse: () => Effect.void,
        }),
      ),
  }),
);

export const connectivityLayer = Layer.succeed(
  Connectivity,
  Connectivity.of({
    isOnline: Effect.succeed(true),
    waitUntilOnline: Effect.void,
  }),
);

export const defaultLayer = layer.pipe(
  Layer.provide(Layer.merge(Layer.merge(connectorFactoryLayer, timingLayer), connectivityLayer)),
);

function makeSnapshot(
  status: Status,
  configurationKey: string | null,
  restartAttempt: number,
): Snapshot {
  return Object.freeze({ status, configurationKey, restartAttempt });
}

function sameDesiredState(left: DesiredState, right: DesiredState): boolean {
  if (!left.enabled || !right.enabled) return left.enabled === right.enabled;
  return left.configurationKey === right.configurationKey;
}

function classifyConnectorError(cause: unknown): ConnectorError {
  if (cause instanceof ManagedCloudflaredConfigurationError) {
    return new ConnectorConfigurationError({});
  }
  return new ConnectorTransientError({});
}

function ownedCloudflaredConnector(connector: ManagedCloudflaredConnector): OwnedConnector {
  return {
    ready: Effect.tryPromise({
      try: () => connector.ready,
      catch: classifyConnectorError,
    }),
    exited: Effect.tryPromise({
      try: () => connector.exited,
      catch: () => undefined,
    }).pipe(Effect.asVoid, Effect.ignore),
    close: Effect.tryPromise({
      try: () => connector.close(),
      catch: () => undefined,
    }).pipe(Effect.asVoid, Effect.ignore),
  };
}
