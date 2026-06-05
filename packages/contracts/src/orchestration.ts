import { Effect, Schema } from "effect";
import { ModelOptionSelections } from "./model";
import { RepositoryIdentity } from "./environment";
import { AgentInteractionMode, DEFAULT_AGENT_INTERACTION_MODE } from "./interaction-mode";
import {
  ApprovalRequestId,
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  RuntimeItemId,
  ThreadEntryId,
  ThreadId,
  TrimmedNonEmptyString,
  RuntimeTaskId,
  TurnId,
} from "./base-schemas";
import {
  CanonicalItemType,
  ThreadTokenUsageSnapshot,
  ToolLifecycleItemType,
  UserInputQuestion,
} from "./runtime-events";

export const ORCHESTRATION_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  replayEvents: "orchestration.replayEvents",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
} as const;

export const RuntimeApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type RuntimeApprovalPolicy = typeof RuntimeApprovalPolicy.Type;
export const RuntimeSandboxMode = Schema.Literals([
  "read-only",
  "project-write",
  "danger-full-access",
]);
export type RuntimeSandboxMode = typeof RuntimeSandboxMode.Type;

export const ModelSelectionInstanceId = TrimmedNonEmptyString;
export type ModelSelectionInstanceId = typeof ModelSelectionInstanceId.Type;

export const ModelSelection = Schema.Struct({
  instanceId: ModelSelectionInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ModelOptionSelections),
});
export type ModelSelection = typeof ModelSelection.Type;

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "full-access",
]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
export const RuntimeRequestKind = Schema.Literals([
  "command",
  "file-read",
  "file-change",
  "permissions",
  "mcp-elicitation",
  "dynamic-tool",
  "auth-refresh",
]);
export type RuntimeRequestKind = typeof RuntimeRequestKind.Type;
export const RuntimeApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export type RuntimeApprovalDecision = typeof RuntimeApprovalDecision.Type;
export const UserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type UserInputAnswers = typeof UserInputAnswers.Type;

export const RUNTIME_SEND_TURN_MAX_INPUT_CHARS = 120_000;
export const RUNTIME_SEND_TURN_MAX_ATTACHMENTS = 8;
export const RUNTIME_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const RUNTIME_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;
// Correlation id is command id by design in this model.
export const CorrelationId = CommandId;
export type CorrelationId = typeof CorrelationId.Type;

const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(RUNTIME_SEND_TURN_MAX_IMAGE_BYTES)),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(RUNTIME_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(RUNTIME_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
});
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const ChatAttachment = Schema.Union([ChatImageAttachment]);
export type ChatAttachment = typeof ChatAttachment.Type;
const UploadChatAttachment = Schema.Union([UploadChatImageAttachment]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
});
export type ProjectScript = typeof ProjectScript.Type;

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  projectRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProject = typeof OrchestrationProject.Type;

export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system"]);
export type OrchestrationMessageRole = typeof OrchestrationMessageRole.Type;
export const OrchestrationMessageRichText = Schema.Record(Schema.String, Schema.Unknown);
export type OrchestrationMessageRichText = typeof OrchestrationMessageRichText.Type;

export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  richText: Schema.optional(OrchestrationMessageRichText),
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationMessage = typeof OrchestrationMessage.Type;

export const OrchestrationThreadEntryKind = Schema.Literals(["message"]);
export type OrchestrationThreadEntryKind = typeof OrchestrationThreadEntryKind.Type;

export const OrchestrationThreadEntry = Schema.Struct({
  id: ThreadEntryId,
  threadId: ThreadId,
  parentEntryId: Schema.NullOr(ThreadEntryId),
  kind: OrchestrationThreadEntryKind,
  messageId: Schema.NullOr(MessageId),
  turnId: Schema.NullOr(TurnId),
  createdAt: IsoDateTime,
});
export type OrchestrationThreadEntry = typeof OrchestrationThreadEntry.Type;

export const OrchestrationProposedPlanId = TrimmedNonEmptyString;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const OrchestrationProposedPlan = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  implementationThreadId: Schema.NullOr(ThreadId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type;

export const SourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});
export type SourceProposedPlanReference = typeof SourceProposedPlanReference.Type;

export const OrchestrationSessionStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);
export type OrchestrationSessionStatus = typeof OrchestrationSessionStatus.Type;

