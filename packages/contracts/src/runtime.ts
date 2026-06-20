import { Effect, Schema } from "effect";
import {
  DEFAULT_RUNTIME_MODE,
  ModelSelection,
  RuntimeIngestionRecord,
  RuntimeMode,
  SourceProposedPlanReference,
} from "./orchestration";
import { AgentInteractionMode } from "./interaction-mode";
import {
  AccountId,
  AuthProviderId,
  EventId,
  IsoDateTime,
  MessageId,
  ModelId,
  NonNegativeInt,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./base-schemas";
import { ModelOptionSelections } from "./model";

export {
  AGENT_INTERACTION_MODES,
  AgentInteractionMode,
  DEFAULT_AGENT_INTERACTION_MODE,
} from "./interaction-mode";

const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);

export const AgentRuntime = Schema.Literal("pi");
export type AgentRuntime = typeof AgentRuntime.Type;

export const AGENT_MODES = ["rush", "smart", "deep", "composer"] as const;
export const AgentMode = Schema.Literals(AGENT_MODES);
export type AgentMode = typeof AgentMode.Type;

export const AGENT_THINKING_LEVELS = ["off", "low", "medium", "high", "xhigh"] as const;
export const AGENT_CONFIGURABLE_THINKING_LEVELS = ["medium", "high", "xhigh"] as const;
export const AgentThinkingLevel = Schema.Literals(AGENT_THINKING_LEVELS);
export type AgentThinkingLevel = typeof AgentThinkingLevel.Type;

const AgentPolicyToolNames = Schema.Array(TrimmedNonEmptyString).pipe(
  Schema.withDecodingDefault(Effect.succeed([])),
);

export const AgentPolicyModelSelection = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("pi-managed"),
  }),
  Schema.Struct({
    type: Schema.Literal("explicit"),
    authProviderId: AuthProviderId,
    accountId: AccountId,
    modelId: ModelId,
    options: Schema.optionalKey(ModelOptionSelections),
  }),
]).pipe(Schema.withDecodingDefault(Effect.succeed({ type: "pi-managed" as const })));
export type AgentPolicyModelSelection = typeof AgentPolicyModelSelection.Type;

export const DEFAULT_AGENT_POLICY_MODEL_SELECTION: AgentPolicyModelSelection = {
  type: "explicit",
  authProviderId: AuthProviderId.make("openai-codex"),
  accountId: AccountId.make("openai-codex:default"),
  modelId: ModelId.make("openai-codex/gpt-5.5"),
};

export const AgentModelSettings = Schema.Struct({
  thinkingLevel: Schema.optionalKey(AgentThinkingLevel),
});
export type AgentModelSettings = typeof AgentModelSettings.Type;

export const AgentRuntimeModelDescriptor = Schema.Struct({
  authProviderId: AuthProviderId,
  modelId: ModelId,
  provider: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  reasoning: Schema.Boolean,
  contextWindow: NonNegativeInt,
  thinkingLevels: Schema.Array(AgentThinkingLevel).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type AgentRuntimeModelDescriptor = typeof AgentRuntimeModelDescriptor.Type;

export const AgentModelPolicy = Schema.Struct({
  agentMode: AgentMode.pipe(Schema.withDecodingDefault(Effect.succeed("deep" as const))),
  interactionMode: AgentInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("agent" as const)),
  ),
  modelSelection: AgentPolicyModelSelection,
  fast: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  thinkingLevel: Schema.NullOr(AgentThinkingLevel).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  allowedToolNames: AgentPolicyToolNames,
  excludedToolNames: AgentPolicyToolNames,
});
export type AgentModelPolicy = typeof AgentModelPolicy.Type;

export const AgentAuthState = Schema.Literals([
  "unknown",
  "missing",
  "available",
  "expired",
  "error",
]);
export type AgentAuthState = typeof AgentAuthState.Type;

export const AgentCredentialKind = Schema.Literals([
  "claude-api-key",
  "claude-oauth",
  "codex-oauth",
  "codex-api-key",
]);
export type AgentCredentialKind = typeof AgentCredentialKind.Type;

