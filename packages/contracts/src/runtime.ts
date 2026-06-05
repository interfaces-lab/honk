import { Effect, Schema } from "effect";
import { SourceProposedPlanReference } from "./orchestration";
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

export {
  AGENT_INTERACTION_MODES,
  AgentInteractionMode,
  DEFAULT_AGENT_INTERACTION_MODE,
} from "./interaction-mode";

const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);

export const AgentRuntime = Schema.Literal("pi");
export type AgentRuntime = typeof AgentRuntime.Type;

export const AGENT_MODES = ["rush", "smart", "deep"] as const;
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
  }),
]).pipe(Schema.withDecodingDefault(Effect.succeed({ type: "pi-managed" as const })));
export type AgentPolicyModelSelection = typeof AgentPolicyModelSelection.Type;

export const AgentModelPolicy = Schema.Struct({
  agentMode: AgentMode.pipe(Schema.withDecodingDefault(Effect.succeed("deep" as const))),
  interactionMode: AgentInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("agent" as const)),
  ),
  modelSelection: AgentPolicyModelSelection,
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

export const AgentAuthStatus = Schema.Struct({
  authProviderId: AuthProviderId,
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

export const AgentCredentialAuthFlowKind = Schema.Literals([
  "oauth-browser",
  "oauth-device-code",
]);
export type AgentCredentialAuthFlowKind = typeof AgentCredentialAuthFlowKind.Type;

export const AgentCredentialAuthFlow = Schema.Struct({
  authProviderId: AuthProviderId,
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

export const AgentCredentialKind = Schema.Literals([
  "claude-api-key",
  "codex-oauth",
  "codex-api-key",
  "xai-api-key",
]);
export type AgentCredentialKind = typeof AgentCredentialKind.Type;

export const AgentCredentialPreference = Schema.Struct({
  kind: AgentCredentialKind,
  label: TrimmedNonEmptyString,
  authProviderId: AuthProviderId,
  accountId: Schema.NullOr(AccountId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type AgentCredentialPreference = typeof AgentCredentialPreference.Type;

export const AgentCredentialConfigureInput = Schema.Union([
  Schema.Struct({
    authProviderId: AuthProviderId,
    method: Schema.Literal("api-key"),
    apiKey: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    authProviderId: AuthProviderId,
    method: Schema.Literal("oauth"),
  }),
  Schema.Struct({
    authProviderId: AuthProviderId,
    method: Schema.Literal("logout"),
  }),
]);
export type AgentCredentialConfigureInput = typeof AgentCredentialConfigureInput.Type;

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
export const AgentPreferencesPatch = Schema.Struct({
  agentMode: Schema.optionalKey(AgentMode),
  interactionMode: Schema.optionalKey(AgentInteractionMode),
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
export type ThreadAgentRuntimeImageAttachment =
  typeof ThreadAgentRuntimeImageAttachment.Type;

export const ThreadAgentRuntimeSendTurnInput = Schema.Struct({
  threadId: ThreadId,
  cwd: TrimmedNonEmptyString,
  input: TrimmedNonEmptyString,
  interactionMode: AgentInteractionMode,
  sourceProposedPlan: Schema.NullOr(SourceProposedPlanReference),
  clientMessageId: MessageId,
  images: Schema.Array(ThreadAgentRuntimeImageAttachment),
  policy: AgentModelPolicy,
});
export type ThreadAgentRuntimeSendTurnInput = typeof ThreadAgentRuntimeSendTurnInput.Type;

export const SUBAGENT_MODES = ["single", "parallel", "chain"] as const;
export const SubagentMode = Schema.Literals(SUBAGENT_MODES);
export type SubagentMode = typeof SubagentMode.Type;

export const SUBAGENT_SCOPES = ["user", "project", "both"] as const;
export const SubagentScope = Schema.Literals(SUBAGENT_SCOPES);
export type SubagentScope = typeof SubagentScope.Type;

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
  agentScope: SubagentScope,
  projectAgentsDir: Schema.NullOr(Schema.String),
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
  "custom",
]);
export type DesktopExtensionUiRequestKind = typeof DesktopExtensionUiRequestKind.Type;

export const DesktopExtensionUiRequest = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
  kind: DesktopExtensionUiRequestKind,
  title: TrimmedNonEmptyString,
  message: Schema.optional(Schema.String),
  placeholder: Schema.optional(Schema.String),
  options: Schema.optional(Schema.Array(Schema.String)),
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

export const MultiRuntimeHostSnapshot = Schema.Struct({
  preferences: AgentPreferences,
  authStatuses: Schema.Array(AgentAuthStatus).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  credentialAuthFlows: Schema.Array(AgentCredentialAuthFlow).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  diagnostics: Schema.Array(DesktopRuntimeDiagnostic).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  runtimeEvents: Schema.Array(AgentRuntimeEvent).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  sessionTrees: Schema.Array(SessionTreeProjection).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  pendingExtensionUiRequests: Schema.Array(DesktopExtensionUiRequest).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type MultiRuntimeHostSnapshot = typeof MultiRuntimeHostSnapshot.Type;

export const MultiRuntimeHostEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    snapshot: MultiRuntimeHostSnapshot,
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-event"),
    event: AgentRuntimeEvent,
  }),
  Schema.Struct({
    type: Schema.Literal("session-tree"),
    tree: SessionTreeProjection,
  }),
  Schema.Struct({
    type: Schema.Literal("pending-extension-ui"),
    requests: Schema.Array(DesktopExtensionUiRequest),
  }),
  Schema.Struct({
    type: Schema.Literal("credential-auth-flows"),
    flows: Schema.Array(AgentCredentialAuthFlow),
  }),
]);
export type MultiRuntimeHostEvent = typeof MultiRuntimeHostEvent.Type;

export interface MultiRuntimeApi {
  getHostSnapshot: () => Promise<MultiRuntimeHostSnapshot>;
  getPreferences: () => Promise<AgentPreferences>;
  updatePreferences: (patch: AgentPreferencesPatch) => Promise<AgentPreferences>;
  configureCredential: (
    input: AgentCredentialConfigureInput,
  ) => Promise<MultiRuntimeHostSnapshot>;
  sendTurn: (input: ThreadAgentRuntimeSendTurnInput) => Promise<TurnId>;
  abort: (input: ThreadAgentRuntimeAbortInput) => Promise<void>;
  respondToExtensionUiRequest: (input: DesktopExtensionUiRespondInput) => Promise<void>;
  onHostEvent: (listener: (event: MultiRuntimeHostEvent) => void) => () => void;
}
