import { Effect } from "effect";
import * as Schema from "effect/Schema";

import {
  ConversationDensity,
  DEFAULT_CONVERSATION_DENSITY,
} from "./conversation-density";
import { TrimmedNonEmptyString } from "./base-schemas";
import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "./server-settings";

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

// "classic" is the brand icon shipped with the app bundle; the other variants are
// runtime dock-icon swaps resolved from desktop resources (resources/app-icons/<variant>.png).
// "dev" is the blueprint development icon and is only offered in dev-stage builds. The key
// stays absent until the user picks one so the effective default can be stage-aware
// ("dev" in dev builds, "classic" otherwise).
export const AppIconVariant = Schema.Literals(["classic", "midnight", "sunset", "forest", "dev"]);
export type AppIconVariant = typeof AppIconVariant.Type;

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
  appIconVariant: Schema.optionalKey(AppIconVariant),
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

export type UnifiedSettings = ServerSettings & ClientSettings;
export const DEFAULT_UNIFIED_SETTINGS: UnifiedSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  ...DEFAULT_CLIENT_SETTINGS,
};

export const ClientSettingsPatch = Schema.Struct({
  agentWindowFontSmoothingAntialiased: Schema.optionalKey(Schema.Boolean),
  agentWindowSendWhileStreamingBehavior: Schema.optionalKey(AgentWindowSendWhileStreamingBehavior),
  agentWindowUsageSummaryDisplay: Schema.optionalKey(AgentWindowUsageSummaryDisplay),
  appIconVariant: Schema.optionalKey(AppIconVariant),
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
