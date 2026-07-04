import {
  compareRankedSearchResults,
  normalizeSearchQuery,
  scoreQueryMatch,
  type RankedSearchResult,
} from "@honk/shared/search-ranking";

import type { SettingsSectionId } from "./settings-sections";

export interface SettingsSearchContext {
  readonly supportsAppIconSwitching: boolean;
  readonly agentModeSupportsThinkingLevel: boolean;
}

export interface SettingsPreferenceEntry {
  readonly id: string;
  readonly section: SettingsSectionId;
  readonly panelLabel: string;
  readonly sectionTitle: string;
  readonly title: string;
  readonly description: string;
  readonly searchTerms: readonly string[];
  readonly isVisible?: (ctx: SettingsSearchContext) => boolean;
}

export const SETTINGS_PREFERENCE_ENTRIES = [
  {
    id: "general.timestamp-format",
    section: "general",
    panelLabel: "General",
    sectionTitle: "General",
    title: "Time format",
    description: "System default follows your browser or OS clock preference.",
    searchTerms: ["timestampFormat", "clock", "12-hour", "24-hour", "locale"],
  },
  {
    id: "general.add-project-base-directory",
    section: "general",
    panelLabel: "General",
    sectionTitle: "General",
    title: "Add project starts in",
    description: "Default folder when the Add Project browser opens.",
    searchTerms: ["addProjectBaseDirectory", "project", "folder", "cwd", "directory"],
  },
  {
    id: "general.keybindings",
    section: "general",
    panelLabel: "General",
    sectionTitle: "Advanced",
    title: "Keybindings",
    description: "Open the persisted keybindings file to edit advanced bindings directly.",
    searchTerms: ["keyboard", "shortcuts", "hotkeys", "keybindings", "bindings"],
  },
  {
    id: "appearance.theme",
    section: "appearance",
    panelLabel: "Appearance",
    sectionTitle: "Appearance",
    title: "Theme",
    description: "Choose between light, dark, or system themes.",
    searchTerms: ["honk:theme", "light", "dark", "system", "color scheme"],
  },
  {
    id: "appearance.app-icon",
    section: "appearance",
    panelLabel: "Appearance",
    sectionTitle: "Appearance",
    title: "App Icon",
    description: "Dock icon shown while the app is running.",
    searchTerms: ["appIconVariant", "dock", "icon", "classic", "midnight"],
    isVisible: (ctx) => ctx.supportsAppIconSwitching,
  },
  {
    id: "appearance.tint-hue",
    section: "appearance",
    panelLabel: "Appearance",
    sectionTitle: "Colors",
    title: "Tint Hue",
    description: "Shell and accent hue.",
    searchTerms: ["accent-hue", "hue", "accent", "tint", "color"],
  },
  {
    id: "appearance.tint-intensity",
    section: "appearance",
    panelLabel: "Appearance",
    sectionTitle: "Colors",
    title: "Tint Intensity",
    description: "Shell tint strength.",
    searchTerms: ["accent-saturation", "saturation", "intensity", "tint", "transparency"],
  },
  {
    id: "appearance.reduce-transparency",
    section: "appearance",
    panelLabel: "Appearance",
    sectionTitle: "Colors",
    title: "Reduce Transparency",
    description: "Use solid backgrounds.",
    searchTerms: ["reduceTransparency", "glass", "opaque", "solid", "transparency"],
  },
  {
    id: "appearance.ui-font-size",
    section: "appearance",
    panelLabel: "Appearance",
    sectionTitle: "Typography",
    title: "UI Font Size",
    description: "Interface text size.",
    searchTerms: ["ui-font-size", "uiFontSize", "font size", "text size", "interface"],
  },
  {
    id: "appearance.code-font-size",
    section: "appearance",
    panelLabel: "Appearance",
    sectionTitle: "Typography",
    title: "Code Font Size",
    description: "Editor text size.",
    searchTerms: ["code-font-size", "codeFontSize", "editor", "monospace"],
  },
  {
    id: "appearance.ui-font-family",
    section: "appearance",
    panelLabel: "Appearance",
    sectionTitle: "Typography",
    title: "UI Font Family",
    description: "Interface font.",
    searchTerms: ["ui-font", "uiFont", "font family", "typeface", "interface"],
  },
  {
    id: "appearance.code-font-family",
    section: "appearance",
    panelLabel: "Appearance",
    sectionTitle: "Typography",
    title: "Code Font Family",
    description: "Editor font.",
    searchTerms: ["code-font", "codeFont", "monospace", "editor font"],
  },
  {
    id: "appearance.font-smoothing",
    section: "appearance",
    panelLabel: "Appearance",
    sectionTitle: "Agent Window",
    title: "Font Smoothing",
    description: "Mac text smoothing.",
    searchTerms: ["agentWindowFontSmoothingAntialiased", "antialiased", "smoothing", "mac"],
  },
  {
    id: "appearance.pointer-cursors",
    section: "appearance",
    panelLabel: "Appearance",
    sectionTitle: "Agent Window",
    title: "Use pointer cursors",
    description: "Pointer on controls.",
    searchTerms: ["cursorPointerOnButtons", "pointer", "cursor", "hand"],
  },
  {
    id: "appearance.tool-call-density",
    section: "appearance",
    panelLabel: "Appearance",
    sectionTitle: "Chat",
    title: "Tool Call Density",
    description: "Adjust how much detail is shown for tool calls",
    searchTerms: ["conversationDensity", "tool call", "density", "compact", "verbose"],
  },
  {
    id: "agents.agent-mode",
    section: "agents",
    panelLabel: "Agents",
    sectionTitle: "Pi runtime",
    title: "Agent mode",
    description: "Default model for new sessions.",
    searchTerms: ["agentMode", "smart", "composer", "codex", "deep", "model"],
  },
  {
    id: "agents.thinking-level",
    section: "agents",
    panelLabel: "Agents",
    sectionTitle: "Pi runtime",
    title: "Thinking level",
    description: "Default reasoning depth for new Pi sessions in this agent mode.",
    searchTerms: ["thinkingLevel", "reasoning", "effort", "thinking"],
    isVisible: (ctx) => ctx.agentModeSupportsThinkingLevel,
  },
  {
    id: "agents.interaction-mode",
    section: "agents",
    panelLabel: "Agents",
    sectionTitle: "Pi runtime",
    title: "Interaction mode",
    description: "Default behavior for new agent turns.",
    searchTerms: ["interactionMode", "agent", "ask", "plan", "debug"],
  },
  {
    id: "agents.account.claude-code",
    section: "agents",
    panelLabel: "Agents",
    sectionTitle: "Accounts",
    title: "Claude Code",
    description: "Delegated Claude Code login for Claude agents.",
    searchTerms: ["claude-code", "anthropic", "claude", "login"],
  },
  {
    id: "agents.account.codex-oauth",
    section: "agents",
    panelLabel: "Agents",
    sectionTitle: "Accounts",
    title: "Codex",
    description: "ChatGPT sign-in for Codex agents.",
    searchTerms: ["codex-oauth", "openai", "oauth", "codex", "chatgpt", "sign in"],
  },
  {
    id: "agents.account.cursor-api-key",
    section: "agents",
    panelLabel: "Agents",
    sectionTitle: "Accounts",
    title: "Cursor",
    description: "Cursor API key credential for Cursor Composer.",
    searchTerms: ["cursor-api-key", "cursor", "api key", "composer"],
  },
  {
    id: "agents.assistant-streaming",
    section: "agents",
    panelLabel: "Agents",
    sectionTitle: "Agents",
    title: "Assistant output",
    description: "Show token-by-token output while a response is in progress.",
    searchTerms: ["enableAssistantStreaming", "streaming", "token", "output"],
  },
  {
    id: "agents.send-while-running",
    section: "agents",
    panelLabel: "Agents",
    sectionTitle: "Agents",
    title: "Send while running",
    description: "Choose what the composer submit action does while an agent turn is active.",
    searchTerms: ["agentWindowSendWhileStreamingBehavior", "queue", "composer", "submit"],
  },
  {
    id: "agents.usage-summary",
    section: "agents",
    panelLabel: "Agents",
    sectionTitle: "Agents",
    title: "Usage summary",
    description: "Auto shows context usage after 50%; Always shows it whenever data exists.",
    searchTerms: ["agentWindowUsageSummaryDisplay", "context", "usage", "tokens"],
  },
  {
    id: "agents.new-threads",
    section: "agents",
    panelLabel: "Agents",
    sectionTitle: "Agents",
    title: "New threads",
    description: "Pick the default project mode for newly created draft threads.",
    searchTerms: ["defaultThreadEnvMode", "worktree", "local", "thread", "draft"],
  },
  {
    id: "agents.diff-line-wrapping",
    section: "agents",
    panelLabel: "Agents",
    sectionTitle: "Review",
    title: "Diff line wrapping",
    description: "Set the default wrap state when the diff panel opens.",
    searchTerms: ["diffWordWrap", "diff", "wrap", "word wrap"],
  },
  {
    id: "agents.archive-confirmation",
    section: "agents",
    panelLabel: "Agents",
    sectionTitle: "Review",
    title: "Archive confirmation",
    description: "Require a second click before a thread is archived.",
    searchTerms: ["confirmThreadArchive", "archive", "confirm"],
  },
  {
    id: "agents.delete-confirmation",
    section: "agents",
    panelLabel: "Agents",
    sectionTitle: "Review",
    title: "Delete confirmation",
    description: "Ask before deleting a thread and its chat history.",
    searchTerms: ["confirmThreadDelete", "delete", "confirm"],
  },
] as const satisfies readonly SettingsPreferenceEntry[];

