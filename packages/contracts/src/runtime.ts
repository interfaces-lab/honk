import { Effect, Schema } from "effect";
import {
  AccountId,
  AuthProviderId,
  EventId,
  IsoDateTime,
  ModelId,
  NonNegativeInt,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./base-schemas";

const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);

export const AgentRuntime = Schema.Literal("pi");
export type AgentRuntime = typeof AgentRuntime.Type;

export const AgentInteractionMode = Schema.Literals(["default", "ask", "plan"]);
export type AgentInteractionMode = typeof AgentInteractionMode.Type;

export const AgentPermissionMode = Schema.Literals([
  "read-only",
  "project-write",
  "danger-full-access",
]);
export type AgentPermissionMode = typeof AgentPermissionMode.Type;

export const AgentThinkingLevel = Schema.Literals(["off", "low", "medium", "high"]);
export type AgentThinkingLevel = typeof AgentThinkingLevel.Type;

export const AgentRuntimeIdentity = Schema.Struct({
  agentRuntime: AgentRuntime,
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
  authProviderId: Schema.optional(AuthProviderId),
  accountId: Schema.optional(AccountId),
  modelId: Schema.optional(ModelId),
});
export type AgentRuntimeIdentity = typeof AgentRuntimeIdentity.Type;

export const AgentModelPolicy = Schema.Struct({
  interactionMode: AgentInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("default" as const)),
  ),
  permissionMode: AgentPermissionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("project-write" as const)),
  ),
  authProviderId: Schema.optional(AuthProviderId),
  accountId: Schema.optional(AccountId),
  modelId: Schema.optional(ModelId),
  thinkingLevel: Schema.optional(AgentThinkingLevel),
  allowedToolNames: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  excludedToolNames: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
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
  accountId: Schema.optional(AccountId),
  state: AgentAuthState,
  label: Schema.optional(TrimmedNonEmptyString),
  message: Schema.optional(Schema.String),
  updatedAt: IsoDateTime,
});
export type AgentAuthStatus = typeof AgentAuthStatus.Type;

export const AgentCredentialKind = Schema.Literals([
  "claude-api-key",
  "codex-oauth",
  "codex-api-key",
  "xai-api-key",
]);
export type AgentCredentialKind = typeof AgentCredentialKind.Type;

export const AgentCredentialPreference = Schema.Struct({
  kind: AgentCredentialKind,
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  label: TrimmedNonEmptyString,
  authProviderId: AuthProviderId,
  accountId: Schema.optional(AccountId),
  state: AgentAuthState.pipe(Schema.withDecodingDefault(Effect.succeed("unknown" as const))),
  message: Schema.optional(Schema.String),
});
export type AgentCredentialPreference = typeof AgentCredentialPreference.Type;

export const AgentPreferences = Schema.Struct({
  modelId: Schema.optional(ModelId),
  interactionMode: AgentInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("default" as const)),
  ),
  permissionMode: AgentPermissionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("project-write" as const)),
  ),
  thinkingLevel: AgentThinkingLevel.pipe(
    Schema.withDecodingDefault(Effect.succeed("medium" as const)),
  ),
  persistSessionTree: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  credentials: Schema.Array(AgentCredentialPreference).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type AgentPreferences = typeof AgentPreferences.Type;
export type AgentPreferencesPatch = Partial<Omit<AgentPreferences, "credentials">> & {
  readonly credentials?: ReadonlyArray<AgentCredentialPreference>;
};

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
  text: Schema.optional(Schema.String),
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
  "session.started",
  "session.ready",
  "session.state.changed",
  "turn.started",
  "turn.completed",
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
  data: Schema.optional(Schema.Unknown),
  raw: Schema.optional(Schema.Unknown),
});
export type AgentRuntimeEvent = typeof AgentRuntimeEvent.Type;

export const ThreadAgentRuntimeStartInput = Schema.Struct({
  threadId: ThreadId,
  cwd: TrimmedNonEmptyString,
  agentDir: Schema.optional(TrimmedNonEmptyString),
  policy: Schema.optional(AgentModelPolicy),
});
export type ThreadAgentRuntimeStartInput = typeof ThreadAgentRuntimeStartInput.Type;

export const ThreadAgentRuntimeSendInput = Schema.Struct({
  threadId: ThreadId,
  input: TrimmedNonEmptyString,
  interactionMode: Schema.optional(AgentInteractionMode),
});
export type ThreadAgentRuntimeSendInput = typeof ThreadAgentRuntimeSendInput.Type;

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

export type MultiRuntimeHostEvent =
  | {
      readonly type: "snapshot";
      readonly snapshot: MultiRuntimeHostSnapshot;
    }
  | {
      readonly type: "runtime-event";
      readonly event: AgentRuntimeEvent;
    }
  | {
      readonly type: "session-tree";
      readonly tree: SessionTreeProjection;
    }
  | {
      readonly type: "pending-extension-ui";
      readonly requests: ReadonlyArray<DesktopExtensionUiRequest>;
    };

export interface MultiRuntimeApi {
  getHostSnapshot: () => Promise<MultiRuntimeHostSnapshot>;
  getPreferences: () => Promise<AgentPreferences>;
  updatePreferences: (patch: AgentPreferencesPatch) => Promise<AgentPreferences>;
  startThread: (input: ThreadAgentRuntimeStartInput) => Promise<AgentRuntimeIdentity>;
  send: (input: ThreadAgentRuntimeSendInput) => Promise<TurnId>;
  respondToExtensionUiRequest: (input: DesktopExtensionUiRespondInput) => Promise<void>;
  onHostEvent: (listener: (event: MultiRuntimeHostEvent) => void) => () => void;
}
