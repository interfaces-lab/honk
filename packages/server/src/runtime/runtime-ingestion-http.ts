import {
  CommandId,
  type ClientOrchestrationCommand,
  type DispatchResult,
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
import { GitManager } from "../git/GitManager.service.ts";
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

export function clientCommandForRuntimeUserTurnStartRecord(
  record: Extract<RuntimeIngestionRecord, { kind: "user.turn-start" }>,
): ClientOrchestrationCommand {
  return {
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
    ...(record.payload.bootstrap !== undefined ? { bootstrap: record.payload.bootstrap } : {}),
    ...(record.payload.sourceProposedPlan !== undefined
      ? { sourceProposedPlan: record.payload.sourceProposedPlan }
      : {}),
    createdAt: record.createdAt,
  };
}

// Maps the non-turn-start runtime facts to internal orchestration commands with no server-service
// dependency, so the ingest -> command -> event -> projection chain is unit-testable. The commandId
// is the deterministic record id, so re-ingesting the same fact yields the same command and the
// engine deduplicates it.
export function internalCommandForRuntimeFact(
  record: Extract<
    RuntimeIngestionRecord,
    { kind: "assistant.completion" | "thread.activity" | "proposed-plan" }
  >,
): OrchestrationCommand {
  switch (record.kind) {
    case "assistant.completion":
      return {
        type: "thread.message.assistant.complete",
        commandId: runtimeRecordCommandId(record),
        threadId: record.threadId,
        messageId: record.payload.messageId,
        text: record.payload.text,
        turnId: record.payload.turnId,
        parentEntryId: record.payload.parentEntryId,
        createdAt: record.createdAt,
      };
    case "thread.activity":
      return {
        type: "thread.activity.append",
        commandId: runtimeRecordCommandId(record),
        threadId: record.threadId,
        activity: record.payload.activity,
        createdAt: record.createdAt,
      };
    case "proposed-plan":
      return {
        type: "thread.proposed-plan.upsert",
        commandId: runtimeRecordCommandId(record),
        threadId: record.threadId,
        proposedPlan: record.payload.proposedPlan,
        createdAt: record.createdAt,
      };
  }
}

export function runtimeRecordToCommand(record: RuntimeIngestionRecord) {
  switch (record.kind) {
    case "user.turn-start": {
      return normalizeDispatchCommand(clientCommandForRuntimeUserTurnStartRecord(record));
    }
    case "assistant.completion":
    case "thread.activity":
    case "proposed-plan":
      return Effect.succeed(internalCommandForRuntimeFact(record));
  }
}

const dispatchRuntimeCommand = (
  command: OrchestrationCommand,
  services: {
    readonly orchestrationEngine: OrchestrationEngineService["Service"];
    readonly gitManager: GitManager["Service"];
  },
): Effect.Effect<DispatchResult, OrchestrationDispatchCommandError> =>
  command.type === "thread.turn.start" && command.bootstrap !== undefined
    ? services.gitManager.dispatchBootstrapTurnStart(command)
    : services.orchestrationEngine.dispatch(command).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationDispatchCommandError({
              message: "Failed to dispatch runtime ingestion command.",
              cause,
            }),
        ),
      );

export const runtimeIngestionRouteLayer = HttpRouter.add(
  "POST",
  "/api/runtime/ingest",
  Effect.gen(function* () {
    yield* authenticateOwnerSession;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const gitManager = yield* GitManager;
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
          Effect.flatMap((command) =>
            dispatchRuntimeCommand(command, { orchestrationEngine, gitManager }),
          ),
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
