// honk's status glyph — "the matrix loader". An n×n grid of tiny dots that sweep along the
// top-right → bottom-left diagonal while the agent is working, and sit still when it isn't. This is
// the product's ONE signature visual: the cell/dot geometry, keyframes, duration, easing, delay
// span, and the reduce-motion 0.55 opacity are ported verbatim from honkkit's original
// (packages/honkkit/src/conversation-loader.tsx + the `@keyframes chat-loader-diagonal-sweep` / dot
// rules in packages/honkkit/src/styles.css) and must never drift. The isActive=false resting
// opacity is honk's own choice (see INACTIVE_OPACITY). Everything else about this file is a clean
// StyleX + effect-free rewrite.
//
// TWO doctrines govern this file:
//   • StyleX charter (ADR 0023 + the stylex skill): styles live in stylex.create(), values come from
//     tokens — EXCEPT the sacred glyph intrinsics, which are the named constants below carrying a
//     one-line justification (stylex skill, Tokens rule 3: non-tokenized intrinsics are allowed when
//     justified). They are deliberately NOT tokens: tokens.stylex.ts holds swappable board vocabulary
//     that the identity round replaces wholesale, whereas this glyph's numbers are fixed forever.
//   • React doctrine (ADR 0025): ZERO useEffect. The one outside-world input — the OS "reduce motion"
//     setting — is read through a module-level matchMedia store + React.useSyncExternalStore.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { radiusVars } from "./tokens.stylex";

// ── The sacred glyph geometry (intrinsics, not tokens — stylex skill, Tokens rule 3) ──────────────
// The honkkit-verbatim values define the glyph itself, so they are named constants rather than
// design tokens (tokens are what the identity round swaps).
const GRID_DEFAULT = 5; // the glyph is 5×5 dots by default
const CELL_SIZE = "4px"; // one grid track = the 2px dot + 1px of breathing room on each side
const DOT_SIZE = "2px"; // the round dot, centered inside its 4px cell
const SWEEP_DURATION = "1.2s"; // one full sweep cycle
const SWEEP_EASING = "ease-in-out"; // symmetric ease — the sweep breathes in and back out
const SWEEP_DELAY_SPAN = "-0.72s"; // per-dot phase = path × this; negative = pre-seek into the loop
const INACTIVE_OPACITY = 0.35; // isActive=false resting state — honk's choice, NOT a honkkit value
const REDUCED_OPACITY = 0.55; // reduce-motion: held still (honkkit's idle/reduced opacity)

// The sweep, ported verbatim from styles.css `@keyframes chat-loader-diagonal-sweep`. Every dot runs
// this same cycle, phase-shifted by its diagonal position (see `dynamic.delay`), so the lit band
// reads as a single wipe travelling across the grid rather than dots blinking independently.
const sweep = stylex.keyframes({
  "0%": { opacity: 0.2, transform: "scale(0.78)" },
  "45%": { opacity: 0.88, transform: "scale(1)" },
  "72%": { opacity: 0.42, transform: "scale(0.9)" },
  "100%": { opacity: 0.2, transform: "scale(0.78)" },
});

const styles = stylex.create({
  // The container: an inline n×n grid. The n-dependent track template is a function style
  // (`dynamic.grid`) since n is only known at render; this holds the static container bits.
  root: {
    display: "inline-grid",
    // don't let a flex parent squeeze the glyph out of shape (honkkit's `shrink-0`).
    flexShrink: 0,
  },
  // A single dot. Round via the pill radius token — tokens.stylex.ts documents pill as "status dots",
  // which is literally this. Color is currentColor: the glyph inherits the surrounding text color and
  // never picks its own.
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: "currentColor",
    placeSelf: "center", // center the 2px dot within its 4px cell
    transformOrigin: "center", // the sweep's scale() grows from the dot's own middle
  },
  // The animating dot (isActive + motion allowed). The reduce-motion siblings are a first-paint
  // safety net: the JS store below already routes to `reduced` when motion is off, but an SSR frame
  // (server snapshot = false) could momentarily render an animating dot — this pins it to the still
  // resting state instead of a flash, and satisfies the charter's "every animation carries a
  // reduce-motion sibling" rule. `opacity` defaults to null so the keyframes own it while animating;
  // the concrete reduce-motion value keeps this off the banned all-null override (stylex skill 14).
  animated: {
    animationName: { default: sweep, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: { default: SWEEP_DURATION, "@media (prefers-reduced-motion: reduce)": "0s" },
    animationTimingFunction: SWEEP_EASING,
    animationIterationCount: "infinite",
    opacity: { default: null, "@media (prefers-reduced-motion: reduce)": REDUCED_OPACITY },
  },
  // Resting states, chosen in JS (stylex skill, Parent-state alternative 3 — JS-resolved picks;
  // React knows the whole dot list): idle when the agent isn't working, reduced when the OS asks
  // for less motion.
  idle: { opacity: INACTIVE_OPACITY },
  reduced: { opacity: REDUCED_OPACITY },
});

