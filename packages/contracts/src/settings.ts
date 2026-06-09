import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString, TrimmedString } from "./base-schemas";
import { ModelOptionSelections } from "./model";
import { ModelSelection, ModelSelectionInstanceId } from "./orchestration";

export const DEFAULT_TEXT_GENERATION_MODEL_SELECTION: ModelSelection = {
  instanceId: "codex",
  model: "gpt-5.5",
};

// ── Client Settings (local-only) ───────────────────────────────

export const TimestampFormat = Schema.Literals(["locale", "12-hour", "24-hour"]);
export type TimestampFormat = typeof TimestampFormat.Type;
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";

export const SidebarProjectSortOrder = Schema.Literals(["updated_at", "created_at", "manual"]);
export type SidebarProjectSortOrder = typeof SidebarProjectSortOrder.Type;
export const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "updated_at";

export const SidebarThreadSortOrder = Schema.Literals(["updated_at", "created_at"]);
export type SidebarThreadSortOrder = typeof SidebarThreadSortOrder.Type;
export const DEFAULT_SIDEBAR_THREAD_SORT_ORDER: SidebarThreadSortOrder = "updated_at";

export const SidebarProjectGroupingMode = Schema.Literals([
  "repository",
  "repository_path",
  "separate",
]);
export type SidebarProjectGroupingMode = typeof SidebarProjectGroupingMode.Type;
export const DEFAULT_SIDEBAR_PROJECT_GROUPING_MODE: SidebarProjectGroupingMode = "repository";

export const DEFAULT_AGENT_WINDOW_FONT_SMOOTHING_ANTIALIASED = true;
export const DEFAULT_CURSOR_POINTER_ON_BUTTONS = false;

export const AgentWindowSendWhileStreamingBehavior = Schema.Literals([
  "queue",
  "stop-and-send",
  "send",
]);
export type AgentWindowSendWhileStreamingBehavior =
  typeof AgentWindowSendWhileStreamingBehavior.Type;
export const DEFAULT_AGENT_WINDOW_SEND_WHILE_STREAMING_BEHAVIOR: AgentWindowSendWhileStreamingBehavior =
  "queue";

export const AgentWindowUsageSummaryDisplay = Schema.Literals(["auto", "always", "never"]);
export type AgentWindowUsageSummaryDisplay = typeof AgentWindowUsageSummaryDisplay.Type;
export const DEFAULT_AGENT_WINDOW_USAGE_SUMMARY_DISPLAY: AgentWindowUsageSummaryDisplay = "auto";

export const ConversationDensity = Schema.Literals([
  "detailed",
  "compact-shells",
  "compact-ungrouped",
  "compact-grouped",
  "compact-all-grouped",
]);
export type ConversationDensity = typeof ConversationDensity.Type;

export const USER_CONVERSATION_DENSITY_VALUES = [
  "detailed",
  "compact-ungrouped",
  "compact-all-grouped",
] as const satisfies readonly ConversationDensity[];
export type UserConversationDensity = (typeof USER_CONVERSATION_DENSITY_VALUES)[number];

export const DEFAULT_CONVERSATION_DENSITY: ConversationDensity = "compact-all-grouped";

export const ClientSettingsSchema = Schema.Struct({
  agentWindowFontSmoothingAntialiased: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_WINDOW_FONT_SMOOTHING_ANTIALIASED)),
  ),
  agentWindowSendWhileStreamingBehavior: AgentWindowSendWhileStreamingBehavior.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_WINDOW_SEND_WHILE_STREAMING_BEHAVIOR)),
  ),
  agentWindowUsageSummaryDisplay: AgentWindowUsageSummaryDisplay.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_WINDOW_USAGE_SUMMARY_DISPLAY)),
  ),
  autoOpenPlanSidebar: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  confirmThreadArchive: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  conversationDensity: ConversationDensity.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_CONVERSATION_DENSITY)),
  ),
  cursorPointerOnButtons: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_CURSOR_POINTER_ON_BUTTONS)),
  ),
  diffWordWrap: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  sidebarProjectGroupingMode: SidebarProjectGroupingMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_PROJECT_GROUPING_MODE)),
  ),
  sidebarProjectGroupingOverrides: Schema.Record(
    TrimmedNonEmptyString,
    SidebarProjectGroupingMode,
  ).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  sidebarProjectSortOrder: SidebarProjectSortOrder.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_PROJECT_SORT_ORDER)),
  ),
  sidebarThreadSortOrder: SidebarThreadSortOrder.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_THREAD_SORT_ORDER)),
  ),
  timestampFormat: TimestampFormat.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_TIMESTAMP_FORMAT)),
  ),
});
export type ClientSettings = typeof ClientSettingsSchema.Type;

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = Schema.decodeSync(ClientSettingsSchema)({});