export const AgentAuthStatus = Schema.Struct({
  authProviderId: AuthProviderId,
  credentialKind: Schema.NullOr(AgentCredentialKind).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  accountId: Schema.NullOr(AccountId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  state: AgentAuthState,
  label: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  message: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  updatedAt: IsoDateTime,
});
export type AgentAuthStatus = typeof AgentAuthStatus.Type;

export const AgentCredentialAuthFlowState = Schema.Literals(["pending", "error"]);
export type AgentCredentialAuthFlowState = typeof AgentCredentialAuthFlowState.Type;

export const AgentCredentialAuthFlowKind = Schema.Literals(["oauth-browser", "oauth-device-code"]);
export type AgentCredentialAuthFlowKind = typeof AgentCredentialAuthFlowKind.Type;

export const AgentCredentialAuthFlow = Schema.Struct({
  authProviderId: AuthProviderId,
  credentialKind: Schema.NullOr(AgentCredentialKind).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  state: AgentCredentialAuthFlowState,
  kind: AgentCredentialAuthFlowKind,
  message: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  verificationUri: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  userCode: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  updatedAt: IsoDateTime,
});
export type AgentCredentialAuthFlow = typeof AgentCredentialAuthFlow.Type;

export const AgentCredentialPreference = Schema.Struct({
  kind: AgentCredentialKind,
  label: TrimmedNonEmptyString,
  authProviderId: AuthProviderId,
  accountId: Schema.NullOr(AccountId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type AgentCredentialPreference = typeof AgentCredentialPreference.Type;

export const DEFAULT_AGENT_CREDENTIAL_PREFERENCES: readonly AgentCredentialPreference[] = [
  {
    kind: "claude-api-key",
    label: "Claude API Key",
    authProviderId: AuthProviderId.make("anthropic"),
    accountId: null,
  },
  {
    kind: "claude-oauth",
    label: "Claude OAuth",
    authProviderId: AuthProviderId.make("anthropic"),
    accountId: null,
  },
  {
    kind: "codex-oauth",
    label: "Codex OAuth",
    authProviderId: AuthProviderId.make("openai-codex"),
    accountId: null,
  },
  {
    kind: "codex-api-key",
    label: "Codex API Key",
    authProviderId: AuthProviderId.make("openai"),
    accountId: null,
  },
];

export const AgentCredentialConfigureInput = Schema.Union([
  Schema.Struct({
    authProviderId: AuthProviderId,
    method: Schema.Literal("api-key"),
    credentialKind: AgentCredentialKind,
    apiKey: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    authProviderId: AuthProviderId,
    method: Schema.Literal("oauth"),
    credentialKind: AgentCredentialKind,
  }),
  Schema.Struct({
    authProviderId: AuthProviderId,
    method: Schema.Literal("logout"),
    credentialKind: AgentCredentialKind,
  }),
]);
export type AgentCredentialConfigureInput = typeof AgentCredentialConfigureInput.Type;

export function isOAuthAgentCredentialKind(credentialKind: AgentCredentialKind): boolean {
  return credentialKind === "claude-oauth" || credentialKind === "codex-oauth";
}

export function agentCredentialKindSupportsConfigureMethod(
  credentialKind: AgentCredentialKind,
  method: AgentCredentialConfigureInput["method"],
): boolean {
  if (method === "logout") {
    return true;
  }
  return method === "oauth"
    ? isOAuthAgentCredentialKind(credentialKind)
    : !isOAuthAgentCredentialKind(credentialKind);
}

export function resolveAgentCredentialPreferenceForConfigure(
  preferences: Pick<AgentPreferences, "credentials">,
  input: Pick<AgentCredentialConfigureInput, "authProviderId" | "credentialKind" | "method">,
): AgentCredentialPreference | null {
  const credential =
    preferences.credentials.find(
      (candidate) =>
        candidate.authProviderId === input.authProviderId &&
        candidate.kind === input.credentialKind,
    ) ?? null;
  if (!credential) {
    return null;
  }
  return agentCredentialKindSupportsConfigureMethod(input.credentialKind, input.method)
    ? credential
    : null;
}

export const AgentResourcePreferences = Schema.Struct({
  workspaceFiles: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  git: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  terminal: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type AgentResourcePreferences = typeof AgentResourcePreferences.Type;
export const DEFAULT_AGENT_RESOURCE_PREFERENCES = {
  workspaceFiles: true,
  git: true,
  terminal: true,
} satisfies AgentResourcePreferences;

export const AgentPreferences = Schema.Struct({
  agentMode: AgentMode.pipe(Schema.withDecodingDefault(Effect.succeed("deep" as const))),
  interactionMode: AgentInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("agent" as const)),
  ),
  modelSelection: AgentPolicyModelSelection.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_POLICY_MODEL_SELECTION)),
  ),
  modelSettingsByModelId: Schema.Record(ModelId, AgentModelSettings).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  fast: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  thinkingLevel: AgentThinkingLevel.pipe(
    Schema.withDecodingDefault(Effect.succeed("high" as const)),
  ),
  resources: AgentResourcePreferences.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_RESOURCE_PREFERENCES)),
  ),
  credentials: Schema.Array(AgentCredentialPreference).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type AgentPreferences = typeof AgentPreferences.Type;

export function createDefaultAgentPreferences(): AgentPreferences {
  return {
    agentMode: "deep",
    interactionMode: "agent",
    modelSelection: { ...DEFAULT_AGENT_POLICY_MODEL_SELECTION },
    modelSettingsByModelId: {},
    fast: false,
    thinkingLevel: "high",
    resources: { ...DEFAULT_AGENT_RESOURCE_PREFERENCES },
    credentials: DEFAULT_AGENT_CREDENTIAL_PREFERENCES.map((credential) => ({ ...credential })),
  };
}

export const DEFAULT_AGENT_PREFERENCES: AgentPreferences = createDefaultAgentPreferences();

