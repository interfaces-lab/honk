import * as stylex from "@stylexjs/stylex";

// Fixed setup-route measures consumed inside `stylex.create` in setup.tsx,
// setup-scene.tsx, and setup-accounts.tsx. StyleX requires cross-file style
// values to live in a `.stylex.ts` module; `defineConsts` inlines the literal at
// build time (so it works as a media-query condition), unlike `defineVars`,
// which would emit a `var(--…)` reference.
//
// `column` is a reading measure, not a shell width: wide enough for a settings
// row with a trailing control, narrow enough that the eye never crosses the
// whole window. `heroColumn` is tighter so the opening copy wraps in three
// lines the way the reference does.
export const setupLayout = stylex.defineConsts({
  compactMedia: "@media (max-width: 720px)",
  column: "640px",
  heroColumn: "560px",
  // Separates the opening lockup from the choice and the choice from its
  // consequence; wider than the gap inside the lockup itself.
  heroGroupGap: "28px",
  edgePad: "48px",
  edgePadCompact: "20px",
  // Clears the macOS traffic lights, which float over the setup backdrop
  // because setup draws no titlebar of its own.
  topClearance: "56px",
});
