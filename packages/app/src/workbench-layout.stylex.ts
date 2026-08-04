import * as stylex from "@stylexjs/stylex";
import { colorVars } from "@honk/ui/tokens.stylex";

// Shared workbench layout constants consumed inside `stylex.create` across files.
// StyleX requires cross-file style values to live in a `.stylex.ts` module;
// `defineConsts` inlines the literal at build time (so it composes in `calc(...)`),
// unlike `defineVars`, which would emit a `var(--…)` reference.
export const workbenchLayout = stylex.defineConsts({
  headerHeight: "36px",
});

// The header separator is a fixed one-pixel inset seam shared by the real header and its fallback.
const HEADER_SEPARATOR_SHADOW = `inset 0 -1px 0 ${colorVars["--honk-color-border-muted"]}`;

export const workbenchToolHeaderLayout = stylex.create({
  root: {
    flexShrink: 0,
    height: workbenchLayout.headerHeight,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
    boxShadow: HEADER_SEPARATOR_SHADOW,
  },
});
