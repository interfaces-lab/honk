import { Cause, Duration, Effect, Exit, Metric, Stream } from "effect";
import * as EffectLogger from "@honk/shared/effect-logger";
import { outcomeFromExit } from "@honk/shared/observability";

import { metricAttributes, rpcRequestDuration, rpcRequestsTotal, withMetrics } from "./Metrics.ts";

const annotateRpcSpan = (
  method: string,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Effect.Effect<void, never, never> =>
  Effect.annotateCurrentSpan({
    "rpc.method": method,
    ...traceAttributes,
  });

const recordRpcStreamMetrics = <E>(
  method: string,
  startedAt: number,
  exit: Exit.Exit<unknown, E>,
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* Metric.update(
      Metric.withAttributes(rpcRequestDuration, metricAttributes({ method })),
      Duration.millis(Math.max(0, Date.now() - startedAt)),
    );
    yield* Metric.update(
      Metric.withAttributes(
        rpcRequestsTotal,
        metricAttributes({
          method,
          outcome: outcomeFromExit(exit),
        }),
      ),
      1,
    );
  });

const rpcLog = EffectLogger.create({ service: "server.rpc" });

const logRpcFailure = <A, E>(
  method: string,
  exit: Exit.Exit<A, E>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Effect.Effect<void, never, never> => {
  if (!Exit.isFailure(exit) || Cause.hasInterruptsOnly(exit.cause)) {
    return Effect.void;
  }

  return rpcLog.error("rpc request failed", {
    method,
    ...traceAttributes,
    cause: Cause.pretty(exit.cause),
  });
};

export const observeRpcEffect = <A, E, R>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* annotateRpcSpan(method, traceAttributes);

    return yield* effect.pipe(
      withMetrics({
        counter: rpcRequestsTotal,
        timer: rpcRequestDuration,
        attributes: {
          method,
        },
      }),
      Effect.onExit((exit) => logRpcFailure(method, exit, traceAttributes)),
    );
  });

export const observeRpcStream = <A, E, R>(
  method: string,
  stream: Stream.Stream<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Stream.Stream<A, E, R> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* annotateRpcSpan(method, traceAttributes);
      const startedAt = Date.now();
      return stream.pipe(
        Stream.onExit((exit) =>
          recordRpcStreamMetrics(method, startedAt, exit).pipe(
            Effect.andThen(logRpcFailure(method, exit, traceAttributes)),
          ),
        ),
      );
    }),
  );

export const observeRpcStreamEffect = <A, StreamError, StreamContext, EffectError, EffectContext>(
  method: string,
  effect: Effect.Effect<Stream.Stream<A, StreamError, StreamContext>, EffectError, EffectContext>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Stream.Stream<A, StreamError | EffectError, StreamContext | EffectContext> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* annotateRpcSpan(method, traceAttributes);
      const startedAt = Date.now();
      const exit = yield* Effect.exit(effect);

      if (Exit.isFailure(exit)) {
        yield* recordRpcStreamMetrics(method, startedAt, exit);
        yield* logRpcFailure(method, exit, traceAttributes);
        return yield* Effect.failCause(exit.cause);
      }

      return exit.value.pipe(
        Stream.onExit((streamExit) =>
          recordRpcStreamMetrics(method, startedAt, streamExit).pipe(
            Effect.andThen(logRpcFailure(method, streamExit, traceAttributes)),
          ),
        ),
      );
    }),
  );
