// Dot geometry and sweep timings are fixed product anatomy. Do not drift.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { radiusVars } from "./tokens.stylex";

// Glyph intrinsics are fixed forever. They are not design tokens.
const GRID_DEFAULT = 5;
const CELL_SIZE = "4px";
const DOT_SIZE = "2px";
const SWEEP_DURATION = "1.2s";
const SWEEP_EASING = "ease-in-out";
// Negative delay pre-seeks each dot into the shared loop by its diagonal path.
const SWEEP_DELAY_SPAN = "-0.72s";
// Idle rest is a product choice rather than a theme value.
const INACTIVE_OPACITY = 0.35;
const REDUCED_OPACITY = 0.55;
const ATTENTION_DURATION = "1.4s";
const ATTENTION_MASK_RADIUS = 1.125;
const ATTENTION_CORE_RADIUS = 0.275;
const ATTENTION_RING_RADIUS = 0.825;
const ATTENTION_CORE_REST = 0.35;
const ATTENTION_RING_REST = 0.16;
const ATTENTION_OUTER_REST = 0.08;

const sweep = stylex.keyframes({
  "0%": { opacity: 0.2, transform: "scale(0.78)" },
  "45%": { opacity: 0.88, transform: "scale(1)" },
  "72%": { opacity: 0.42, transform: "scale(0.9)" },
  "100%": { opacity: 0.2, transform: "scale(0.78)" },
});

// Keyframe samples of the attention pulse. Avoids a requestAnimationFrame render loop.
const attentionCorePulse = stylex.keyframes({
  "0%": { opacity: ATTENTION_CORE_REST },
  "6.25%": { opacity: 1 },
  "12.5%": { opacity: 1 },
  "18.75%": { opacity: 1 },
  "25%": { opacity: 1 },
  "31.25%": { opacity: 1 },
  "37.5%": { opacity: 1 },
  "43.75%": { opacity: 0.7135 },
  "50%": { opacity: ATTENTION_CORE_REST },
  "56.25%": { opacity: 0.7195 },
  "62.5%": { opacity: 0.8725 },
  "68.75%": { opacity: 0.7195 },
  "75%": { opacity: ATTENTION_CORE_REST },
  "100%": { opacity: ATTENTION_CORE_REST },
});

const attentionRingPulse = stylex.keyframes({
  "0%": { opacity: ATTENTION_RING_REST },
  "6.25%": { opacity: 0.4995 },
  "12.5%": { opacity: 0.7131 },
  "18.75%": { opacity: 0.7376 },
  "25%": { opacity: 0.6 },
  "31.25%": { opacity: 0.5665 },
  "37.5%": { opacity: 0.4711 },
  "43.75%": { opacity: 0.3284 },
  "50%": { opacity: ATTENTION_RING_REST },
  "56.25%": { opacity: 0.3311 },
  "62.5%": { opacity: 0.402 },
  "68.75%": { opacity: 0.3311 },
  "75%": { opacity: ATTENTION_RING_REST },
  "100%": { opacity: ATTENTION_RING_REST },
});

const attentionOuterPulse = stylex.keyframes({
  "0%": { opacity: ATTENTION_OUTER_REST },
  "6.25%": { opacity: 0.1417 },
  "12.5%": { opacity: 0.1806 },
  "18.75%": { opacity: 0.185 },
  "25%": { opacity: 0.16 },
  "31.25%": { opacity: 0.1539 },
  "37.5%": { opacity: 0.1366 },
  "43.75%": { opacity: 0.1106 },
  "50%": { opacity: ATTENTION_OUTER_REST },
  "56.25%": { opacity: 0.1111 },
  "62.5%": { opacity: 0.124 },
  "68.75%": { opacity: 0.1111 },
  "75%": { opacity: ATTENTION_OUTER_REST },
  "100%": { opacity: ATTENTION_OUTER_REST },
});

