import {
  ClientOrchestrationCommand,
  type DispatchResult,
  OrchestrationDispatchCommandError,
  type OrchestrationHttpErrorResponse,
  OrchestrationGetSnapshotError,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@honk/contracts";
import * as EffectLogger from "@honk/shared/effect-logger";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerAuth } from "../auth/ServerAuth.service.ts";
import { dispatchThreadArchiveLifecycle } from "./archive-lifecycle.ts";
import { normalizeDispatchCommand } from "./Normalizer.ts";
import { OrchestrationEngineService } from "./OrchestrationEngine.service.ts";
import { ThreadProjection } from "./ThreadProjection.service.ts";

const elog = EffectLogger.create({ service: "orchestration.http" });

const respondToOrchestrationHttpError = (
  error: OrchestrationDispatchCommandError | OrchestrationGetSnapshotError,
) =>
  Effect.gen(function* () {
    if (error._tag === "OrchestrationGetSnapshotError") {
      yield* elog.error("orchestration http route failed", {
        message: error.message,
        cause: error.cause,
      });
      return HttpServerResponse.jsonUnsafe(
        { error: error.message } satisfies OrchestrationHttpErrorResponse,
        { status: 500 },
      );
    }

    return HttpServerResponse.jsonUnsafe(
      { error: error.message } satisfies OrchestrationHttpErrorResponse,
      { status: 400 },
    );
  });

const authenticateOwnerSession = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request);
  if (session.role !== "owner") {
    return yield* new OrchestrationDispatchCommandError({
      message: "Only owner sessions can manage projects.",
    });
  }
  return session;
});

export const orchestrationSnapshotRouteLayer = HttpRouter.add(
  "GET",
  "/api/orchestration/snapshot",
  Effect.gen(function* () {
    yield* authenticateOwnerSession;
    const threadProjection = yield* ThreadProjection;
    const snapshot = yield* threadProjection.getSnapshot().pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationGetSnapshotError({
            message: "Failed to load orchestration snapshot.",
            cause,
          }),
      ),
    );
    return HttpServerResponse.jsonUnsafe(snapshot satisfies OrchestrationReadModel, {
      status: 200,
    });
  }).pipe(
    Effect.catchTag("OrchestrationDispatchCommandError", respondToOrchestrationHttpError),
    Effect.catchTag("OrchestrationGetSnapshotError", respondToOrchestrationHttpError),
  ),
);

export const orchestrationDispatchRouteLayer = HttpRouter.add(
  "POST",
  "/api/orchestration/dispatch",
  Effect.gen(function* () {
    yield* authenticateOwnerSession;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const command = yield* HttpServerRequest.schemaBodyJson(ClientOrchestrationCommand).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationDispatchCommandError({
            message: "Invalid orchestration command payload.",
            cause,
          }),
      ),
    );
    const normalizedCommand = yield* normalizeDispatchCommand(command);
    const dispatch = (
      dispatchCommand: OrchestrationCommand,
    ): Effect.Effect<DispatchResult, OrchestrationDispatchCommandError> =>
      orchestrationEngine.dispatch(dispatchCommand).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationDispatchCommandError({
              message: "Failed to dispatch orchestration command.",
              cause,
            }),
        ),
      );
    const result =
      normalizedCommand.type === "thread.archive"
        ? yield* dispatchThreadArchiveLifecycle({
            archiveCommand: normalizedCommand,
            dispatch,
          })
        : yield* dispatch(normalizedCommand);
    return HttpServerResponse.jsonUnsafe(result, { status: 200 });
  }).pipe(Effect.catchTag("OrchestrationDispatchCommandError", respondToOrchestrationHttpError)),
);
