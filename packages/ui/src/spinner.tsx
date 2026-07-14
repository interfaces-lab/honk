// The spinner — honk's indeterminate loader: a faint ring whose top arc is painted brighter and
// spins while work is in flight. A pure StyleX display leaf (the status-dot pattern): it carries no
// interaction, so — unlike Button/Tooltip — it needs no Base UI, only the token bus. One concept
// per file (ADR 0011).
//
// ANATOMY. A single bordered circle. All four sides are the faint TRACK (border-muted); the tone
// then repaints the TOP side to make the moving ARC, and because the ring spins that brighter
// quarter chases continuously around the circle (the classic quarter-arc loader — read as "work is
// happening"). The stroke is drawn with border LONGHANDS (stylex skill §4 — never the `border:`
// shorthand); box-sizing:border-box keeps the ring's outer box exactly the icon-slot size, so
// swapping an <Icon> for a <Spinner> never shifts layout.
//
// TONE is the arc color, semantic not domain. accent (the DEFAULT) is honk's liveness signal — the
// motion vocabulary files spin under "liveness" beside the shimmer (tokens.stylex.ts §Motion) and
// accent is that beat's color; muted (text-muted) is the quiet inline loader, for a small spinner
// in dense chrome that shouldn't shout. The track stays border-muted under both.
//
// SIZE snaps to the ICON ramp (iconVars sm/md/lg = 14/16/18), not the control ramp: a spinner
// stands in for a glyph (inside a button, beside a label), so it sizes like an <Icon>.
//
// MOTION. A linear 360° turn at the spinner duration token (900ms). linear is deliberate — a
// continuous rotation on one of honk's eased house curves visibly stutters each cycle; constant
// angular velocity is the only correct feel, so the timing function is a plain keyword, not a motion
// token (the one motion that legitimately skips the easing vocabulary). The spin carries its own
// prefers-reduced-motion sibling that halts it (ADR 0025 / stylex create() rule 7 — no global media
// token to lean on); reduced motion leaves a static tracked ring, still a valid loading affordance.
//
// A11Y follows the status-dot idiom: pass `label` when the spinner is the ONLY carrier of loading
// state and it becomes an announced status region (role=status); omit it when a visible "Loading…"
// sits beside it and the spinner goes decorative (aria-hidden), so nothing double-announces.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { colorVars, iconVars, motionVars, radiusVars } from "./tokens.stylex";

type SpinnerSize = "sm" | "md" | "lg";
// The arc color: accent (the liveness default) or muted (a quiet inline loader — text-muted).
type SpinnerTone = "accent" | "muted";

// The ring's stroke width — spinner anatomy (a named intrinsic, like status-dot's DOT_SIZE), not
// shared vocabulary. 2px reads as a ring at every icon size (a 14px spinner keeps a ~10px hole).
const RING_WIDTH = "2px";

// One full turn. The degrees are the animation's own geometry (a whole circle), not a design value —
// a spinner must rotate exactly 360°, and the lint's raw-value guard targets px/ms/hex, never deg.
const spinKeyframes = stylex.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});

const sx = stylex.create({
  // The stable loading region: an inline box that centers the ring and carries the a11y + xstyle.
  // It does NOT rotate (the spin lives on the inner ring), so the app can position this box via
  // xstyle without the transform fighting its layout — the status-dot root/dot split.
  root: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  // The ring: a full faint track circle whose top arc the tone recolors; spins linearly forever.
  ring: {
    boxSizing: "border-box",
    display: "block",
    borderRadius: radiusVars["--honk-radius-pill"],
    borderStyle: "solid",
    borderWidth: RING_WIDTH,
    // The track — all four sides faint (longhands, never the `border:` shorthand). The tone below
    // overrides borderTopColor to paint the moving arc.
    borderTopColor: colorVars["--honk-color-border-muted"],
    borderRightColor: colorVars["--honk-color-border-muted"],
    borderBottomColor: colorVars["--honk-color-border-muted"],
    borderLeftColor: colorVars["--honk-color-border-muted"],
    animationName: {
      default: spinKeyframes,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: motionVars["--honk-motion-duration-spinner"],
    // Linear on purpose — a continuous spin must hold constant angular velocity; the eased house
    // curves would stutter each turn, so this is the one motion that skips the easing tokens.
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },

  // Sizes — the ring stands in for a glyph, so it snaps to the ICON ramp, not the control ramp.
  sizeSm: { width: iconVars["--honk-icon-size-sm"], height: iconVars["--honk-icon-size-sm"] },
  sizeMd: { width: iconVars["--honk-icon-size-md"], height: iconVars["--honk-icon-size-md"] },
  sizeLg: { width: iconVars["--honk-icon-size-lg"], height: iconVars["--honk-icon-size-lg"] },
});

// Tone = the arc: it overrides the muted track's TOP side only, so the bright quarter chases the ring.
const tones = stylex.create({
  accent: { borderTopColor: colorVars["--honk-color-accent"] },
  muted: { borderTopColor: colorVars["--honk-color-text-muted"] },
});

const sizeStyleBySize: Record<SpinnerSize, stylex.StyleXStyles> = {
  sm: sx.sizeSm,
  md: sx.sizeMd,
  lg: sx.sizeLg,
};
const toneStyleByTone: Record<SpinnerTone, stylex.StyleXStyles> = {
  accent: tones.accent,
  muted: tones.muted,
};

interface SpinnerProps {
  size?: SpinnerSize;
  tone?: SpinnerTone;
  // When the spinner is the ONLY carrier of loading state, pass a label: it becomes an announced
  // status region (role=status). Omitted → decorative (aria-hidden), for a spinner sitting beside
  // its own visible "Loading…" text.
  label?: string;
  // StyleX escape hatch — nudges the loading region's layout/position, not the ring's internals.
  xstyle?: stylex.StyleXStyles;
}

function Spinner({
  size = "md",
  tone = "accent",
  label,
  xstyle,
}: SpinnerProps): React.ReactElement {
  // Labeled → an announced status region; unlabeled → decorative (the status-dot a11y split).
  const a11y =
    label !== undefined ? { role: "status", "aria-label": label } : { "aria-hidden": true };
  return (
    <span {...a11y} data-slot="spinner" {...stylex.props(sx.root, xstyle)}>
      <span {...stylex.props(sx.ring, toneStyleByTone[tone], sizeStyleBySize[size])} />
    </span>
  );
}

export { Spinner };
export type { SpinnerProps, SpinnerSize, SpinnerTone };
