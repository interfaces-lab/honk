
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, motionVars, radiusVars } from "./tokens.stylex";

type StatusDotTone = "ok" | "warn" | "err" | "info" | "accent" | "neutral" | "draft";

// Dot diameter is display anatomy, not a shared token.
const DOT_SIZE = "6px";
// Inset ring keeps the draft hollow without growing past DOT_SIZE.
const DRAFT_RING = `inset 0 0 0 1px ${colorVars["--honk-color-text-faint"]}`;

// Opacity pulse only. Scale would clip past the box.
const pulseKeyframes = stylex.keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.35 },
});

const styles = stylex.create({
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
  draft: {
    backgroundColor: "transparent",
    boxShadow: DRAFT_RING,
  },
  pulse: {
    animationName: pulseKeyframes,
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
  pulse?: boolean;
  // Pass label when the dot is the only status cue. Omit it beside adjacent text.
  label?: string;
  style?: StyleProp<HonkStyle>;
}

function StatusDot({
  tone = "neutral",
  pulse = false,
  label,
  style,
}: StatusDotProps): React.ReactElement {
  const a11y = label !== undefined ? { role: "status", "aria-label": label } : { "aria-hidden": true };
  return (
    <span {...a11y} data-slot="status-dot" {...applyStyle(stylex.props(styles.root), style)}>
      <span {...stylex.props(styles.dot, toneStyles[tone], pulse && styles.pulse)} />
    </span>
  );
}

export { StatusDot };
export type { StatusDotProps, StatusDotTone };