export const OrchestrationSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type OrchestrationSession = typeof OrchestrationSession.Type;

export const OrchestrationThreadActivityTone = Schema.Literals([
  "info",
  "tool",
  "approval",
  "error",
]);
export type OrchestrationThreadActivityTone = typeof OrchestrationThreadActivityTone.Type;

export const OrchestrationThreadActivityKind = Schema.Literals([
  "approval.requested",
  "approval.resolved",
  "user-input.requested",
  "user-input.resolved",
  "extension-ui.requested",
  "extension-ui.resolved",
  "runtime.error",
  "runtime.warning",
  "turn.plan.updated",
  "task.started",
  "task.progress",
  "task.completed",
  "tool.started",
  "tool.updated",
  "tool.completed",
  "tool.summary",
  "context-window.updated",
  "context-compaction",
  "subagent.thread.started",
  "subagent.thread.state.changed",
  "subagent.item.started",
  "subagent.item.updated",
  "subagent.item.completed",
  "subagent.content.delta",
  "subagent.usage.updated",
  "runtime.turn.start.failed",
  "runtime.turn.interrupt.failed",
  "runtime.approval.respond.failed",
  "runtime.user-input.respond.failed",
  "runtime.session.stop.failed",
  "setup-script.requested",
  "setup-script.started",
  "setup-script.failed",
]);
export type OrchestrationThreadActivityKind = typeof OrchestrationThreadActivityKind.Type;

const ActivityUnknownRecord = Schema.Record(Schema.String, Schema.Unknown);

const ApprovalRequestedActivityPayload = Schema.Struct({
  requestId: Schema.optional(TrimmedNonEmptyString),
  requestKind: Schema.optional(RuntimeRequestKind),
  requestType: Schema.optional(TrimmedNonEmptyString),
  detail: Schema.optional(TrimmedNonEmptyString),
});

const ApprovalResolvedActivityPayload = Schema.Struct({
  requestId: Schema.optional(TrimmedNonEmptyString),
  requestKind: Schema.optional(RuntimeRequestKind),
  requestType: Schema.optional(TrimmedNonEmptyString),
  decision: Schema.optional(TrimmedNonEmptyString),
});

const UserInputRequestedActivityPayload = Schema.Struct({
  requestId: Schema.optional(TrimmedNonEmptyString),
  questions: Schema.Array(UserInputQuestion),
});

const UserInputResolvedActivityPayload = Schema.Struct({
  requestId: Schema.optional(TrimmedNonEmptyString),
  answers: ActivityUnknownRecord,
});

const ExtensionUiActivityRequestKind = Schema.Literals([
  "select",
  "confirm",
  "input",
  "editor",
  "custom",
]);

const ExtensionUiRequestedActivityPayload = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  requestKind: ExtensionUiActivityRequestKind,
  title: TrimmedNonEmptyString,
  detail: Schema.NullOr(Schema.String),
  placeholder: Schema.NullOr(Schema.String),
  options: Schema.NullOr(Schema.Array(Schema.String)),
});

const ExtensionUiResolvedActivityPayload = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  requestKind: ExtensionUiActivityRequestKind,
  title: TrimmedNonEmptyString,
  detail: Schema.NullOr(Schema.String),
  value: Schema.NullOr(Schema.Unknown),
});

const RuntimeMessageActivityPayload = Schema.Struct({
  message: TrimmedNonEmptyString,
  detail: Schema.optional(Schema.Unknown),
});

const ActivityPlanStep = Schema.Struct({
  step: TrimmedNonEmptyString,
  status: Schema.Literals(["pending", "inProgress", "completed"]),
});

