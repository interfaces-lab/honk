import { describe, expect, test } from "vitest";

import {
  ICON_SF_SYMBOL,
  ICON_SIZE,
  iconTint,
  type IconName,
  type IconTone,
} from "./icon-symbols.native";
import { resolveNativeTheme } from "./theme";

const NAMES = Object.keys(ICON_SF_SYMBOL) as readonly IconName[];

describe("ICON_SF_SYMBOL", () => {
  test("maps every name to a bare SF Symbol identifier", () => {
    // The `sf:` scheme prefix belongs to the source string built in icon.native.tsx, not the map.
    expect(NAMES.filter((name) => !/^[a-z][a-z0-9.]*$/.test(ICON_SF_SYMBOL[name]))).toEqual([]);
  });

  test("maps every name to a distinct symbol", () => {
    expect(new Set(NAMES.map((name) => ICON_SF_SYMBOL[name])).size).toBe(NAMES.length);
  });

  test("carries the two glyphs the Toaster resolves by type", () => {
    expect(ICON_SF_SYMBOL["circle-check"]).toBe("checkmark.circle.fill");
    expect(ICON_SF_SYMBOL["exclamation-circle"]).toBe("exclamationmark.circle.fill");
  });
});

describe("ICON_SIZE", () => {
  test("ascends from xs to xl and mirrors the web icon scale", () => {
    expect([ICON_SIZE.xs, ICON_SIZE.sm, ICON_SIZE.md, ICON_SIZE.lg, ICON_SIZE.xl]).toEqual([
      12, 14, 16, 18, 20,
    ]);
  });
});

describe("iconTint", () => {
  const light = resolveNativeTheme("light").colors;
  const dark = resolveNativeTheme("dark").colors;

  test("resolves current to the primary text color, since native has no currentColor", () => {
    expect(iconTint(light, "current")).toBe(light.textPrimary);
  });

  test("resolves each tone to its theme color", () => {
    const expected: Record<IconTone, string> = {
      current: light.textPrimary,
      muted: light.textMuted,
      faint: light.textFaint,
      accent: light.accent,
      ok: light.okFg,
      warn: light.warnFg,
      err: light.errFg,
      info: light.infoFg,
    };
    const tones = Object.keys(expected) as readonly IconTone[];

    expect(Object.fromEntries(tones.map((tone) => [tone, iconTint(light, tone)]))).toEqual(
      expected,
    );
  });

  test("follows the color scheme rather than hardcoding a value", () => {
    expect(iconTint(dark, "muted")).toBe(dark.textMuted);
    expect(iconTint(dark, "muted")).not.toBe(iconTint(light, "muted"));
  });
});
