import { Effect, Schema } from "effect";
import {
  ClientOrchestrationCommand,
  DEFAULT_RUNTIME_MODE,
  DispatchResult,
  ModelSelection,
  OrchestrationProposedPlan,
  OrchestrationReplayEventsInput,
  OrchestrationReplayEventsResult,
  OrchestrationShellStreamItem,
  OrchestrationSubscribeThreadInput,
  OrchestrationThreadActivity,
  OrchestrationThreadStreamItem,
  RuntimeMode,
  SourceProposedPlanReference,
  ThreadTurnStartBootstrap,
  UploadChatAttachment,
} from "@honk/shared/orchestration";
import {
  AgentInteractionMode,
  DEFAULT_AGENT_INTERACTION_MODE,
} from "@honk/shared/interaction-mode";
import {
  CommandId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "@honk/shared/base-schemas";

export * from "@honk/shared/orchestration";

export const ORCHESTRATION_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  replayEvents: "orchestration.replayEvents",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
} as const;

export const RuntimeIngestionRecordId = TrimmedNonEmptyString.pipe(
  Schema.brand("RuntimeIngestionRecordId"),
);
export type RuntimeIngestionRecordId = typeof RuntimeIngestionRecordId.Type;

const RuntimeIngestionRecordBase = {
  recordId: RuntimeIngestionRecordId,
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
  sourceEventId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
} as const;

const RuntimeAssistantCompletionRecord = Schema.Struct({
  ...RuntimeIngestionRecordBase,
  kind: Schema.Literal("assistant.completion"),
  payload: Schema.Struct({
    messageId: MessageId,
    text: Schema.String,
    turnId: TurnId,
    parentEntryId: ThreadEntryId,
  }),
});

const RuntimeUserTurnStartRecord = Schema.Struct({
  ...RuntimeIngestionRecordBase,
  kind: Schema.Literal("user.turn-start"),
  payload: Schema.Struct({
    messageId: MessageId,
    text: Schema.String,
    attachments: Schema.Array(UploadChatAttachment),
    modelSelection: Schema.optional(ModelSelection),
    titleSeed: Schema.optional(TrimmedNonEmptyString),
    runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
    interactionMode: AgentInteractionMode.pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_INTERACTION_MODE)),
    ),
    parentEntryId: Schema.optionalKey(Schema.NullOr(ThreadEntryId)),
    bootstrap: Schema.optional(ThreadTurnStartBootstrap),
    sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  }),
});

const RuntimeThreadActivityRecord = Schema.Struct({
  ...RuntimeIngestionRecordBase,
  kind: Schema.Literal("thread.activity"),
  payload: Schema.Struct({
    activity: OrchestrationThreadActivity,
  }),
});

const RuntimeProposedPlanRecord = Schema.Struct({
  ...RuntimeIngestionRecordBase,
  kind: Schema.Literal("proposed-plan"),
  payload: Schema.Struct({
    proposedPlan: OrchestrationProposedPlan,
  }),
});

export const RuntimeIngestionRecord = Schema.Union([
  RuntimeAssistantCompletionRecord,
  RuntimeUserTurnStartRecord,
  RuntimeThreadActivityRecord,
  RuntimeProposedPlanRecord,
]);
export type RuntimeIngestionRecord = typeof RuntimeIngestionRecord.Type;

export const RuntimeIngestionRequest = Schema.Struct({
  records: Schema.Array(RuntimeIngestionRecord),
});
export type RuntimeIngestionRequest = typeof RuntimeIngestionRequest.Type;

export const RuntimeIngestionAck = Schema.Struct({
  recordId: RuntimeIngestionRecordId,
  sequence: NonNegativeInt,
});
export type RuntimeIngestionAck = typeof RuntimeIngestionAck.Type;

export const RuntimeIngestionResult = Schema.Struct({
  accepted: NonNegativeInt,
  acks: Schema.Array(RuntimeIngestionAck),
});
export type RuntimeIngestionResult = typeof RuntimeIngestionResult.Type;
export const OrchestrationRpcSchemas = {
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  replayEvents: {
    input: OrchestrationReplayEventsInput,
    output: OrchestrationReplayEventsResult,
  },
  subscribeThread: {
    input: OrchestrationSubscribeThreadInput,
    output: OrchestrationThreadStreamItem,
  },
  subscribeShell: {
    input: Schema.Struct({}),
    output: OrchestrationShellStreamItem,
  },
} as const;

export class OrchestrationGetSnapshotError extends Schema.TaggedErrorClass<OrchestrationGetSnapshotError>()(
  "OrchestrationGetSnapshotError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationDispatchCommandError extends Schema.TaggedErrorClass<OrchestrationDispatchCommandError>()(
  "OrchestrationDispatchCommandError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const OrchestrationHttpErrorResponse = Schema.Struct({
  error: TrimmedNonEmptyString,
});
export type OrchestrationHttpErrorResponse = typeof OrchestrationHttpErrorResponse.Type;

export class OrchestrationReplayEventsError extends Schema.TaggedErrorClass<OrchestrationReplayEventsError>()(
  "OrchestrationReplayEventsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
