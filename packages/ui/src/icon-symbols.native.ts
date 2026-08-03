// Native glyph registry. The web `Icon` takes a central-icons component (`icons.ts`), but that build
// emits DOM `<svg>`/`<path>` hosts with `currentColor` and `px` dimensions — none of which exist in
// React Native — so the native leaf keys by name and resolves to an SF Symbol instead. Names mirror
// the central-icons glyph they stand in for so both renderers keep one vocabulary.

import type { NativeTheme } from "./theme";

// expo-image serves the `sf:` scheme from an iOS-only loader; see the fallback note in
// icon.native.tsx for what Android does with these names.
const ICON_SF_SYMBOL = {
  "chevron-down": "chevron.down",
  "chevron-right": "chevron.right",
  "circle-check": "checkmark.circle.fill",
  "exclamation-circle": "exclamationmark.circle.fill",
  photo: "photo.on.rectangle",
  plus: "plus",
  trash: "trash",
  "xmark-circle": "xmark.circle.fill",
} as const;

// Mirrors webMetrics.icon (theme.ts) in dp. nativeMetrics carries no icon group, and adding one is a
// theme change this leaf does not own.
const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
} as const;

type IconName = keyof typeof ICON_SF_SYMBOL;
type IconSize = keyof typeof ICON_SIZE;
type IconTone = "current" | "muted" | "faint" | "accent" | "ok" | "warn" | "err" | "info";

// CSS `currentColor` has no native equivalent, so `current` resolves to the primary text color.
// Callers painting on chrome the tone list cannot name pass an explicit color instead.
function iconTint(colors: NativeTheme["colors"], tone: IconTone): string {
  if (tone === "muted") return colors.textMuted;
  if (tone === "faint") return colors.textFaint;
  if (tone === "accent") return colors.accent;
  if (tone === "ok") return colors.okFg;
  if (tone === "warn") return colors.warnFg;
  if (tone === "err") return colors.errFg;
  if (tone === "info") return colors.infoFg;
  return colors.textPrimary;
}

export { ICON_SF_SYMBOL, ICON_SIZE, iconTint };
export type { IconName, IconSize, IconTone };