const dynamic = stylex.create({
  // The n×n track template. `n` is known at render (we build the dot list from it), so StyleX inlines
  // it as a CSS var rather than a hand-written style= (stylex skill, Dynamic rule 1: function styles,
  // never inline style objects).
  grid: (n: number) => ({
    gridTemplateColumns: `repeat(${n}, ${CELL_SIZE})`,
    gridTemplateRows: `repeat(${n}, ${CELL_SIZE})`,
  }),
  // Per-dot phase offset. `path` is the dot's 0..1 position along the top-right → bottom-left
  // diagonal; multiplying by the sacred −0.72s span shifts each dot into the shared loop so the
  // whole grid sweeps as one wave.
  delay: (path: number) => ({
    animationDelay: `calc(${path} * ${SWEEP_DELAY_SPAN})`,
  }),
});

// ── Reduced-motion store (ADR 0025: no useEffect; read env via a module matchMedia store) ─────────
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onStoreChange: () => void): () => void {
  // No window (SSR) or no matchMedia (a bare test env): nothing to subscribe to.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

// SSR assumes motion is allowed; the client corrects on first paint via the snapshot above.
function getReducedMotionServerSnapshot(): boolean {
  return false;
}

function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
}

// Where a dot sits along the top-right → bottom-left diagonal, normalized to 0..1. Ported verbatim
// from honkkit's trBlPathNormFromIndex. The max(1, …) guard keeps grid=1 from dividing by zero.
function diagonalPath(index: number, n: number): number {
  const row = Math.floor(index / n);
  const col = index % n;
  const maxPath = Math.max(1, (n - 1) * 2);
  return (row + (n - 1 - col)) / maxPath;
}

interface MatrixProps {
  // Grid dimension: the glyph is `grid × grid` dots. Defaults to the sacred 5×5.
  grid?: number;
  // Whether the agent is working: true → dots sweep, false → dots sit still (idle).
  isActive?: boolean;
  // Caller style override, merged LAST onto the container (charter merge order).
  xstyle?: stylex.StyleXStyles;
}

// React.memo'd: props are tiny and stable, and the only other trigger is the reduce-motion store, so
// re-renders happen exactly when the glyph's appearance can change.
const Matrix = React.memo(function Matrix({
  grid = GRID_DEFAULT,
  isActive = true,
  xstyle,
}: MatrixProps) {
  const reducedMotion = useReducedMotion();
  // reduce-motion wins over isActive: accessibility first, then idle, then the live sweep.
  const isAnimating = isActive && !reducedMotion;
  const restingState = reducedMotion ? styles.reduced : styles.idle;

  return (
    // aria-hidden: this is a decorative glyph (25 unlabeled dots are noise to a screen reader).
    // Callers using it as the sole loading indicator should wrap it in their own role="status" +
    // label — honkkit put the label on a parent, not on the glyph.
    <span aria-hidden={true} {...stylex.props(styles.root, dynamic.grid(grid), xstyle)}>
      {Array.from({ length: grid * grid }, (_, index) =>
        isAnimating ? (
          // base dot → animation → per-dot delay (delay only bites while animating)
          <span
            key={index}
            {...stylex.props(styles.dot, styles.animated, dynamic.delay(diagonalPath(index, grid)))}
          />
        ) : (
          // base dot → resting opacity (idle or reduce-motion), no animation
          <span key={index} {...stylex.props(styles.dot, restingState)} />
        ),
      )}
    </span>
  );
});

export { Matrix };
export type { MatrixProps };