// ── Server Settings (server-authoritative) ────────────────────

export const ThreadEnvMode = Schema.Literals(["local", "worktree"]);
export type ThreadEnvMode = typeof ThreadEnvMode.Type;

export const ObservabilitySettings = Schema.Struct({
  otlpTracesUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  otlpMetricsUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type ObservabilitySettings = typeof ObservabilitySettings.Type;

export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  defaultThreadEnvMode: ThreadEnvMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("local" as const satisfies ThreadEnvMode)),
  ),
  addProjectBaseDirectory: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_TEXT_GENERATION_MODEL_SELECTION)),
  ),
  observability: ObservabilitySettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type ServerSettings = typeof ServerSettings.Type;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = Schema.decodeSync(ServerSettings)({});

export class ServerSettingsError extends Schema.TaggedErrorClass<ServerSettingsError>()(
  "ServerSettingsError",
  {
    settingsPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Server settings error at ${this.settingsPath}: ${this.detail}`;
  }
}

// ── Unified type ─────────────────────────────────────────────────────

export type UnifiedSettings = ServerSettings & ClientSettings;
export const DEFAULT_UNIFIED_SETTINGS: UnifiedSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  ...DEFAULT_CLIENT_SETTINGS,
};

// ── Server Settings Patch (replace with a Schema.deepPartial if available) ──────────────────────────────────────────

const ModelSelectionPatch = Schema.Struct({
  instanceId: Schema.optionalKey(ModelSelectionInstanceId),
  model: Schema.optionalKey(TrimmedNonEmptyString),
  options: Schema.optionalKey(ModelOptionSelections),
});

export const ServerSettingsPatch = Schema.Struct({
  // Server settings
  enableAssistantStreaming: Schema.optionalKey(Schema.Boolean),
  defaultThreadEnvMode: Schema.optionalKey(ThreadEnvMode),
  addProjectBaseDirectory: Schema.optionalKey(Schema.String),
  textGenerationModelSelection: Schema.optionalKey(ModelSelectionPatch),
  observability: Schema.optionalKey(
    Schema.Struct({
      otlpTracesUrl: Schema.optionalKey(Schema.String),
      otlpMetricsUrl: Schema.optionalKey(Schema.String),
    }),
  ),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;

export const ClientSettingsPatch = Schema.Struct({
  agentWindowFontSmoothingAntialiased: Schema.optionalKey(Schema.Boolean),
  agentWindowSendWhileStreamingBehavior: Schema.optionalKey(AgentWindowSendWhileStreamingBehavior),
  agentWindowUsageSummaryDisplay: Schema.optionalKey(AgentWindowUsageSummaryDisplay),
  autoOpenPlanSidebar: Schema.optionalKey(Schema.Boolean),
  confirmThreadArchive: Schema.optionalKey(Schema.Boolean),
  confirmThreadDelete: Schema.optionalKey(Schema.Boolean),
  conversationDensity: Schema.optionalKey(ConversationDensity),
  cursorPointerOnButtons: Schema.optionalKey(Schema.Boolean),
  diffWordWrap: Schema.optionalKey(Schema.Boolean),
  sidebarProjectGroupingMode: Schema.optionalKey(SidebarProjectGroupingMode),
  sidebarProjectGroupingOverrides: Schema.optionalKey(
    Schema.Record(TrimmedNonEmptyString, SidebarProjectGroupingMode),
  ),
  sidebarProjectSortOrder: Schema.optionalKey(SidebarProjectSortOrder),
  sidebarThreadSortOrder: Schema.optionalKey(SidebarThreadSortOrder),
  timestampFormat: Schema.optionalKey(TimestampFormat),
});
export type ClientSettingsPatch = typeof ClientSettingsPatch.Type;
