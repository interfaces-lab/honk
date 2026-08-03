import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Matrix } from "./matrix";
import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, conversationVars, fontVars, motionVars, spaceVars } from "./tokens.stylex";

const LABEL_OPACITY = 0.8;
// Three columns is the whole chevron: one front entering, one leaving.
const DRIVE_GRID = 3;
const ELAPSED_TICK_MS = 100;
const CLOCK_UNAVAILABLE = 0;
// Mask uses black as alpha, not a theme color. Stop offsets are fixed animation geometry.
const SHIMMER_MASK =
  "linear-gradient(90deg, oklch(0 0 0 / 0.45) 0%, oklch(0 0 0 / 0.45) 30%, " +
  "oklch(0 0 0) 50%, oklch(0 0 0 / 0.45) 70%, oklch(0 0 0 / 0.45) 100%)";

const thinkingShimmer = stylex.keyframes({
  to: { maskPosition: "-200% center" },
});

const styles = stylex.create({
  row: {
    display: "flex",
    width: "100%",
    minWidth: 0,
    alignItems: "center",
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px hairline vertical inset is fixed geometry, no spacing token owns it
    paddingBlock: "2px",
  },
  loader: {
    display: "inline-flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    maxWidth: "100%",
    minHeight: conversationVars["--honk-conversation-row-min-h"],
    paddingInline: conversationVars["--honk-conversation-inset"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body-lg"],
    lineHeight: fontVars["--honk-leading-heading"],
    color: colorVars["--honk-color-fg-secondary"],
    opacity: LABEL_OPACITY,
  },
  // Reduced motion drops the animation and the mask. Leaving a still partial mask would look faded.
  label: {
    animationName: {
      default: thinkingShimmer,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: motionVars["--honk-motion-duration-shimmer"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
    maskImage: {
      default: SHIMMER_MASK,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    maskSize: "200% 100%",
  },
  elapsed: {
    flexShrink: 0,
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-detail"],
    fontVariantNumeric: "tabular-nums",
    color: colorVars["--honk-color-fg-tertiary"],
  },
});

interface StatusRowProps {
  children: string;
  // Epoch for the elapsed readout. The caller decides when a wait has run long
  // enough to owe the user a number; passing null keeps the row quiet.
  startedAtMs?: number | null;
  style?: StyleProp<HonkStyle>;
}

function StatusRow({ children, startedAtMs = null, style }: StatusRowProps): React.ReactElement {
  const elapsed = useElapsedLabel(startedAtMs);

  return (
    <div role="status" aria-label={children} {...applyStyle(stylex.props(styles.row), style)}>
      <span {...stylex.props(styles.loader)}>
        <Matrix variant="drive" grid={DRIVE_GRID} />
        <span aria-hidden={true} {...stylex.props(styles.label)}>
          {children}
        </span>
        {/* Hidden from the tree so the ticking figure never reaches role="status" as a live update. */}
        {elapsed === null ? null : (
          <span aria-hidden={true} {...stylex.props(styles.elapsed)}>
            {elapsed}
          </span>
        )}
      </span>
    </div>
  );
}

// The clock lives on this leaf so a 10Hz tick re-renders the status row alone,
// never the transcript that owns the waiting state.
function useElapsedLabel(startedAtMs: number | null): string | null {
  const nowMs = React.useSyncExternalStore(
    startedAtMs === null ? subscribeIdle : subscribeClock,
    getClockSnapshot,
    getClockServerSnapshot,
  );

  if (startedAtMs === null || nowMs === CLOCK_UNAVAILABLE) {
    return null;
  }
  return formatElapsed(Math.max(0, nowMs - startedAtMs));
}

// One shared interval drives every mounted row; it stops when the last unmounts.
const clockListeners = new Set<() => void>();
let clockNowMs = 0;
let clockTimer: number | null = null;

function subscribeIdle(): () => void {
  return () => {};
}

function subscribeClock(onStoreChange: () => void): () => void {
  clockListeners.add(onStoreChange);
  if (clockTimer === null) {
    clockTimer = window.setInterval(() => {
      clockNowMs = Date.now();
      for (const listener of clockListeners) {
        listener();
      }
    }, ELAPSED_TICK_MS);
  }
  return () => {
    clockListeners.delete(onStoreChange);
    if (clockListeners.size === 0 && clockTimer !== null) {
      window.clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

// Self-freshening but stable within a tick window. Returning a raw Date.now()
// would make every consistency check look like a new store value and loop.
function getClockSnapshot(): number {
  const nowMs = Date.now();
  if (nowMs - clockNowMs >= ELAPSED_TICK_MS) {
    clockNowMs = nowMs;
  }
  return clockNowMs;
}

// Static render has no clock. Report that rather than let the row claim 0.0s
// for a wait the caller only surfaces once it is already 15 seconds old.
function getClockServerSnapshot(): number {
  return CLOCK_UNAVAILABLE;
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = elapsedMs / 1_000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  // Zero-padded so the seconds field holds its width against tabular figures.
  const seconds = totalSeconds % 60;
  return `${Math.floor(totalSeconds / 60)}m ${seconds < 10 ? "0" : ""}${seconds.toFixed(1)}s`;
}

export { StatusRow };
export type { StatusRowProps };