const TurnPlanUpdatedActivityPayload = Schema.Struct({
  plan: Schema.Array(ActivityPlanStep),
  explanation: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

const TaskStartedActivityPayload = Schema.Struct({
  taskId: RuntimeTaskId,
  taskType: Schema.optional(TrimmedNonEmptyString),
  detail: Schema.optional(TrimmedNonEmptyString),
});

const TaskProgressActivityPayload = Schema.Struct({
  taskId: RuntimeTaskId,
  detail: TrimmedNonEmptyString,
  summary: Schema.optional(TrimmedNonEmptyString),
  usage: Schema.optional(Schema.Unknown),
  lastToolName: Schema.optional(TrimmedNonEmptyString),
});

const TaskCompletedActivityPayload = Schema.Struct({
  taskId: RuntimeTaskId,
  taskType: Schema.optional(TrimmedNonEmptyString),
  status: Schema.Literals(["completed", "failed", "stopped"]),
  detail: Schema.optional(TrimmedNonEmptyString),
  usage: Schema.optional(Schema.Unknown),
  precedingToolUseIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});

const ToolActivityPayload = Schema.Struct({
  itemType: Schema.optional(ToolLifecycleItemType),
  itemId: Schema.optional(TrimmedNonEmptyString),
  status: Schema.optional(TrimmedNonEmptyString),
  title: Schema.optional(TrimmedNonEmptyString),
  detail: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Unknown),
});

const ToolSummaryActivityPayload = Schema.Struct({
  summary: TrimmedNonEmptyString,
  precedingToolUseIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});

const ContextWindowUpdatedActivityPayload = ThreadTokenUsageSnapshot;

const ContextCompactionActivityPayload = Schema.Struct({
  state: Schema.Literal("compacted"),
  detail: Schema.optional(Schema.Unknown),
});

const ActivityContentStreamKind = Schema.Literals([
  "assistant_text",
  "reasoning_text",
  "reasoning_summary_text",
  "plan_text",
  "command_output",
  "file_change_output",
  "unknown",
]);

const SubagentIdentityActivityPayloadFields = {
  subagentThreadId: TrimmedNonEmptyString,
  parentThreadId: Schema.optional(TrimmedNonEmptyString),
  parentTurnId: Schema.optional(TurnId),
  parentItemId: Schema.optional(RuntimeItemId),
  agentId: Schema.optional(TrimmedNonEmptyString),
  nickname: Schema.optional(TrimmedNonEmptyString),
  role: Schema.optional(TrimmedNonEmptyString),
  model: Schema.optional(TrimmedNonEmptyString),
  prompt: Schema.optional(TrimmedNonEmptyString),
} as const;

const SubagentIdentityActivityPayload = Schema.Struct(SubagentIdentityActivityPayloadFields);

const SubagentStateChangedActivityPayload = Schema.Struct({
  ...SubagentIdentityActivityPayloadFields,
  state: Schema.Literals(["active", "idle", "archived", "closed", "compacted", "error"]),
  detail: Schema.optional(Schema.Unknown),
});

const SubagentItemActivityPayload = Schema.Struct({
  ...SubagentIdentityActivityPayloadFields,
  itemType: Schema.optional(CanonicalItemType),
  itemId: Schema.optional(TrimmedNonEmptyString),
  status: Schema.optional(TrimmedNonEmptyString),
  title: Schema.optional(TrimmedNonEmptyString),
  detail: Schema.optional(TrimmedNonEmptyString),
  data: Schema.optional(Schema.Unknown),
});

const SubagentContentDeltaActivityPayload = Schema.Struct({
  ...SubagentIdentityActivityPayloadFields,
  streamKind: ActivityContentStreamKind,
  delta: Schema.String,
  itemId: Schema.optional(TrimmedNonEmptyString),
  contentIndex: Schema.optional(Schema.Int),
  summaryIndex: Schema.optional(Schema.Int),
});

const SubagentUsageUpdatedActivityPayload = Schema.Struct({
  ...SubagentIdentityActivityPayloadFields,
  ...ThreadTokenUsageSnapshot.fields,
});

const RuntimeFailureActivityPayload = Schema.Struct({
  detail: TrimmedNonEmptyString,
  messageId: Schema.optional(MessageId),
  requestId: Schema.optional(TrimmedNonEmptyString),
});

const SetupScriptActivityPayload = ActivityUnknownRecord;

const OrchestrationThreadActivityBaseFields = {
  id: EventId,
  tone: OrchestrationThreadActivityTone,
  summary: TrimmedNonEmptyString,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
} as const;

export const OrchestrationThreadActivity = Schema.Union([
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("approval.requested"),
    payload: ApprovalRequestedActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("approval.resolved"),
    payload: ApprovalResolvedActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("user-input.requested"),
    payload: UserInputRequestedActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("user-input.resolved"),
    payload: UserInputResolvedActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("extension-ui.requested"),
    payload: ExtensionUiRequestedActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("extension-ui.resolved"),
    payload: ExtensionUiResolvedActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literals(["runtime.error", "runtime.warning"]),
    payload: RuntimeMessageActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("turn.plan.updated"),
    payload: TurnPlanUpdatedActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("task.started"),
    payload: TaskStartedActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("task.progress"),
    payload: TaskProgressActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("task.completed"),
    payload: TaskCompletedActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literals(["tool.started", "tool.updated", "tool.completed"]),
    payload: ToolActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("tool.summary"),
    payload: ToolSummaryActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("context-window.updated"),
    payload: ContextWindowUpdatedActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("context-compaction"),
    payload: ContextCompactionActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("subagent.thread.started"),
    payload: SubagentIdentityActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("subagent.thread.state.changed"),
    payload: SubagentStateChangedActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literals([
      "subagent.item.started",
      "subagent.item.updated",
      "subagent.item.completed",
    ]),
    payload: SubagentItemActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("subagent.content.delta"),
    payload: SubagentContentDeltaActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literal("subagent.usage.updated"),
    payload: SubagentUsageUpdatedActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literals([
      "runtime.turn.start.failed",
      "runtime.turn.interrupt.failed",
      "runtime.approval.respond.failed",
      "runtime.user-input.respond.failed",
      "runtime.session.stop.failed",
    ]),
    payload: RuntimeFailureActivityPayload,
  }),
  Schema.Struct({
    ...OrchestrationThreadActivityBaseFields,
    kind: Schema.Literals(["setup-script.requested", "setup-script.started", "setup-script.failed"]),
    payload: SetupScriptActivityPayload,
  }),
]);
export type OrchestrationThreadActivity = typeof OrchestrationThreadActivity.Type;

