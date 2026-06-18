import {
  CommandId,
  type ClientOrchestrationCommand,
  OrchestrationDispatchCommandError,
  type OrchestrationHttpErrorResponse,
  type RuntimeIngestionRecord,
  RuntimeIngestionRequest,
  type RuntimeIngestionResult,
  type OrchestrationCommand,
} from "@honk/contracts";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerAuth } from "../auth/ServerAuth.service.ts";
import { normalizeDispatchCommand } from "../orchestration/Normalizer.ts";
import { OrchestrationEngineService } from "../orchestration/OrchestrationEngine.service.ts";

const respondToRuntimeIngestionError = (error: OrchestrationDispatchCommandError) =>
  Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      { error: error.message } satisfies OrchestrationHttpErrorResponse,
      { status: 400 },
    ),
  );

const authenticateOwnerSession = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request);
  if (session.role !== "owner") {
    return yield* new OrchestrationDispatchCommandError({
      message: "Only owner sessions can ingest runtime records.",
    });
  }
  return session;
});

function runtimeRecordCommandId(record: RuntimeIngestionRecord): CommandId {
  return CommandId.make(record.recordId);
}

function runtimeRecordToCommand(record: RuntimeIngestionRecord) {
  switch (record.kind) {
    case "user.turn-start": {
      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: runtimeRecordCommandId(record),
        threadId: record.threadId,
        message: {
          messageId: record.payload.messageId,
          role: "user",
          text: record.payload.text,
          attachments: record.payload.attachments,
        },
        ...(record.payload.modelSelection !== undefined
          ? { modelSelection: record.payload.modelSelection }
          : {}),
        ...(record.payload.titleSeed !== undefined ? { titleSeed: record.payload.titleSeed } : {}),
        runtimeMode: record.payload.runtimeMode,
        interactionMode: record.payload.interactionMode,
        ...(record.payload.parentEntryId !== undefined
          ? { parentEntryId: record.payload.parentEntryId }
          : {}),
        ...(record.payload.sourceProposedPlan !== undefined
          ? { sourceProposedPlan: record.payload.sourceProposedPlan }
          : {}),
        createdAt: record.createdAt,
      };
      return normalizeDispatchCommand(command);
    }
    case "assistant.completion":
      return Effect.succeed({
        type: "thread.message.assistant.complete",
        commandId: runtimeRecordCommandId(record),
        threadId: record.threadId,
        messageId: record.payload.messageId,
        text: record.payload.text,
        turnId: record.payload.turnId,
        parentEntryId: record.payload.parentEntryId,
        createdAt: record.createdAt,
      } satisfies OrchestrationCommand);
    case "thread.activity":
      return Effect.succeed({
        type: "thread.activity.append",
        commandId: runtimeRecordCommandId(record),
        threadId: record.threadId,
        activity: record.payload.activity,
        createdAt: record.createdAt,
      } satisfies OrchestrationCommand);
  }
}

export const runtimeIngestionRouteLayer = HttpRouter.add(
  "POST",
  "/api/runtime/ingest",
  Effect.gen(function* () {
    yield* authenticateOwnerSession;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const request = yield* HttpServerRequest.schemaBodyJson(RuntimeIngestionRequest).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationDispatchCommandError({
            message: "Invalid runtime ingestion payload.",
            cause,
          }),
      ),
    );
    const acks = yield* Effect.forEach(
      request.records,
      (record) =>
        runtimeRecordToCommand(record).pipe(
          Effect.flatMap((command) => orchestrationEngine.dispatch(command)),
          Effect.map((result) => ({
            recordId: record.recordId,
            sequence: result.sequence,
          })),
          Effect.mapError(
            (cause) =>
              new OrchestrationDispatchCommandError({
                message: "Failed to ingest runtime record.",
                cause,
              }),
          ),
        ),
      { concurrency: 1 },
    );
    return HttpServerResponse.jsonUnsafe(
      {
        accepted: acks.length,
        acks,
      } satisfies RuntimeIngestionResult,
      { status: 200 },
    );
  }).pipe(Effect.catchTag("OrchestrationDispatchCommandError", respondToRuntimeIngestionError)),
);
