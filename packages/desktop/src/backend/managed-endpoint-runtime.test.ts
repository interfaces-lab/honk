import { Deferred, Effect, Layer, Option, Queue, Ref, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  Connectivity,
  ConnectorConfigurationError,
  ConnectorFactory,
  ConnectorInvalidEnrollmentError,
  ConnectorTransientError,
  ManagedEndpointRuntime,
  Timing,
  connectorFactoryLayer,
  layer,
  type ConnectorError,
  type ConnectorStartInput,
  type DesiredState,
  type OwnedConnector,
  type Shape,
  type Snapshot,
  type TimerPurpose,
} from "./managed-endpoint-runtime";

interface SleepRequest {
  readonly milliseconds: number;
  readonly purpose: TimerPurpose;
  readonly resume: Deferred.Deferred<void>;
}

interface CloseDeadlineRequest {
  readonly resume: Deferred.Deferred<void>;
}

interface FakeConnector {
  readonly handle: OwnedConnector;
  readonly ready: Effect.Effect<boolean>;
  readonly failReady: (error: ConnectorError) => Effect.Effect<boolean>;
  readonly exit: Effect.Effect<boolean>;
  readonly closeCount: Effect.Effect<number>;
}

const activeDesired = (
  configurationKey: string,
  tunnelId = "6ff42ae1-765d-4adf-8112-92a242b8f28f",
): Extract<DesiredState, { readonly enabled: true }> => ({
  enabled: true,
  configurationKey,
  startInput: {
    executable: "/managed/cloudflared",
    configPath: "/managed/cloudflared.yml",
    tunnelId,
    redactValues: ["must-not-leak"],
  },
});

const makeFakeConnector = (input?: { readonly closeNeverCompletes?: boolean }) =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make<void, ConnectorError>();
    const exited = yield* Deferred.make<void>();
    const closed = yield* Ref.make(false);
    const closeCount = yield* Ref.make(0);
    const close = Ref.modify(closed, (alreadyClosed) => [!alreadyClosed, true] as const).pipe(
      Effect.flatMap((firstClose) =>
        firstClose
          ? Ref.update(closeCount, (count) => count + 1).pipe(
              Effect.andThen(input?.closeNeverCompletes === true ? Effect.never : Effect.void),
            )
          : Effect.void,
      ),
    );

    return {
      handle: {
        ready: Deferred.await(ready),
        exited: Deferred.await(exited),
        close,
      },
      ready: Deferred.succeed(ready, undefined),
      failReady: (error: ConnectorError) => Deferred.fail(ready, error),
      exit: Deferred.succeed(exited, undefined),
      closeCount: Ref.get(closeCount),
    } satisfies FakeConnector;
  });

const makeHarness = Effect.gen(function* () {
  const plans = yield* Queue.unbounded<Effect.Effect<OwnedConnector, ConnectorError>>();
  const opens = yield* Queue.unbounded<ConnectorStartInput>();
  const sleeps = yield* Queue.unbounded<SleepRequest>();
  const closeDeadlines = yield* Queue.unbounded<CloseDeadlineRequest>();
  const onlineRef = yield* Ref.make(true);
  const onlineChanges = yield* Queue.sliding<boolean>(1);
  const waitUntilOnline: Effect.Effect<void> = Effect.suspend(() =>
    Ref.get(onlineRef).pipe(
      Effect.flatMap((online) =>
        online ? Effect.void : Queue.take(onlineChanges).pipe(Effect.andThen(waitUntilOnline)),
      ),
    ),
  );

  const dependencies = Layer.merge(
    Layer.merge(
      Layer.succeed(
        ConnectorFactory,
        ConnectorFactory.of({
          open: Effect.fn("test.managedEndpointRuntime.open")(function* (
            input: ConnectorStartInput,
          ) {
            yield* Queue.offer(opens, input);
            return yield* Queue.take(plans).pipe(Effect.flatten);
          }),
        }),
      ),
      Layer.succeed(
        Timing,
        Timing.of({
          sleep: (milliseconds, purpose) =>
            Effect.gen(function* () {
              const resume = yield* Deferred.make<void>();
              yield* Queue.offer(sleeps, { milliseconds, purpose, resume });
              yield* Deferred.await(resume);
            }),
          jitter: (milliseconds) => Effect.succeed(milliseconds),
          closeWithinDeadline: (close) =>
            Effect.raceFirst(
              close,
              Effect.gen(function* () {
                const resume = yield* Deferred.make<void>();
                yield* Queue.offer(closeDeadlines, { resume });
                yield* Deferred.await(resume);
              }),
            ),
        }),
      ),
    ),
    Layer.succeed(
      Connectivity,
      Connectivity.of({
        isOnline: Ref.get(onlineRef),
        waitUntilOnline,
      }),
    ),
  );

  return {
    closeDeadlines,
    opens,
    plans,
    sleeps,
    runtimeLayer: layer.pipe(Layer.provide(dependencies)),
    setOnline: (online: boolean) =>
      Ref.set(onlineRef, online).pipe(
        Effect.andThen(Queue.offer(onlineChanges, online)),
        Effect.asVoid,
      ),
  };
});