const OrchestrationLatestTurnState = Schema.Literals([
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type OrchestrationLatestTurnState = typeof OrchestrationLatestTurnState.Type;

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationLatestTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
});
export type OrchestrationLatestTurn = typeof OrchestrationLatestTurn.Type;

const OrchestrationChatTimelineRowBaseFields = {
  id: TrimmedNonEmptyString,
  orderKey: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
} as const;

export const OrchestrationChatTimelineMessageRow = Schema.Struct({
  ...OrchestrationChatTimelineRowBaseFields,
  kind: Schema.Literal("message"),
  messageId: MessageId,
  turnId: Schema.NullOr(TurnId),
  entryId: Schema.NullOr(ThreadEntryId),
});
export type OrchestrationChatTimelineMessageRow = typeof OrchestrationChatTimelineMessageRow.Type;

export const OrchestrationChatTimelineWorkRow = Schema.Struct({
  ...OrchestrationChatTimelineRowBaseFields,
  kind: Schema.Literal("work"),
  workId: TrimmedNonEmptyString,
  activityIds: Schema.Array(EventId),
  turnId: Schema.NullOr(TurnId),
  toolCallId: Schema.optional(TrimmedNonEmptyString),
  taskId: Schema.optional(RuntimeTaskId),
});
export type OrchestrationChatTimelineWorkRow = typeof OrchestrationChatTimelineWorkRow.Type;

export const OrchestrationChatTimelineProposedPlanRow = Schema.Struct({
  ...OrchestrationChatTimelineRowBaseFields,
  kind: Schema.Literal("proposed-plan"),
  planId: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
});
export type OrchestrationChatTimelineProposedPlanRow =
  typeof OrchestrationChatTimelineProposedPlanRow.Type;

export const OrchestrationChatTimelineRow = Schema.Union([
  OrchestrationChatTimelineMessageRow,
  OrchestrationChatTimelineWorkRow,
  OrchestrationChatTimelineProposedPlanRow,
]);
export type OrchestrationChatTimelineRow = typeof OrchestrationChatTimelineRow.Type;

export const OrchestrationThread = Schema.Struct({
  id: ThreadId,
  projectId: Schema.NullOr(ProjectId),
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: AgentInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(OrchestrationMessage),
  leafId: Schema.NullOr(ThreadEntryId),
  entries: Schema.Array(OrchestrationThreadEntry),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  activities: Schema.Array(OrchestrationThreadActivity),
  chatTimelineRows: Schema.Array(OrchestrationChatTimelineRow).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  session: Schema.NullOr(OrchestrationSession),
});
export type OrchestrationThread = typeof OrchestrationThread.Type;

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThread),
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationProjectShell = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  projectRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;