export const decodeAgentPreferences = Schema.decodeUnknownSync(AgentPreferences);
export const AgentPreferencesPatch = Schema.Struct({
  agentMode: Schema.optionalKey(AgentMode),
  interactionMode: Schema.optionalKey(AgentInteractionMode),
  modelSelection: Schema.optionalKey(AgentPolicyModelSelection),
  modelSettingsByModelId: Schema.optionalKey(Schema.Record(ModelId, AgentModelSettings)),
  fast: Schema.optionalKey(Schema.Boolean),
  thinkingLevel: Schema.optionalKey(AgentThinkingLevel),
  resources: Schema.optionalKey(AgentResourcePreferences),
  credentials: Schema.optionalKey(Schema.Array(AgentCredentialPreference)),
});
export type AgentPreferencesPatch = typeof AgentPreferencesPatch.Type;

export const DesktopRuntimeDiagnosticState = Schema.Literals(["ready", "warning", "error"]);
export type DesktopRuntimeDiagnosticState = typeof DesktopRuntimeDiagnosticState.Type;

export const DesktopRuntimeDiagnostic = Schema.Struct({
  state: DesktopRuntimeDiagnosticState,
  title: TrimmedNonEmptyString,
  message: Schema.optional(Schema.String),
  updatedAt: IsoDateTime,
});
export type DesktopRuntimeDiagnostic = typeof DesktopRuntimeDiagnostic.Type;

export const SessionTreeEntryKind = Schema.Literals([
  "message",
  "model-change",
  "thinking-level-change",
  "compaction",
  "branch-summary",
  "custom",
  "custom-message",
  "label",
  "session-info",
]);
export type SessionTreeEntryKind = typeof SessionTreeEntryKind.Type;

export const SessionMessageRole = Schema.Literals([
  "user",
  "assistant",
  "system",
  "toolResult",
  "custom",
]);
export type SessionMessageRole = typeof SessionMessageRole.Type;

export const SessionTreeEntry = Schema.Struct({
  id: RuntimeItemId,
  threadEntryId: ThreadEntryId,
  parentId: Schema.NullOr(RuntimeItemId),
  parentThreadEntryId: Schema.NullOr(ThreadEntryId),
  kind: SessionTreeEntryKind,
  role: Schema.optional(SessionMessageRole),
  clientMessageId: Schema.optional(MessageId),
  turnId: Schema.optional(TurnId),
  text: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
  rawEntry: UnknownRecord,
});
export type SessionTreeEntry = typeof SessionTreeEntry.Type;

export const SessionTreeNode = Schema.Struct({
  entryId: RuntimeItemId,
  threadEntryId: ThreadEntryId,
  parentEntryId: Schema.NullOr(RuntimeItemId),
  depth: NonNegativeInt,
  isActivePath: Schema.Boolean,
  isActiveLeaf: Schema.Boolean,
  childCount: NonNegativeInt,
});
export type SessionTreeNode = typeof SessionTreeNode.Type;

export const SessionTreeProjection = Schema.Struct({
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
  leafEntryId: Schema.NullOr(RuntimeItemId),
  entries: Schema.Array(SessionTreeEntry),
  nodes: Schema.Array(SessionTreeNode),
});
export type SessionTreeProjection = typeof SessionTreeProjection.Type;

// The durable assistant message id for a runtime session entry. Minted at ingestion when the
// assistant message is persisted, and re-derived by the app timeline projector to alias hydrated
// runtime display items back to the committed message. Both sides must use this exact format —
// a mismatch renders the same assistant text twice.
export function runtimeSessionEntryMessageId(
  runtimeSessionId: RuntimeSessionId,
  entryId: string,
): MessageId {
  return MessageId.make(`runtime:${runtimeSessionId}:${entryId}`);
}

export const AgentRuntimeEventType = Schema.Literals([
  "agent.started",
  "agent.completed",
  "session.started",
  "session.ready",
  "session.state.changed",
  "turn.started",
  "turn.interrupted",
  "turn.completed",
  "turn.proposed.completed",
  "message.started",
  "message.updated",
  "message.completed",
  "tool.started",
  "tool.updated",
  "tool.completed",
  "queue.updated",
  "model.changed",
  "thinking.changed",
  "tree.updated",
  "context-window.updated",
  "extension-ui.requested",
  "extension-ui.resolved",
  "auth.status",
  "runtime.warning",
  "runtime.error",
]);
export type AgentRuntimeEventType = typeof AgentRuntimeEventType.Type;

export const AgentRuntimeEvent = Schema.Struct({
  id: EventId,
  type: AgentRuntimeEventType,
  agentRuntime: AgentRuntime,
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
  summary: Schema.optional(Schema.String),
  messageRole: Schema.optional(SessionMessageRole),
  text: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Unknown),
  raw: Schema.optional(Schema.Unknown),
});
export type AgentRuntimeEvent = typeof AgentRuntimeEvent.Type;