export const SETTINGS_PREFERENCE_ENTRIES_TYPED: readonly SettingsPreferenceEntry[] =
  SETTINGS_PREFERENCE_ENTRIES;

export const SETTINGS_PREFERENCE_IDS = SETTINGS_PREFERENCE_ENTRIES_TYPED.map((entry) => entry.id);

const SETTINGS_PREFERENCE_ID_SET = new Set<string>(SETTINGS_PREFERENCE_IDS);

export function isSettingsPreferenceId(
  value: string,
): value is (typeof SETTINGS_PREFERENCE_IDS)[number] {
  return SETTINGS_PREFERENCE_ID_SET.has(value);
}

function rankPreferenceField(field: string, normalizedQuery: string): number | null {
  const normalizedField = normalizeSearchQuery(field);
  if (!normalizedField) {
    return null;
  }

  return scoreQueryMatch({
    value: normalizedField,
    query: normalizedQuery,
    exactBase: 0,
    prefixBase: 100,
    boundaryBase: 200,
    includesBase: 300,
    fuzzyBase: 400,
  });
}

function rankPreferenceEntry(
  entry: SettingsPreferenceEntry,
  normalizedQuery: string,
): number | null {
  const fields = [
    entry.title,
    entry.description,
    entry.sectionTitle,
    entry.panelLabel,
    ...entry.searchTerms,
  ];

  let bestScore: number | null = null;
  for (const [index, field] of fields.entries()) {
    const fieldScore = rankPreferenceField(field, normalizedQuery);
    if (fieldScore === null) {
      continue;
    }
    const weightedScore = fieldScore - index;
    if (bestScore === null || weightedScore < bestScore) {
      bestScore = weightedScore;
    }
  }

  return bestScore;
}

export function filterSettingsPreferences(input: {
  query: string;
  context: SettingsSearchContext;
}): SettingsPreferenceEntry[] {
  const normalizedQuery = normalizeSearchQuery(input.query);
  const visibleEntries = SETTINGS_PREFERENCE_ENTRIES_TYPED.filter(
    (entry) => entry.isVisible?.(input.context) ?? true,
  );

  if (!normalizedQuery) {
    return [...visibleEntries];
  }

  const ranked: RankedSearchResult<SettingsPreferenceEntry>[] = [];
  for (const entry of visibleEntries) {
    const score = rankPreferenceEntry(entry, normalizedQuery);
    if (score === null) {
      continue;
    }
    ranked.push({
      item: entry,
      score,
      tieBreaker: entry.title,
    });
  }

  ranked.sort(compareRankedSearchResults);
  return ranked.map((result) => result.item);
}

export function findSettingsPreferenceEntry(
  preferenceId: string,
): SettingsPreferenceEntry | undefined {
  return SETTINGS_PREFERENCE_ENTRIES_TYPED.find((entry) => entry.id === preferenceId);
}

export function settingsPreferenceDomId(preferenceId: string): string {
  return `settings-pref-${preferenceId}`;
}
