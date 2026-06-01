import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS_ROUTE, SETTINGS_SECTIONS } from "./settings-sections";

describe("settings sections", () => {
  it("keeps settings routes and ids unique", () => {
    const ids = SETTINGS_SECTIONS.map((section) => section.id);
    const routes = SETTINGS_SECTIONS.map((section) => section.to);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routes).size).toBe(routes.length);
    expect(routes).toContain(DEFAULT_SETTINGS_ROUTE);
  });

  it("keeps Cursor shell preferences owned by the appearance section", () => {
    const appearanceSection = SETTINGS_SECTIONS.find((section) => section.id === "appearance");

    expect(appearanceSection?.domain).toBe("appearance");
    expect(appearanceSection?.cursorPreferenceScopes).toEqual(
      expect.arrayContaining(["theme", "glass", "colors", "fonts", "workbench-surfaces"]),
    );
  });
});