const awaitSnapshot = (
  runtime: Shape,
  predicate: (snapshot: Snapshot) => boolean,
): Effect.Effect<Snapshot> =>
  Effect.suspend(() =>
    runtime.snapshot.pipe(
      Effect.flatMap((snapshot) =>
        predicate(snapshot)
          ? Effect.succeed(snapshot)
          : Effect.yieldNow.pipe(Effect.andThen(awaitSnapshot(runtime, predicate))),
      ),
    ),
  );

describe("managed endpoint runtime", () => {
  it("maps local connector configuration failures to a payload-free typed error", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const connectorFactory = yield* ConnectorFactory;
        return yield* Effect.result(
          connectorFactory.open({
            executable: "cloudflared",
            configPath: "/managed/cloudflared.yml",
            tunnelId: "6ff42ae1-765d-4adf-8112-92a242b8f28f",
            redactValues: ["must-not-leak"],
          }),
        );
      }).pipe(Effect.provide(connectorFactoryLayer)),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) return;
    expect(result.failure).toEqual(new ConnectorConfigurationError({}));
    expect(JSON.stringify(result.failure)).not.toContain("must-not-leak");
  });

  it("caps exponential retry and resets it after the healthy window", async () => {
    const expectedDelays = [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];

    await Effect.runPromise(
      Effect.gen(function* () {
        const harness = yield* makeHarness;
        const connector = yield* makeFakeConnector();
        yield* Queue.offerAll(harness.plans, [
          ...expectedDelays.map(() => Effect.fail(new ConnectorTransientError({}))),
          Effect.succeed(connector.handle),
        ]);

        yield* Effect.gen(function* () {
          const runtime = yield* ManagedEndpointRuntime;
          yield* runtime.reconcile(activeDesired("allocation:7"));

          yield* Effect.forEach(
            expectedDelays,
            (expectedDelay, index) =>
              Effect.gen(function* () {
                expect((yield* Queue.take(harness.opens)).tunnelId).toBe(
                  "6ff42ae1-765d-4adf-8112-92a242b8f28f",
                );
                const sleep = yield* Queue.take(harness.sleeps);
                expect(sleep).toMatchObject({
                  milliseconds: expectedDelay,
                  purpose: "backoff",
                });
                expect(yield* runtime.snapshot).toEqual({
                  status: "backoff",
                  configurationKey: "allocation:7",
                  restartAttempt: index + 1,
                });
                yield* Deferred.succeed(sleep.resume, undefined);
              }),
            { discard: true },
          );

          yield* Queue.take(harness.opens);
          yield* connector.ready;
          expect(
            yield* awaitSnapshot(
              runtime,
              (snapshot) =>
                snapshot.status === "connected" &&
                snapshot.restartAttempt === expectedDelays.length,
            ),
          ).toEqual({
            status: "connected",
            configurationKey: "allocation:7",
            restartAttempt: expectedDelays.length,
          });

          const healthyWindow = yield* Queue.take(harness.sleeps);
          expect(healthyWindow).toMatchObject({
            milliseconds: 30_000,
            purpose: "healthy",
          });
          yield* Deferred.succeed(healthyWindow.resume, undefined);
          expect(
            yield* awaitSnapshot(
              runtime,
              (snapshot) => snapshot.status === "connected" && snapshot.restartAttempt === 0,
            ),
          ).toEqual({
            status: "connected",
            configurationKey: "allocation:7",
            restartAttempt: 0,
          });

          yield* connector.exit;
          const resetBackoff = yield* Queue.take(harness.sleeps);
          expect(resetBackoff).toMatchObject({
            milliseconds: 500,
            purpose: "backoff",
          });
        }).pipe(Effect.provide(harness.runtimeLayer), Effect.scoped);
      }),
    );
  });

  it("serializes replacement, closes a starting child, and ignores its stale signals", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const harness = yield* makeHarness;
        const first = yield* makeFakeConnector();
        const second = yield* makeFakeConnector();
        yield* Queue.offerAll(harness.plans, [
          Effect.succeed(first.handle),
          Effect.succeed(second.handle),
        ]);

        yield* Effect.gen(function* () {
          const runtime = yield* ManagedEndpointRuntime;
          yield* runtime.reconcile(activeDesired("allocation:1"));
          yield* Queue.take(harness.opens);
          yield* awaitSnapshot(
            runtime,
            (snapshot) =>
              snapshot.status === "starting" && snapshot.configurationKey === "allocation:1",
          );

          yield* runtime.reconcile(
            activeDesired("allocation:2", "77e13459-ab1b-4c8f-bc04-5c07b220d365"),
          );
          expect((yield* Queue.take(harness.opens)).tunnelId).toBe(
            "77e13459-ab1b-4c8f-bc04-5c07b220d365",
          );
          expect(yield* first.closeCount).toBe(1);

          yield* second.ready;
          yield* awaitSnapshot(
            runtime,
            (snapshot) =>
              snapshot.status === "connected" && snapshot.configurationKey === "allocation:2",
          );
          yield* first.ready;
          yield* first.exit;
          yield* Effect.yieldNow;
          expect(yield* runtime.snapshot).toEqual({
            status: "connected",
            configurationKey: "allocation:2",
            restartAttempt: 0,
          });

          yield* runtime.reconcile({ enabled: false });
          expect(
            yield* awaitSnapshot(runtime, (snapshot) => snapshot.status === "disabled"),
          ).toEqual({
            status: "disabled",
            configurationKey: null,
            restartAttempt: 0,
          });
          expect(yield* second.closeCount).toBe(1);
        }).pipe(Effect.provide(harness.runtimeLayer), Effect.scoped);
      }),
    );
  });

  it("keeps configuration and invalid enrollment failures terminal for one key", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const harness = yield* makeHarness;
        const invalidEnrollment = yield* makeFakeConnector();
        yield* Queue.offerAll(harness.plans, [
          Effect.fail(new ConnectorConfigurationError({})),
          Effect.succeed(invalidEnrollment.handle),
        ]);

        yield* Effect.gen(function* () {
          const runtime = yield* ManagedEndpointRuntime;
          yield* runtime.reconcile(activeDesired("allocation:bad-config"));
          yield* Queue.take(harness.opens);
          expect(yield* awaitSnapshot(runtime, (snapshot) => snapshot.status === "failed")).toEqual(
            {
              status: "failed",
              configurationKey: "allocation:bad-config",
              restartAttempt: 0,
            },
          );
          expect(Option.isNone(yield* Queue.poll(harness.sleeps))).toBe(true);

          yield* runtime.reconcile(
            activeDesired("allocation:bad-config", "c4ad2cb5-40ed-4595-9a89-cb968ee1b28e"),
          );
          yield* Effect.yieldNow;
          expect(Option.isNone(yield* Queue.poll(harness.opens))).toBe(true);

          yield* runtime.reconcile(activeDesired("allocation:invalid-enrollment"));
          yield* Queue.take(harness.opens);
          yield* invalidEnrollment.failReady(new ConnectorInvalidEnrollmentError({}));
          expect(
            yield* awaitSnapshot(runtime, (snapshot) => snapshot.status === "invalid_enrollment"),
          ).toEqual({
            status: "invalid_enrollment",
            configurationKey: "allocation:invalid-enrollment",
            restartAttempt: 0,
          });
          expect(yield* invalidEnrollment.closeCount).toBe(1);
          expect(JSON.stringify(yield* runtime.snapshot)).not.toContain("must-not-leak");

          yield* runtime.reconcile({
            ...activeDesired(" "),
            configurationKey: " ",
          });
          expect(
            yield* awaitSnapshot(
              runtime,
              (snapshot) => snapshot.status === "failed" && snapshot.configurationKey === " ",
            ),
          ).toEqual({
            status: "failed",
            configurationKey: " ",
            restartAttempt: 0,
          });
          expect(Option.isNone(yield* Queue.poll(harness.opens))).toBe(true);
        }).pipe(Effect.provide(harness.runtimeLayer), Effect.scoped);
      }),
    );
  });

  it("gates initial and transient retries while offline", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const harness = yield* makeHarness;
        const first = yield* makeFakeConnector();
        const second = yield* makeFakeConnector();
        yield* Queue.offerAll(harness.plans, [
          Effect.succeed(first.handle),
          Effect.succeed(second.handle),
        ]);
        yield* harness.setOnline(false);

        yield* Effect.gen(function* () {
          const runtime = yield* ManagedEndpointRuntime;
          yield* runtime.reconcile(activeDesired("allocation:offline"));
          expect(
            yield* awaitSnapshot(runtime, (snapshot) => snapshot.status === "backoff"),
          ).toEqual({
            status: "backoff",
            configurationKey: "allocation:offline",
            restartAttempt: 0,
          });
          expect(Option.isNone(yield* Queue.poll(harness.opens))).toBe(true);

          yield* harness.setOnline(true);
          yield* Queue.take(harness.opens);
          yield* first.ready;
          yield* awaitSnapshot(runtime, (snapshot) => snapshot.status === "connected");
          const interruptedHealthyWindow = yield* Queue.take(harness.sleeps);
          expect(interruptedHealthyWindow.purpose).toBe("healthy");

          yield* harness.setOnline(false);
          yield* first.exit;
          yield* awaitSnapshot(
            runtime,
            (snapshot) => snapshot.status === "backoff" && snapshot.restartAttempt === 1,
          );
          expect(Option.isNone(yield* Queue.poll(harness.sleeps))).toBe(true);
          expect(Option.isNone(yield* Queue.poll(harness.opens))).toBe(true);

          yield* harness.setOnline(true);
          const backoff = yield* Queue.take(harness.sleeps);
          expect(backoff).toMatchObject({ milliseconds: 500, purpose: "backoff" });
          yield* Deferred.succeed(backoff.resume, undefined);
          yield* Queue.take(harness.opens);
          yield* second.ready;
          expect(
            yield* awaitSnapshot(
              runtime,
              (snapshot) => snapshot.status === "connected" && snapshot.restartAttempt === 1,
            ),
          ).toMatchObject({
            status: "connected",
            configurationKey: "allocation:offline",
          });
        }).pipe(Effect.provide(harness.runtimeLayer), Effect.scoped);
      }),
    );
  });

  it("uses the latest desired state despite concurrent stale wakeups", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const harness = yield* makeHarness;
        const connector = yield* makeFakeConnector();
        yield* Queue.offer(harness.plans, Effect.succeed(connector.handle));
        yield* harness.setOnline(false);

        yield* Effect.gen(function* () {
          const runtime = yield* ManagedEndpointRuntime;
          yield* Effect.all(
            Array.from({ length: 24 }, (_, index) =>
              runtime.reconcile(
                activeDesired(
                  `allocation:stale:${index}`,
                  index % 2 === 0
                    ? "6ff42ae1-765d-4adf-8112-92a242b8f28f"
                    : "77e13459-ab1b-4c8f-bc04-5c07b220d365",
                ),
              ),
            ),
            { concurrency: "unbounded", discard: true },
          );
          yield* runtime.reconcile(
            activeDesired("allocation:final", "c4ad2cb5-40ed-4595-9a89-cb968ee1b28e"),
          );
          yield* awaitSnapshot(
            runtime,
            (snapshot) =>
              snapshot.status === "backoff" && snapshot.configurationKey === "allocation:final",
          );

          yield* harness.setOnline(true);
          expect((yield* Queue.take(harness.opens)).tunnelId).toBe(
            "c4ad2cb5-40ed-4595-9a89-cb968ee1b28e",
          );
          yield* connector.ready;
          yield* awaitSnapshot(
            runtime,
            (snapshot) =>
              snapshot.status === "connected" && snapshot.configurationKey === "allocation:final",
          );

          yield* runtime.reconcile({ enabled: false });
          yield* awaitSnapshot(runtime, (snapshot) => snapshot.status === "disabled");
          expect(yield* connector.closeCount).toBe(1);
        }).pipe(Effect.provide(harness.runtimeLayer), Effect.scoped);
      }),
    );
  });

  it("does not let a never-settling close block replacement", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const harness = yield* makeHarness;
        const first = yield* makeFakeConnector({ closeNeverCompletes: true });
        const second = yield* makeFakeConnector();
        yield* Queue.offerAll(harness.plans, [
          Effect.succeed(first.handle),
          Effect.succeed(second.handle),
        ]);

        yield* Effect.gen(function* () {
          const runtime = yield* ManagedEndpointRuntime;
          yield* runtime.reconcile(activeDesired("allocation:hung-close"));
          yield* Queue.take(harness.opens);
          yield* first.ready;
          yield* awaitSnapshot(runtime, (snapshot) => snapshot.status === "connected");

          yield* runtime.reconcile(
            activeDesired("allocation:replacement", "77e13459-ab1b-4c8f-bc04-5c07b220d365"),
          );
          const deadline = yield* Queue.take(harness.closeDeadlines);
          expect(yield* first.closeCount).toBe(1);
          yield* Deferred.succeed(deadline.resume, undefined);

          expect((yield* Queue.take(harness.opens)).tunnelId).toBe(
            "77e13459-ab1b-4c8f-bc04-5c07b220d365",
          );
          yield* second.ready;
          yield* awaitSnapshot(
            runtime,
            (snapshot) =>
              snapshot.status === "connected" &&
              snapshot.configurationKey === "allocation:replacement",
          );
        }).pipe(Effect.provide(harness.runtimeLayer), Effect.scoped);
      }),
    );
  });

  it("closes the owned connector when the runtime scope closes", async () => {
    const closeCount = await Effect.runPromise(
      Effect.gen(function* () {
        const harness = yield* makeHarness;
        const connector = yield* makeFakeConnector();
        yield* Queue.offer(harness.plans, Effect.succeed(connector.handle));

        const closedConnector = yield* Effect.gen(function* () {
          const runtime = yield* ManagedEndpointRuntime;
          yield* runtime.reconcile(activeDesired("allocation:shutdown"));
          yield* Queue.take(harness.opens);
          yield* awaitSnapshot(runtime, (snapshot) => snapshot.status === "starting");
          return connector;
        }).pipe(Effect.provide(harness.runtimeLayer), Effect.scoped);

        return yield* closedConnector.closeCount;
      }),
    );

    expect(closeCount).toBe(1);
  });
});