const styles = stylex.create({
  root: {
    display: "inline-grid",
    flexShrink: 0,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: "currentColor",
    placeSelf: "center",
    transformOrigin: "center",
  },
  // reduce-motion sibling covers the SSR frame before the matchMedia store hydrates.
  animated: {
    animationName: { default: sweep, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: { default: SWEEP_DURATION, "@media (prefers-reduced-motion: reduce)": "0s" },
    animationTimingFunction: SWEEP_EASING,
    animationIterationCount: "infinite",
    opacity: { default: null, "@media (prefers-reduced-motion: reduce)": REDUCED_OPACITY },
  },
  idle: { opacity: INACTIVE_OPACITY },
  reduced: { opacity: REDUCED_OPACITY },
  attentionCore: { opacity: ATTENTION_CORE_REST },
  attentionRing: { opacity: ATTENTION_RING_REST },
  attentionOuter: { opacity: ATTENTION_OUTER_REST },
  attentionAnimated: {
    animationDuration: {
      default: ATTENTION_DURATION,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  attentionCoreAnimated: {
    animationName: {
      default: attentionCorePulse,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
  },
  attentionRingAnimated: {
    animationName: {
      default: attentionRingPulse,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
  },
  attentionOuterAnimated: {
    animationName: {
      default: attentionOuterPulse,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
  },
});

const dynamic = stylex.create({
  grid: (n: number) => ({
    gridTemplateColumns: `repeat(${n}, ${CELL_SIZE})`,
    gridTemplateRows: `repeat(${n}, ${CELL_SIZE})`,
  }),
  delay: (path: number) => ({
    animationDelay: `calc(${path} * ${SWEEP_DELAY_SPAN})`,
  }),
});

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onStoreChange: () => void): () => void {
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

// SSR defaults to motion on. The client snapshot corrects on hydrate.
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

function diagonalPath(index: number, n: number): number {
  const row = Math.floor(index / n);
  const col = index % n;
  const maxPath = Math.max(1, (n - 1) * 2);
  return (row + (n - 1 - col)) / maxPath;
}

type AttentionBand = "core" | "ring" | "outer";

function attentionBand(index: number, n: number): AttentionBand | null {
  const center = (n - 1) / 2;
  const scale = Math.max(1, center);
  const row = Math.floor(index / n);
  const col = index % n;
  const radius = Math.hypot(col - center, row - center) / scale;
  if (radius > ATTENTION_MASK_RADIUS) {
    return null;
  }
  if (radius < ATTENTION_CORE_RADIUS) {
    return "core";
  }
  return radius < ATTENTION_RING_RADIUS ? "ring" : "outer";
}

const attentionRestStyles: Record<AttentionBand, stylex.StyleXStyles> = {
  core: styles.attentionCore,
  ring: styles.attentionRing,
  outer: styles.attentionOuter,
};

const attentionAnimatedStyles: Record<AttentionBand, stylex.StyleXStyles> = {
  core: styles.attentionCoreAnimated,
  ring: styles.attentionRingAnimated,
  outer: styles.attentionOuterAnimated,
};

type MatrixVariant = "working" | "attention";

interface MatrixProps {
  grid?: number;
  variant?: MatrixVariant;
  isActive?: boolean;
  color?: string;
  style?: StyleProp<HonkStyle>;
}

const Matrix = React.memo(function Matrix({
  grid = GRID_DEFAULT,
  variant = "working",
  isActive = true,
  color,
  style,
}: MatrixProps) {
  const reducedMotion = useReducedMotion();
  // Reduce-motion wins over isActive.
  const isAnimating = isActive && !reducedMotion;
  const restingState = reducedMotion ? styles.reduced : styles.idle;

  return (
    // Decorative only. Callers that need a loading announcement wrap with role="status".
    <span
      aria-hidden={true}
      {...applyStyle(stylex.props(styles.root, dynamic.grid(grid)), [
        color === undefined ? null : { color },
        style,
      ])}
    >
      {Array.from({ length: grid * grid }, (_, index) => {
        if (variant === "attention") {
          const band = attentionBand(index, grid);
          if (band === null) {
            return <span key={index} />;
          }
          return (
            <span
              key={index}
              {...stylex.props(
                styles.dot,
                attentionRestStyles[band],
                isAnimating && styles.attentionAnimated,
                isAnimating && attentionAnimatedStyles[band],
              )}
            />
          );
        }
        return isAnimating ? (
          <span
            key={index}
            {...stylex.props(styles.dot, styles.animated, dynamic.delay(diagonalPath(index, grid)))}
          />
        ) : (
          <span key={index} {...stylex.props(styles.dot, restingState)} />
        );
      })}
    </span>
  );
});

export { Matrix };
export type { MatrixProps, MatrixVariant };
