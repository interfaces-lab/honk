import type { OrchestrationEvent, ProviderRuntimeEvent } from "@multi/contracts";
import { makeDrainableWorker } from "@multi/shared/DrainableWorker";
import { Cause, Effect, Layer, Stream } from "effect";

import { CheckpointLifecycleLive } from "../checkpointing/CheckpointLifecycle.ts";
import {
  CheckpointLifecycle,
  type CheckpointLifecycleError,
} from "../checkpointing/CheckpointLifecycle.service.ts";
import { ProviderService } from "../provider/ProviderService.service.ts";
import { CheckpointReactor, type CheckpointReactorShape } from "./CheckpointReactor.service.ts";
import { OrchestrationEngineService } from "./OrchestrationEngine.service.ts";

type ReactorInput =
  | {
      readonly source: "runtime";
      readonly event: ProviderRuntimeEvent;
    }
  | {
      readonly source: "domain";
      readonly event: OrchestrationEvent;
    };

const errorDetail = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const checkpointLifecycle = yield* CheckpointLifecycle;

  const processDomainEvent = Effect.fn("processDomainEvent")(function* (event: OrchestrationEvent) {
    if (event.type === "thread.turn-start-requested" || event.type === "thread.message-sent") {
      yield* checkpointLifecycle.ensurePreTurnBaselineFromDomainStart(event);
      return;
    }

    if (event.type === "thread.checkpoint-revert-requested") {
      yield* checkpointLifecycle.revertToCheckpoint(event).pipe(
        Effect.catch((error) =>
          checkpointLifecycle.appendRevertFailureActivity({
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            detail: errorDetail(error),
            createdAt: new Date().toISOString(),
          }),
        ),
      );
      return;
    }

    if (event.type === "thread.turn-diff-completed") {
      yield* checkpointLifecycle.capturePlaceholderCheckpoint(event).pipe(
        Effect.catch((error) =>
          checkpointLifecycle
            .appendCaptureFailureActivity({
              threadId: event.payload.threadId,
              turnId: event.payload.turnId,
              detail: errorDetail(error),
              createdAt: new Date().toISOString(),
            })
            .pipe(Effect.catch(() => Effect.void)),
        ),
      );
    }
  });

  const processRuntimeEvent = Effect.fn("processRuntimeEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
    if (event.type === "turn.started") {
      yield* checkpointLifecycle.ensurePreTurnBaselineFromRuntimeStart(event);
      return;
    }

    if (event.type === "turn.completed") {
      const turnId = checkpointLifecycle.turnIdFromRuntime(event.turnId);
      yield* checkpointLifecycle.refreshLocalGitStatusFromTurnCompletion(event);
      yield* checkpointLifecycle.captureCompletedTurn(event).pipe(
        Effect.catch((error) =>
          checkpointLifecycle
            .appendCaptureFailureActivity({
              threadId: event.threadId,
              turnId,
              detail: errorDetail(error),
              createdAt: new Date().toISOString(),
            })
            .pipe(Effect.catch(() => Effect.void)),
        ),
      );
    }
  });

  const processInput = (
    input: ReactorInput,
  ): Effect.Effect<void, CheckpointLifecycleError, never> =>
    input.source === "domain" ? processDomainEvent(input.event) : processRuntimeEvent(input.event);

  const processInputSafely = (input: ReactorInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("checkpoint reactor failed to process input", {
          source: input.source,
          eventType: input.event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processInputSafely);

  const start: CheckpointReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (
          event.type !== "thread.turn-start-requested" &&
          event.type !== "thread.message-sent" &&
          event.type !== "thread.checkpoint-revert-requested" &&
          event.type !== "thread.turn-diff-completed"
        ) {
          return Effect.void;
        }
        return worker.enqueue({ source: "domain", event });
      }),
    );

    yield* Effect.forkScoped(
      Stream.runForEach(providerService.streamEvents, (event) => {
        if (event.type !== "turn.started" && event.type !== "turn.completed") {
          return Effect.void;
        }
        return worker.enqueue({ source: "runtime", event });
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies CheckpointReactorShape;
});

export const CheckpointReactorLive = Layer.effect(CheckpointReactor, make).pipe(
  Layer.provide(CheckpointLifecycleLive),
);
