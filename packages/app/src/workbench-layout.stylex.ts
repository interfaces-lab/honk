import * as stylex from "@stylexjs/stylex";

// Shared workbench layout constants consumed inside `stylex.create` across files.
// StyleX requires cross-file style values to live in a `.stylex.ts` module;
// `defineConsts` inlines the literal at build time (so it composes in `calc(...)`),
// unlike `defineVars`, which would emit a `var(--…)` reference.
export const workbenchLayout = stylex.defineConsts({
  headerHeight: "36px",
});
