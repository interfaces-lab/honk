import * as stylex from "@stylexjs/stylex";

// Fixed onboarding modal proportions consumed inside `stylex.create` in both
// onboarding.tsx and onboarding-step.tsx. StyleX requires cross-file style
// values to live in a `.stylex.ts` module; `defineConsts` inlines the literal
// at build time (so it works as a media-query condition), unlike `defineVars`,
// which would emit a `var(--…)` reference.
export const onboardingLayout = stylex.defineConsts({
  compactMedia: "@media (max-width: 760px)",
  contentPad: "40px",
  contentPadCompact: "20px",
});