const AGENT_RUNTIME_IMAGE_DATA_URL_MAX_CHARS = 14_000_000;
const AGENT_RUNTIME_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const ThreadAgentRuntimeImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(AGENT_RUNTIME_IMAGE_MAX_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(AGENT_RUNTIME_IMAGE_DATA_URL_MAX_CHARS)),
});
export type ThreadAgentRuntimeImageAttachment = typeof ThreadAgentRuntimeImageAttachment.Type;

export const ThreadAgentRuntimeSendTurnInput = Schema.Struct({
  threadId: ThreadId,
  cwd: TrimmedNonEmptyString,
  input: TrimmedNonEmptyString,
  interactionMode: AgentInteractionMode,
  sourceProposedPlan: Schema.NullOr(SourceProposedPlanReference),
  clientMessageId: MessageId,
  /**
   * User message this send revises. The runtime branches the pi session so the
   * new message becomes a sibling of the revised one when parentEntryId points
   * at the revised message's parent.
   */
  replacesClientMessageId: Schema.optional(Schema.NullOr(MessageId)),
  /**
   * Thread tree entry this send appends under. This is the canonical branch
   * point shared by orchestration and the runtime session tree.
   */
  parentEntryId: Schema.optional(Schema.NullOr(ThreadEntryId)),
  images: Schema.Array(ThreadAgentRuntimeImageAttachment),
  policy: AgentModelPolicy,
  modelSelection: ModelSelection,
  streamingBehavior: Schema.optionalKey(Schema.Literals(["steer", "followUp"])),
});
export type ThreadAgentRuntimeSendTurnInput = typeof ThreadAgentRuntimeSendTurnInput.Type;

export const ThreadAgentRuntimeQueuedFollowUp = Schema.Struct({
  threadId: ThreadId,
  cwd: TrimmedNonEmptyString,
  input: TrimmedNonEmptyString,
  interactionMode: AgentInteractionMode,
  sourceProposedPlan: Schema.NullOr(SourceProposedPlanReference),
  clientMessageId: MessageId,
  replacesClientMessageId: Schema.NullOr(MessageId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  parentEntryId: Schema.optionalKey(Schema.NullOr(ThreadEntryId)),
  images: Schema.Array(ThreadAgentRuntimeImageAttachment),
  policy: AgentModelPolicy,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  titleSeed: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type ThreadAgentRuntimeQueuedFollowUp = typeof ThreadAgentRuntimeQueuedFollowUp.Type;

export const ThreadAgentRuntimeQueueFollowUpInput = ThreadAgentRuntimeQueuedFollowUp;
export type ThreadAgentRuntimeQueueFollowUpInput = typeof ThreadAgentRuntimeQueueFollowUpInput.Type;

export const ThreadAgentRuntimeUpdateQueuedFollowUpInput = ThreadAgentRuntimeQueuedFollowUp;
export type ThreadAgentRuntimeUpdateQueuedFollowUpInput =
  typeof ThreadAgentRuntimeUpdateQueuedFollowUpInput.Type;

export const ThreadAgentRuntimeQueuedFollowUpIdInput = Schema.Struct({
  threadId: ThreadId,
  clientMessageId: MessageId,
});
export type ThreadAgentRuntimeQueuedFollowUpIdInput =
  typeof ThreadAgentRuntimeQueuedFollowUpIdInput.Type;

export const ThreadAgentRuntimeReorderQueuedFollowUpInput = Schema.Struct({
  threadId: ThreadId,
  clientMessageId: MessageId,
  targetClientMessageId: Schema.NullOr(MessageId),
  insertAfter: Schema.Boolean,
});
export type ThreadAgentRuntimeReorderQueuedFollowUpInput =
  typeof ThreadAgentRuntimeReorderQueuedFollowUpInput.Type;

export const ThreadAgentRuntimeHydrateInput = Schema.Struct({
  threadId: ThreadId,
  cwd: TrimmedNonEmptyString,
  policy: AgentModelPolicy,
});
export type ThreadAgentRuntimeHydrateInput = typeof ThreadAgentRuntimeHydrateInput.Type;

export const ThreadAgentRuntimeCloneInput = Schema.Struct({
  sourceThreadId: ThreadId,
  targetThreadId: ThreadId,
  cwd: TrimmedNonEmptyString,
  policy: AgentModelPolicy,
});
export type ThreadAgentRuntimeCloneInput = typeof ThreadAgentRuntimeCloneInput.Type;

export const ThreadAgentRuntimeCompactInput = Schema.Struct({
  threadId: ThreadId,
  cwd: TrimmedNonEmptyString,
  customInstructions: Schema.optional(Schema.String),
  policy: AgentModelPolicy,
});
export type ThreadAgentRuntimeCompactInput = typeof ThreadAgentRuntimeCompactInput.Type;

export const ThreadAgentRuntimeSetThreadFocusInput = Schema.Struct({
  threadId: ThreadId,
  focused: Schema.Boolean,
});
export type ThreadAgentRuntimeSetThreadFocusInput =
  typeof ThreadAgentRuntimeSetThreadFocusInput.Type;

export const SUBAGENT_MODES = ["single", "parallel", "chain"] as const;
export const SubagentMode = Schema.Literals(SUBAGENT_MODES);
export type SubagentMode = typeof SubagentMode.Type;

export const SUBAGENT_RUN_STATES = ["running", "completed", "failed", "aborted"] as const;
export const SubagentRunState = Schema.Literals(SUBAGENT_RUN_STATES);
export type SubagentRunState = typeof SubagentRunState.Type;

export const SUBAGENT_ACTIVITY_KINDS = [
  "subagent.thread.started",
  "subagent.thread.state.changed",
  "subagent.item.started",
  "subagent.item.updated",
  "subagent.item.completed",
] as const;
export const SubagentActivityKind = Schema.Literals(SUBAGENT_ACTIVITY_KINDS);
export type SubagentActivityKind = typeof SubagentActivityKind.Type;

export const SubagentActivityPayload = Schema.Struct({
  subagentThreadId: TrimmedNonEmptyString,
  parentThreadId: TrimmedNonEmptyString,
  parentItemId: TrimmedNonEmptyString,
  agentId: TrimmedNonEmptyString,
  nickname: TrimmedNonEmptyString,
  role: TrimmedNonEmptyString,
  model: Schema.NullOr(Schema.String),
  prompt: TrimmedNonEmptyString,
  state: Schema.NullOr(SubagentRunState),
  itemType: Schema.NullOr(Schema.String),
  itemId: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
  data: Schema.Unknown,
});
export type SubagentActivityPayload = typeof SubagentActivityPayload.Type;

export const SubagentActivityDetails = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: SubagentActivityKind,
  tone: Schema.Literals(["info", "tool", "error"] as const),
  summary: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  sequence: NonNegativeInt,
  payload: SubagentActivityPayload,
});
export type SubagentActivityDetails = typeof SubagentActivityDetails.Type;

export const SubagentRunSnapshot = Schema.Struct({
  subagentThreadId: TrimmedNonEmptyString,
  agentId: TrimmedNonEmptyString,
  nickname: TrimmedNonEmptyString,
  role: TrimmedNonEmptyString,
  model: Schema.NullOr(Schema.String),
  prompt: TrimmedNonEmptyString,
  state: SubagentRunState,
  finalText: Schema.NullOr(Schema.String),
  errorMessage: Schema.NullOr(Schema.String),
});
export type SubagentRunSnapshot = typeof SubagentRunSnapshot.Type;

export const SubagentToolDetails = Schema.Struct({
  mode: SubagentMode,
  runs: Schema.Array(SubagentRunSnapshot),
  activities: Schema.Array(SubagentActivityDetails),
});
export type SubagentToolDetails = typeof SubagentToolDetails.Type;

export const ThreadAgentRuntimeAbortInput = Schema.Struct({
  threadId: ThreadId,
});
export type ThreadAgentRuntimeAbortInput = typeof ThreadAgentRuntimeAbortInput.Type;

export const DesktopExtensionUiRequestKind = Schema.Literals([
  "select",
  "confirm",
  "input",
  "editor",
  "question",
  "custom",
]);
export type DesktopExtensionUiRequestKind = typeof DesktopExtensionUiRequestKind.Type;

export const DesktopExtensionUiQuestionOption = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
});
export type DesktopExtensionUiQuestionOption = typeof DesktopExtensionUiQuestionOption.Type;

