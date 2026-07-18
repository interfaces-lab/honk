// Loading ring.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, iconVars, motionVars, radiusVars } from "./tokens.stylex";

type SpinnerSize = "sm" | "md" | "lg";
type SpinnerTone = "accent" | "muted";

const spinKeyframes = stylex.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});

const sx = stylex.create({
  // Root does not rotate. Spin lives on the inner ring so layout transforms do not fight.
  root: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  ring: {
    boxSizing: "border-box",
    display: "block",
    borderRadius: radiusVars["--honk-radius-pill"],
    borderStyle: "solid",
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px spinner ring stroke is fixed intrinsic geometry, no border-width token owns it (hairline is 1px)
    borderWidth: "2px",
    // Border longhands only. Tone overrides borderTopColor for the moving arc.
    borderTopColor: colorVars["--honk-color-border-muted"],
    borderRightColor: colorVars["--honk-color-border-muted"],
    borderBottomColor: colorVars["--honk-color-border-muted"],
    borderLeftColor: colorVars["--honk-color-border-muted"],
    animationName: {
      default: spinKeyframes,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: motionVars["--honk-motion-duration-spinner"],
    // Linear keeps constant angular velocity. Eased curves stutter each turn.
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },

  sizeSm: { width: iconVars["--honk-icon-size-sm"], height: iconVars["--honk-icon-size-sm"] },
  sizeMd: { width: iconVars["--honk-icon-size-md"], height: iconVars["--honk-icon-size-md"] },
  sizeLg: { width: iconVars["--honk-icon-size-lg"], height: iconVars["--honk-icon-size-lg"] },
});

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
  // Pass label when this is the only loading cue (role=status). Omit beside visible loading text.
  label?: string;
  style?: StyleProp<HonkStyle>;
}

function Spinner({
  size = "md",
  tone = "accent",
  label,
  style,
}: SpinnerProps): React.ReactElement {
  const a11y =
    label !== undefined ? { role: "status", "aria-label": label } : { "aria-hidden": true };
  return (
    <span {...a11y} data-slot="spinner" {...applyStyle(stylex.props(sx.root), style)}>
      <span {...stylex.props(sx.ring, toneStyleByTone[tone], sizeStyleBySize[size])} />
    </span>
  );
}

export { Spinner };
export type { SpinnerProps, SpinnerSize, SpinnerTone };
