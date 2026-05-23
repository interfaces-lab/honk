import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./base-schemas";
import {
  ApprovalRequestId,
  EventId,
  IsoDateTime,
  ProviderItemId,
  ThreadId,
  TurnId,
} from "./base-schemas";
import {
  ChatAttachment,
  ModelSelection,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderApprovalDecision,
  ProviderApprovalPolicy,
  ProviderInteractionMode,
  ProviderRequestKind,
  ProviderSandboxMode,
  ProviderUserInputAnswers,
  RuntimeMode,
} from "./orchestration";
import { ProviderDriverKind, ProviderInstanceId } from "./provider-instance";
import { ProviderThreadSnapshotItem } from "./provider-runtime";

const ProviderSessionStatus = Schema.Literals([
  "connecting",
  "ready",
  "running",
  "error",
  "closed",
]);

export const ProviderSession = Schema.Struct({
  provider: ProviderDriverKind,
  providerInstanceId: ProviderInstanceId,
  status: ProviderSessionStatus,
  runtimeMode: RuntimeMode,
  cwd: Schema.optional(TrimmedNonEmptyString),
  model: Schema.optional(TrimmedNonEmptyString),
  threadId: ThreadId,
  resumeCursor: Schema.optional(Schema.Unknown),
  activeTurnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastError: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderSession = typeof ProviderSession.Type;

export const ProviderSessionStartInput = Schema.Struct({
  threadId: ThreadId,
  provider: Schema.optional(ProviderDriverKind),
  providerInstanceId: ProviderInstanceId,
  cwd: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  resumeCursor: Schema.optional(Schema.Unknown),
  discardResumeCursor: Schema.optional(Schema.Boolean),
  approvalPolicy: Schema.optional(ProviderApprovalPolicy),
  sandboxMode: Schema.optional(ProviderSandboxMode),
  runtimeMode: RuntimeMode,
});
export type ProviderSessionStartInput = typeof ProviderSessionStartInput.Type;

export const ProviderConversationMessage = Schema.Struct({
  role: Schema.Literals(["user", "assistant", "system"]),
  text: Schema.String,
});
export type ProviderConversationMessage = typeof ProviderConversationMessage.Type;

export const ProviderSendTurnInput = Schema.Struct({
  threadId: ThreadId,
  input: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  ),
  context: Schema.optional(Schema.Array(ProviderConversationMessage)),
  attachments: Schema.optional(
    Schema.Array(ChatAttachment).check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS)),
  ),
  modelSelection: Schema.optional(ModelSelection),
  interactionMode: Schema.optional(ProviderInteractionMode),
});
export type ProviderSendTurnInput = typeof ProviderSendTurnInput.Type;

export const ProviderTurnStartResult = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  resumeCursor: Schema.optional(Schema.Unknown),
});
export type ProviderTurnStartResult = typeof ProviderTurnStartResult.Type;

export const ProviderInterruptTurnInput = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
});
export type ProviderInterruptTurnInput = typeof ProviderInterruptTurnInput.Type;

export const ProviderThreadReadInput = Schema.Struct({
  threadId: ThreadId,
  providerThreadId: Schema.optional(TrimmedNonEmptyString),
  includeTurns: Schema.optional(Schema.Boolean),
});
export type ProviderThreadReadInput = typeof ProviderThreadReadInput.Type;

export const ProviderThreadTurnSnapshot = Schema.Struct({
  id: TurnId,
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  items: Schema.Array(ProviderThreadSnapshotItem),
});
export type ProviderThreadTurnSnapshot = typeof ProviderThreadTurnSnapshot.Type;

export const ProviderThreadSnapshot = Schema.Struct({
  threadId: ThreadId,
  providerThreadId: Schema.optional(TrimmedNonEmptyString),
  turns: Schema.Array(ProviderThreadTurnSnapshot),
});
export type ProviderThreadSnapshot = typeof ProviderThreadSnapshot.Type;

export const ProviderStopSessionInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProviderStopSessionInput = typeof ProviderStopSessionInput.Type;

export const ProviderRespondToRequestInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
});
export type ProviderRespondToRequestInput = typeof ProviderRespondToRequestInput.Type;

export const ProviderRespondToUserInputInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
});
export type ProviderRespondToUserInputInput = typeof ProviderRespondToUserInputInput.Type;

const ProviderEventKind = Schema.Literals(["session", "notification", "request", "error"]);

export const ProviderEvent = Schema.Struct({
  id: EventId,
  kind: ProviderEventKind,
  provider: ProviderDriverKind,
  providerInstanceId: ProviderInstanceId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
  method: TrimmedNonEmptyString,
  message: Schema.optional(TrimmedNonEmptyString),
  turnId: Schema.optional(TurnId),
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  itemId: Schema.optional(ProviderItemId),
  parentProviderConversationId: Schema.optional(TrimmedNonEmptyString),
  parentItemId: Schema.optional(ProviderItemId),
  requestId: Schema.optional(ApprovalRequestId),
  requestKind: Schema.optional(ProviderRequestKind),
  textDelta: Schema.optional(Schema.String),
  providerConversationId: Schema.optional(TrimmedNonEmptyString),
  payload: Schema.optional(Schema.Unknown),
});
export type ProviderEvent = typeof ProviderEvent.Type;
