// The status dot — a small round status indicator (the tab strip's and sidebar's state glyph, and
// the leading dot on a status row). A pure StyleX display leaf: it is not interactive, so — unlike
// Button/Tooltip — it needs no Base UI, only the token bus (the Text/Icon/Matrix leaf pattern).
//
// TONE is semantic, not domain: the design layer speaks the status COLOR language (ok/warn/err/info
// + accent + neutral + the hollow draft), and the app maps its own vocabulary onto it (done→ok,
// needs-you→warn, failed→err, unseen→accent, idle→neutral, draft→draft). `pulse` is honk's identity
// attention beat — the "amber pulse" the status vocabulary names (warn + pulse = needs-you). Every
// value is a token so a dialkit setProperty repaints every dot; the pulse carries its own
// reduced-motion sibling (StyleX create() rule 7 — no global media token to lean on).

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { colorVars, motionVars, radiusVars } from "./tokens.stylex";

type StatusDotTone = "ok" | "warn" | "err" | "info" | "accent" | "neutral" | "draft";

// The dot's diameter — display anatomy (a named intrinsic, like the matrix's 2px cell dot), not
// shared vocabulary. 6px is the shipped status-dot size, a hair above the 5×5 matrix's dots.
const DOT_SIZE = "6px";
// The hollow draft ring, drawn as an inset shadow so the dot keeps its DOT_SIZE box (the button's
// ring idiom). Named intrinsic; the color is a token.
const DRAFT_RING = `inset 0 0 0 1px ${colorVars["--honk-color-text-faint"]}`;

// The attention pulse: a slow opacity breath (not scale — a dot growing past its box would clip).
const pulseKeyframes = stylex.keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.35 },
});

const styles = stylex.create({
  // A neutral inline box so the dot sits on a text baseline without nudging layout.
  root: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  dot: {
    display: "block",
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: radiusVars["--honk-radius-pill"],
  },
  ok: { backgroundColor: colorVars["--honk-color-ok-fg"] },
  warn: { backgroundColor: colorVars["--honk-color-warn-fg"] },
  err: { backgroundColor: colorVars["--honk-color-err-fg"] },
  info: { backgroundColor: colorVars["--honk-color-info-fg"] },
  accent: { backgroundColor: colorVars["--honk-color-accent"] },
  neutral: { backgroundColor: colorVars["--honk-color-text-faint"] },
  // Draft = a hollow ring, not a fill (the "○ draft" in the status vocabulary). The ring is an
  // inset shadow so the dot keeps its exact DOT_SIZE box (a border would grow it).
  draft: {
    backgroundColor: "transparent",
    boxShadow: DRAFT_RING,
  },
  pulse: {
    animationName: pulseKeyframes,
    // The shimmer cadence is honk's slow-liveness beat (2000ms) — the pulse rides the same tempo.
    animationDuration: motionVars["--honk-motion-duration-shimmer"],
    animationTimingFunction: motionVars["--honk-motion-ease-out"],
    animationIterationCount: "infinite",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
});

const toneStyles: Record<StatusDotTone, stylex.StyleXStyles> = {
  ok: styles.ok,
  warn: styles.warn,
  err: styles.err,
  info: styles.info,
  accent: styles.accent,
  neutral: styles.neutral,
  draft: styles.draft,
};

interface StatusDotProps {
  tone?: StatusDotTone;
  // The identity attention beat — the slow opacity pulse (warn + pulse = the "needs-you" dot).
  pulse?: boolean;
  // When the dot is the ONLY carrier of status (no adjacent text), pass a label: it becomes an
  // announced status region. Omitted → decorative (aria-hidden), for a dot beside its own text.
  label?: string;
  xstyle?: stylex.StyleXStyles;
}

function StatusDot({
  tone = "neutral",
  pulse = false,
  label,
  xstyle,
}: StatusDotProps): React.ReactElement {
  const a11y = label !== undefined ? { role: "status", "aria-label": label } : { "aria-hidden": true };
  return (
    <span {...a11y} data-slot="status-dot" {...stylex.props(styles.root, xstyle)}>
      <span {...stylex.props(styles.dot, toneStyles[tone], pulse && styles.pulse)} />
    </span>
  );
}

export { StatusDot };
export type { StatusDotProps, StatusDotTone };