export const OrchestrationThreadShell = Schema.Struct({
  id: ThreadId,
  projectId: Schema.NullOr(ProjectId),
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: AgentInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  session: Schema.NullOr(OrchestrationSession),
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  hasActionableProposedPlan: Schema.Boolean,
});
export type OrchestrationThreadShell = typeof OrchestrationThreadShell.Type;

export const OrchestrationShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  threads: Schema.Array(OrchestrationThreadShell),
  updatedAt: IsoDateTime,
});
export type OrchestrationShellSnapshot = typeof OrchestrationShellSnapshot.Type;

export const OrchestrationShellStreamEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("project-upserted"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-removed"),
    sequence: NonNegativeInt,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-upserted"),
    sequence: NonNegativeInt,
    thread: OrchestrationThreadShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-removed"),
    sequence: NonNegativeInt,
    threadId: ThreadId,
  }),
]);
export type OrchestrationShellStreamEvent = typeof OrchestrationShellStreamEvent.Type;

export const OrchestrationShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationShellSnapshot,
  }),
  OrchestrationShellStreamEvent,
]);
export type OrchestrationShellStreamItem = typeof OrchestrationShellStreamItem.Type;

export const OrchestrationSubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type OrchestrationSubscribeThreadInput = typeof OrchestrationSubscribeThreadInput.Type;

export const OrchestrationThreadDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  thread: OrchestrationThread,
});
export type OrchestrationThreadDetailSnapshot = typeof OrchestrationThreadDetailSnapshot.Type;

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  projectRoot: TrimmedNonEmptyString,
  createProjectRootIfMissing: Schema.optional(Schema.Boolean),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  createdAt: IsoDateTime,
});

const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  projectRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
});

const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.delete"),
  commandId: CommandId,
  projectId: ProjectId,
  force: Schema.optional(Schema.Boolean),
});

const ThreadCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.create"),
  commandId: CommandId,
  threadId: ThreadId,
  projectId: Schema.NullOr(ProjectId),
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: AgentInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.delete"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadArchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.archive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnarchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.unarchive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.meta.update"),
  commandId: CommandId,
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

const ThreadRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.runtime-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
});

const ThreadInteractionModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.interaction-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  interactionMode: AgentInteractionMode,
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapCreateThread = Schema.Struct({
  projectId: Schema.NullOr(ProjectId),
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: AgentInteractionMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapPrepareWorktree = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  branch: Schema.optional(TrimmedNonEmptyString),
});

const ThreadTurnStartBootstrap = Schema.Struct({
  createThread: Schema.optional(ThreadTurnStartBootstrapCreateThread),
  prepareWorktree: Schema.optional(ThreadTurnStartBootstrapPrepareWorktree),
  runSetupScript: Schema.optional(Schema.Boolean),
});

export type ThreadTurnStartBootstrap = typeof ThreadTurnStartBootstrap.Type;

export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    richText: Schema.optional(OrchestrationMessageRichText),
    attachments: Schema.Array(ChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: AgentInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_INTERACTION_MODE)),
  ),
  parentEntryId: Schema.optionalKey(Schema.NullOr(ThreadEntryId)),
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ClientThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    richText: Schema.optional(OrchestrationMessageRichText),
    attachments: Schema.Array(UploadChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: AgentInteractionMode,
  parentEntryId: Schema.optionalKey(Schema.NullOr(ThreadEntryId)),
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ThreadTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.interrupt"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.approval.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: RuntimeApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.user-input.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: UserInputAnswers,
  createdAt: IsoDateTime,
});

const ThreadSessionStopCommand = Schema.Struct({
  type: Schema.Literal("thread.session.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

const ThreadTreeNavigateCommand = Schema.Struct({
  type: Schema.Literal("thread.tree.navigate"),
  commandId: CommandId,
  threadId: ThreadId,
  entryId: ThreadEntryId,
  createdAt: IsoDateTime,
});

const ThreadProposedPlanUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.proposed-plan.update"),
  commandId: CommandId,
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
  planMarkdown: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const DispatchableClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadSessionStopCommand,
  ThreadTreeNavigateCommand,
  ThreadProposedPlanUpdateCommand,
]);
export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ClientThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadSessionStopCommand,
  ThreadTreeNavigateCommand,
  ThreadProposedPlanUpdateCommand,
]);
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.session.set"),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  text: Schema.String,
  turnId: TurnId,
  parentEntryId: ThreadEntryId,
  createdAt: IsoDateTime,
});

const ThreadProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.proposed-plan.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
});

const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});

const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadActivityAppendCommand,
]);
export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

export const OrchestrationEventType = Schema.Literals([
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "thread.created",
  "thread.deleted",
  "thread.archived",
  "thread.unarchived",
  "thread.meta-updated",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.turn-start-requested",
  "thread.turn-interrupt-requested",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.session-stop-requested",
  "thread.tree-leaf-moved",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.activity-appended",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals(["project", "thread"]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  projectRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  projectRoot: Schema.optional(TrimmedNonEmptyString),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const ThreadCreatedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: Schema.NullOr(ProjectId),
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: AgentInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
});

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: IsoDateTime,
});

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const ThreadInteractionModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  interactionMode: AgentInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_INTERACTION_MODE)),
  ),
  updatedAt: IsoDateTime,
});

export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  entryId: ThreadEntryId,
  parentEntryId: Schema.NullOr(ThreadEntryId),
  role: OrchestrationMessageRole,
  text: Schema.String,
  richText: Schema.optional(OrchestrationMessageRichText),
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  userEntryId: ThreadEntryId,
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: AgentInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_INTERACTION_MODE)),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: RuntimeApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: UserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadTreeLeafMovedPayload = Schema.Struct({
  threadId: ThreadId,
  leafId: Schema.NullOr(ThreadEntryId),
  updatedAt: IsoDateTime,
});

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
});

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
});

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
});

export const OrchestrationEventMetadata = Schema.Struct({
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
});
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([ProjectId, ThreadId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.created"),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.meta-updated"),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.deleted"),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.created"),
    payload: ThreadCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.deleted"),
    payload: ThreadDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.archived"),
    payload: ThreadArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unarchived"),
    payload: ThreadUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.meta-updated"),
    payload: ThreadMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.runtime-mode-set"),
    payload: ThreadRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.interaction-mode-set"),
    payload: ThreadInteractionModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-sent"),
    payload: ThreadMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-start-requested"),
    payload: ThreadTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-interrupt-requested"),
    payload: ThreadTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.approval-response-requested"),
    payload: ThreadApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.user-input-response-requested"),
    payload: ThreadUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-stop-requested"),
    payload: ThreadSessionStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.tree-leaf-moved"),
    payload: ThreadTreeLeafMovedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-set"),
    payload: ThreadSessionSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.proposed-plan-upserted"),
    payload: ThreadProposedPlanUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.activity-appended"),
    payload: ThreadActivityAppendedPayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

export const OrchestrationThreadStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationThreadDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);
export type OrchestrationThreadStreamItem = typeof OrchestrationThreadStreamItem.Type;

export const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type;

const ProjectionThreadTurnStatus = Schema.Literals([
  "running",
  "completed",
  "interrupted",
  "error",
]);
export type ProjectionThreadTurnStatus = typeof ProjectionThreadTurnStatus.Type;

export const ProjectionPendingApprovalStatus = Schema.Literals(["pending", "resolved"]);
export type ProjectionPendingApprovalStatus = typeof ProjectionPendingApprovalStatus.Type;

export const ProjectionPendingApprovalDecision = Schema.NullOr(RuntimeApprovalDecision);
export type ProjectionPendingApprovalDecision = typeof ProjectionPendingApprovalDecision.Type;

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
  preparedWorktree: Schema.optional(
    Schema.Struct({
      branch: TrimmedNonEmptyString,
      worktreePath: TrimmedNonEmptyString,
    }),
  ),
});
export type DispatchResult = typeof DispatchResult.Type;

export const OrchestrationReplayEventsInput = Schema.Struct({
  fromSequenceExclusive: NonNegativeInt,
});
export type OrchestrationReplayEventsInput = typeof OrchestrationReplayEventsInput.Type;

const OrchestrationReplayEventsResult = Schema.Array(OrchestrationEvent);
export type OrchestrationReplayEventsResult = typeof OrchestrationReplayEventsResult.Type;

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
