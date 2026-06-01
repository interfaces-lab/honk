import { describe, expect, it } from "vitest";

import {
  DEFAULT_APPEARANCE_TINT_HUE,
  DEFAULT_APPEARANCE_TINT_INTENSITY,
  buildAppearanceBaseColors,
} from "./appearance-colors";

describe("buildAppearanceBaseColors", () => {
  it("returns Cursor core colors when tint intensity is zero", () => {
    expect(buildAppearanceBaseColors("light", DEFAULT_APPEARANCE_TINT_HUE, 0)).toEqual({
      "--multi-base-sidebar": "#F3F3F3",
      "--multi-base-chrome": "#F8F8F8",
      "--multi-base-editor": "#FCFCFC",
      "--multi-base-accent": "#3685BF",
      "--multi-base-focus": "#3685BF",
    });
    expect(buildAppearanceBaseColors("dark", DEFAULT_APPEARANCE_TINT_HUE, 0)).toEqual({
      "--multi-base-sidebar": "#181818",
      "--multi-base-chrome": "#141414",
      "--multi-base-editor": "#181818",
      "--multi-base-accent": "#599CE7",
      "--multi-base-focus": "#E4E4E4",
    });
  });

  it("uses the copied local Cursor tint by default", () => {
    expect(DEFAULT_APPEARANCE_TINT_HUE).toBe(261);
    expect(DEFAULT_APPEARANCE_TINT_INTENSITY).toBe(20);
    expect(
      buildAppearanceBaseColors(
        "light",
        DEFAULT_APPEARANCE_TINT_HUE,
        DEFAULT_APPEARANCE_TINT_INTENSITY,
      ),
    ).toEqual({
      "--multi-base-sidebar": "#F2F1F5",
      "--multi-base-chrome": "#F8F7F9",
      "--multi-base-editor": "#FCFCFC",
      "--multi-base-accent": "#6636BF",
      "--multi-base-focus": "#6636BF",
    });
    expect(
      buildAppearanceBaseColors(
        "dark",
        DEFAULT_APPEARANCE_TINT_HUE,
        DEFAULT_APPEARANCE_TINT_INTENSITY,
      ),
    ).toEqual({
      "--multi-base-sidebar": "#17131D",
      "--multi-base-chrome": "#131216",
      "--multi-base-editor": "#17161A",
      "--multi-base-accent": "#8B59E7",
      "--multi-base-focus": "#E4E4E4",
    });
  });

  it("preserves surface lightness and applies half chroma to chrome and editor", () => {
    expect(buildAppearanceBaseColors("light", 247, 33)).toEqual({
      "--multi-base-sidebar": "#F0EFF7",
      "--multi-base-chrome": "#F7F7F9",
      "--multi-base-editor": "#FCFCFC",
      "--multi-base-accent": "#4636BF",
      "--multi-base-focus": "#4636BF",
    });
    expect(buildAppearanceBaseColors("dark", 247, 33)).toEqual({
      "--multi-base-sidebar": "#121020",
      "--multi-base-chrome": "#111117",
      "--multi-base-editor": "#15141C",
      "--multi-base-accent": "#6A59E7",
      "--multi-base-focus": "#E4E4E4",
    });
  });

  it("clamps user input before generating tokens", () => {
    expect(buildAppearanceBaseColors("light", 999, 999)).toEqual(
      buildAppearanceBaseColors("light", 360, 100),
    );
    expect(buildAppearanceBaseColors("dark", -10, -10)).toEqual(
      buildAppearanceBaseColors("dark", 0, 0),
    );
  });
});
