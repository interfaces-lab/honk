import { describe, expect, it } from "vitest";

import {
  SETTINGS_PREFERENCE_ENTRIES,
  SETTINGS_PREFERENCE_IDS,
  filterSettingsPreferences,
  isSettingsPreferenceId,
} from "./settings-preference-index";

const DEFAULT_CONTEXT = {
  supportsAppIconSwitching: true,
  agentModeSupportsThinkingLevel: true,
} as const;

describe("settings-preference-index", () => {
  it("exposes a stable id for every catalog entry", () => {
    expect(SETTINGS_PREFERENCE_IDS).toHaveLength(SETTINGS_PREFERENCE_ENTRIES.length);
    expect(new Set(SETTINGS_PREFERENCE_IDS).size).toBe(SETTINGS_PREFERENCE_IDS.length);
  });

  it("validates known preference ids", () => {
    expect(isSettingsPreferenceId("appearance.ui-font-size")).toBe(true);
    expect(isSettingsPreferenceId("not-a-real-preference")).toBe(false);
  });

  it('ranks font-related preferences for query "font"', () => {
    const results = filterSettingsPreferences({
      query: "font",
      context: DEFAULT_CONTEXT,
    });
    const ids = results.map((entry) => entry.id);
    expect(ids).toContain("appearance.ui-font-size");
    expect(ids).toContain("appearance.code-font-family");
    expect(ids.indexOf("appearance.ui-font-size")).toBeLessThan(4);
    expect(ids.indexOf("appearance.code-font-family")).toBeLessThan(6);
  });

  it('surfaces codex-related preferences for query "codex"', () => {
    const results = filterSettingsPreferences({
      query: "codex",
      context: DEFAULT_CONTEXT,
    });
    const ids = results.map((entry) => entry.id);
    expect(ids).toContain("agents.agent-mode");
    expect(ids).toContain("agents.account.codex-oauth");
    expect(ids).not.toContain("agents.account.codex-api-key");
  });

  it("hides gated preferences when unsupported", () => {
    const results = filterSettingsPreferences({
      query: "app icon",
      context: {
        supportsAppIconSwitching: false,
        agentModeSupportsThinkingLevel: true,
      },
    });
    expect(results.some((entry) => entry.id === "appearance.app-icon")).toBe(false);
  });

  it("hides thinking level when the active agent mode does not support it", () => {
    const results = filterSettingsPreferences({
      query: "thinking",
      context: {
        supportsAppIconSwitching: true,
        agentModeSupportsThinkingLevel: false,
      },
    });
    expect(results.some((entry) => entry.id === "agents.thinking-level")).toBe(false);
  });
});