export const DesktopExtensionUiQuestion = Schema.Struct({
  id: TrimmedNonEmptyString,
  text: TrimmedNonEmptyString,
  options: Schema.Array(DesktopExtensionUiQuestionOption),
  allowMultiple: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type DesktopExtensionUiQuestion = typeof DesktopExtensionUiQuestion.Type;

export const DesktopExtensionUiRequest = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
  kind: DesktopExtensionUiRequestKind,
  title: TrimmedNonEmptyString,
  message: Schema.optional(Schema.String),
  placeholder: Schema.optional(Schema.String),
  options: Schema.optional(Schema.Array(Schema.String)),
  questions: Schema.optional(Schema.Array(DesktopExtensionUiQuestion)),
  timeout: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type DesktopExtensionUiRequest = typeof DesktopExtensionUiRequest.Type;

export const DesktopExtensionUiRespondInput = Schema.Struct({
  threadId: ThreadId,
  requestId: TrimmedNonEmptyString,
  value: Schema.Unknown,
});
export type DesktopExtensionUiRespondInput = typeof DesktopExtensionUiRespondInput.Type;

const RuntimeDisplayTimelineItemBaseFields = {
  id: TrimmedNonEmptyString,
  orderKey: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
} as const;

export const RuntimeDisplayTimelineToolStatus = Schema.Literals(["running", "completed", "error"]);
export type RuntimeDisplayTimelineToolStatus = typeof RuntimeDisplayTimelineToolStatus.Type;

export const RuntimeDisplayTimelineExtensionUiStatus = Schema.Literals(["pending", "resolved"]);
export type RuntimeDisplayTimelineExtensionUiStatus =
  typeof RuntimeDisplayTimelineExtensionUiStatus.Type;

const RuntimeDisplayTimelineBashToolDisplay = Schema.Struct({
  kind: Schema.Literal("bash"),
  command: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
  exitCode: Schema.optional(NonNegativeInt),
});

const RuntimeDisplayTimelineReadToolDisplay = Schema.Struct({
  kind: Schema.Literal("read"),
  path: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
  startLine: Schema.optional(NonNegativeInt),
  endLine: Schema.optional(NonNegativeInt),
});

const RuntimeDisplayTimelineGrepToolDisplay = Schema.Struct({
  kind: Schema.Literal("grep"),
  query: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
  matchedFiles: Schema.optional(Schema.Array(Schema.String)),
  totalMatched: Schema.optional(NonNegativeInt),
  totalIndexedFiles: Schema.optional(NonNegativeInt),
});

const RuntimeDisplayTimelineFindToolDisplay = Schema.Struct({
  kind: Schema.Literal("find"),
  query: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
  totalMatched: Schema.optional(NonNegativeInt),
  totalIndexedFiles: Schema.optional(NonNegativeInt),
  hasMore: Schema.optional(Schema.Boolean),
});

const RuntimeDisplayTimelineEditToolDisplay = Schema.Struct({
  kind: Schema.Literal("edit"),
  path: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
  additions: Schema.optional(NonNegativeInt),
  deletions: Schema.optional(NonNegativeInt),
  /** Unified diff of the applied change (runtime tool-result `details.patch`/`details.diff`). */
  diff: Schema.optional(Schema.String),
});

const RuntimeDisplayTimelineMcpToolDisplay = Schema.Struct({
  kind: Schema.Literal("mcp"),
  providerIdentifier: Schema.optional(Schema.String),
});

const RuntimeDisplayTimelineSubagentToolDisplay = Schema.Struct({
  kind: Schema.Literal("subagent"),
  mode: SubagentMode,
  runs: Schema.Array(SubagentRunSnapshot),
  activities: Schema.Array(SubagentActivityDetails),
});

const RuntimeDisplayTimelineUnknownToolDisplay = Schema.Struct({
  kind: Schema.Literal("unknown"),
  toolName: TrimmedNonEmptyString,
  output: Schema.optional(Schema.String),
});

export const RuntimeDisplayTimelineToolDisplay = Schema.Union([
  RuntimeDisplayTimelineBashToolDisplay,
  RuntimeDisplayTimelineReadToolDisplay,
  RuntimeDisplayTimelineGrepToolDisplay,
  RuntimeDisplayTimelineFindToolDisplay,
  RuntimeDisplayTimelineEditToolDisplay,
  RuntimeDisplayTimelineMcpToolDisplay,
  RuntimeDisplayTimelineSubagentToolDisplay,
  RuntimeDisplayTimelineUnknownToolDisplay,
]);
export type RuntimeDisplayTimelineToolDisplay = typeof RuntimeDisplayTimelineToolDisplay.Type;

export const RuntimeDisplayTimelineMessageItem = Schema.Struct({
  ...RuntimeDisplayTimelineItemBaseFields,
  kind: Schema.Literal("message"),
  source: Schema.Literals(["session-entry", "live-event"]),
  entryId: Schema.optional(RuntimeItemId),
  threadEntryId: Schema.optional(ThreadEntryId),
  parentEntryId: Schema.optional(Schema.NullOr(RuntimeItemId)),
  parentThreadEntryId: Schema.optional(Schema.NullOr(ThreadEntryId)),
  role: SessionMessageRole,
  turnId: Schema.optional(TurnId),
  clientMessageId: Schema.optional(MessageId),
  eventIds: Schema.Array(EventId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  streaming: Schema.optional(Schema.Boolean),
  text: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.String),
});
export type RuntimeDisplayTimelineMessageItem = typeof RuntimeDisplayTimelineMessageItem.Type;

export const RuntimeDisplayTimelineToolItem = Schema.Struct({
  ...RuntimeDisplayTimelineItemBaseFields,
  kind: Schema.Literal("tool"),
  toolCallId: TrimmedNonEmptyString,
  toolName: TrimmedNonEmptyString,
  turnId: Schema.optional(TurnId),
  status: RuntimeDisplayTimelineToolStatus,
  eventIds: Schema.Array(EventId),
  args: Schema.optional(Schema.Unknown),
  argsComplete: Schema.optional(Schema.Boolean),
  executionStarted: Schema.optional(Schema.Boolean),
  isPartial: Schema.optional(Schema.Boolean),
  isError: Schema.optional(Schema.Boolean),
  result: Schema.optional(Schema.Unknown),
  details: Schema.optional(Schema.Unknown),
  summary: Schema.optional(Schema.String),
  shortDescription: Schema.optional(Schema.String),
  display: RuntimeDisplayTimelineToolDisplay,
  command: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
});
export type RuntimeDisplayTimelineToolItem = typeof RuntimeDisplayTimelineToolItem.Type;

export const RuntimeDisplayTimelineExtensionUiRequestItem = Schema.Struct({
  ...RuntimeDisplayTimelineItemBaseFields,
  kind: Schema.Literal("extension-ui-request"),
  requestId: TrimmedNonEmptyString,
  requestKind: DesktopExtensionUiRequestKind,
  status: RuntimeDisplayTimelineExtensionUiStatus,
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
  eventIds: Schema.Array(EventId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  title: TrimmedNonEmptyString,
  message: Schema.optional(Schema.String),
  placeholder: Schema.optional(Schema.String),
  options: Schema.optional(Schema.Array(Schema.String)),
  value: Schema.optional(Schema.Unknown),
  turnId: Schema.optional(TurnId),
});
export type RuntimeDisplayTimelineExtensionUiRequestItem =
  typeof RuntimeDisplayTimelineExtensionUiRequestItem.Type;

export const RuntimeDisplayTimelineProposedPlanItem = Schema.Struct({
  ...RuntimeDisplayTimelineItemBaseFields,
  kind: Schema.Literal("proposed-plan"),
  planId: TrimmedNonEmptyString,
  turnId: Schema.optional(TurnId),
  planMarkdown: Schema.String,
  summary: Schema.optional(Schema.String),
});
export type RuntimeDisplayTimelineProposedPlanItem =
  typeof RuntimeDisplayTimelineProposedPlanItem.Type;

export const RuntimeDisplayTimelineItem = Schema.Union([
  RuntimeDisplayTimelineMessageItem,
  RuntimeDisplayTimelineToolItem,
  RuntimeDisplayTimelineExtensionUiRequestItem,
  RuntimeDisplayTimelineProposedPlanItem,
]);
export type RuntimeDisplayTimelineItem = typeof RuntimeDisplayTimelineItem.Type;

export const RuntimeDisplayTimelineProjection = Schema.Struct({
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
  items: Schema.Array(RuntimeDisplayTimelineItem),
});
export type RuntimeDisplayTimelineProjection = typeof RuntimeDisplayTimelineProjection.Type;

export const RuntimeThreadIdentity = Schema.Struct({
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
  authProviderId: Schema.NullOr(AuthProviderId),
  modelId: Schema.NullOr(ModelId),
});
export type RuntimeThreadIdentity = typeof RuntimeThreadIdentity.Type;

export const HonkRuntimeHostSnapshot = Schema.Struct({
  preferences: AgentPreferences,
  runtimeIdentities: Schema.Array(RuntimeThreadIdentity).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  models: Schema.Array(AgentRuntimeModelDescriptor).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  authStatuses: Schema.Array(AgentAuthStatus).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  credentialAuthFlows: Schema.Array(AgentCredentialAuthFlow).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  diagnostics: Schema.Array(DesktopRuntimeDiagnostic).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  runtimeEvents: Schema.Array(AgentRuntimeEvent).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  sessionTrees: Schema.Array(SessionTreeProjection).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  displayTimelines: Schema.Array(RuntimeDisplayTimelineProjection).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  pendingExtensionUiRequests: Schema.Array(DesktopExtensionUiRequest).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  queuedFollowUps: Schema.Array(ThreadAgentRuntimeQueuedFollowUp).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type HonkRuntimeHostSnapshot = typeof HonkRuntimeHostSnapshot.Type;
const decodeHonkRuntimeHostSnapshotValue = Schema.decodeUnknownSync(HonkRuntimeHostSnapshot);

export const HonkRuntimeHostEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    snapshot: HonkRuntimeHostSnapshot,
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-event"),
    event: AgentRuntimeEvent,
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-identities"),
    identities: Schema.Array(RuntimeThreadIdentity),
    authStatuses: Schema.Array(AgentAuthStatus),
  }),
  Schema.Struct({
    type: Schema.Literal("session-tree"),
    tree: SessionTreeProjection,
  }),
  Schema.Struct({
    type: Schema.Literal("display-timeline"),
    timeline: RuntimeDisplayTimelineProjection,
  }),
  Schema.Struct({
    type: Schema.Literal("pending-extension-ui"),
    requests: Schema.Array(DesktopExtensionUiRequest),
  }),
  Schema.Struct({
    type: Schema.Literal("queued-follow-ups"),
    items: Schema.Array(ThreadAgentRuntimeQueuedFollowUp),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-ingestion-records"),
    records: Schema.Array(RuntimeIngestionRecord),
  }),
  Schema.Struct({
    type: Schema.Literal("credential-auth-flows"),
    flows: Schema.Array(AgentCredentialAuthFlow),
  }),
]);
export type HonkRuntimeHostEvent = typeof HonkRuntimeHostEvent.Type;
const decodeHonkRuntimeHostEventValue = Schema.decodeUnknownSync(HonkRuntimeHostEvent);

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateLegacyRuntimeDisplay(display: unknown): unknown {
  if (!isUnknownRecord(display) || display.kind !== "shell") {
    return display;
  }
  return {
    ...display,
    kind: "bash",
  };
}

function migrateLegacyRuntimeDisplayTimelineItem(item: unknown): unknown {
  if (!isUnknownRecord(item) || item.kind !== "tool") {
    return item;
  }
  return {
    ...item,
    display: migrateLegacyRuntimeDisplay(item.display),
  };
}

function migrateLegacyRuntimeDisplayTimeline(timeline: unknown): unknown {
  if (!isUnknownRecord(timeline) || !Array.isArray(timeline.items)) {
    return timeline;
  }
  return {
    ...timeline,
    items: timeline.items.map(migrateLegacyRuntimeDisplayTimelineItem),
  };
}

export function migrateLegacyRuntimeHostSnapshotInput(value: unknown): unknown {
  if (!isUnknownRecord(value) || !Array.isArray(value.displayTimelines)) {
    return value;
  }
  return {
    ...value,
    displayTimelines: value.displayTimelines.map(migrateLegacyRuntimeDisplayTimeline),
  };
}

export function migrateLegacyRuntimeHostEventInput(value: unknown): unknown {
  if (!isUnknownRecord(value)) {
    return value;
  }
  if (value.type === "snapshot") {
    return {
      ...value,
      snapshot: migrateLegacyRuntimeHostSnapshotInput(value.snapshot),
    };
  }
  if (value.type === "display-timeline") {
    return {
      ...value,
      timeline: migrateLegacyRuntimeDisplayTimeline(value.timeline),
    };
  }
  return value;
}

export function decodeHonkRuntimeHostSnapshot(value: unknown): HonkRuntimeHostSnapshot {
  return decodeHonkRuntimeHostSnapshotValue(migrateLegacyRuntimeHostSnapshotInput(value));
}

export function decodeHonkRuntimeHostEvent(value: unknown): HonkRuntimeHostEvent {
  return decodeHonkRuntimeHostEventValue(migrateLegacyRuntimeHostEventInput(value));
}

export const RuntimeSkillSummary = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  filePath: Schema.String,
  scope: Schema.Literals(["user", "project"]),
});
export type RuntimeSkillSummary = typeof RuntimeSkillSummary.Type;

export const RuntimeListSkillsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type RuntimeListSkillsInput = typeof RuntimeListSkillsInput.Type;

export const RuntimeListSkillsResult = Schema.Struct({
  skills: Schema.Array(RuntimeSkillSummary),
});
export type RuntimeListSkillsResult = typeof RuntimeListSkillsResult.Type;

export const RuntimeGetThreadSessionFileInput = Schema.Struct({
  threadId: ThreadId,
});
export type RuntimeGetThreadSessionFileInput = typeof RuntimeGetThreadSessionFileInput.Type;

export const RuntimeGetThreadSessionFileResult = Schema.Struct({
  path: Schema.NullOr(Schema.String),
});
export type RuntimeGetThreadSessionFileResult = typeof RuntimeGetThreadSessionFileResult.Type;

export interface HonkRuntimeApi {
  getHostSnapshot: () => Promise<HonkRuntimeHostSnapshot>;
  getPreferences: () => Promise<AgentPreferences>;
  updatePreferences: (patch: AgentPreferencesPatch) => Promise<AgentPreferences>;
  configureCredential: (input: AgentCredentialConfigureInput) => Promise<HonkRuntimeHostSnapshot>;
  hydrateThread: (input: ThreadAgentRuntimeHydrateInput) => Promise<void>;
  cloneThread: (input: ThreadAgentRuntimeCloneInput) => Promise<void>;
  compactThread: (input: ThreadAgentRuntimeCompactInput) => Promise<void>;
  setThreadFocus: (input: ThreadAgentRuntimeSetThreadFocusInput) => Promise<void>;
  sendTurn: (input: ThreadAgentRuntimeSendTurnInput) => Promise<TurnId>;
  enqueueFollowUp: (input: ThreadAgentRuntimeQueueFollowUpInput) => Promise<void>;
  updateQueuedFollowUp: (input: ThreadAgentRuntimeUpdateQueuedFollowUpInput) => Promise<void>;
  removeQueuedFollowUp: (input: ThreadAgentRuntimeQueuedFollowUpIdInput) => Promise<void>;
  reorderQueuedFollowUp: (input: ThreadAgentRuntimeReorderQueuedFollowUpInput) => Promise<void>;
  sendQueuedFollowUpNow: (input: ThreadAgentRuntimeQueuedFollowUpIdInput) => Promise<void>;
  abort: (input: ThreadAgentRuntimeAbortInput) => Promise<void>;
  respondToExtensionUiRequest: (input: DesktopExtensionUiRespondInput) => Promise<void>;
  listSkills: (input: RuntimeListSkillsInput) => Promise<RuntimeListSkillsResult>;
  getThreadSessionFile: (
    input: RuntimeGetThreadSessionFileInput,
  ) => Promise<RuntimeGetThreadSessionFileResult>;
  onHostEvent: (listener: (event: HonkRuntimeHostEvent) => void) => () => void;
}
