// Instant-effect toggle. Inset shadow ring so state toggles do not shift layout.

import { Switch as Base } from "@base-ui/react/switch";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, motionVars, radiusVars } from "./tokens.stylex";

type SwitchSize = "sm" | "md";

const THUMB_INSET = "2px";
const MD_TRACK_W = "30px";
const MD_TRACK_H = "18px";
const MD_THUMB = "14px";
const SM_TRACK_W = "26px";
const SM_TRACK_H = "16px";
const SM_THUMB = "12px";
const MD_SHIFT = "translateX(12px)";
const SM_SHIFT = "translateX(10px)";

const RING_MUTED = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;
const FOCUS_RING_WIDTH = "1px";
const FOCUS_RING_OFFSET = "2px";

const sx = stylex.create({
  root: {
    appearance: "none",
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    padding: THUMB_INSET,
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-pill"],
    userSelect: "none",
    cursor: { default: "pointer", "[data-disabled]": "default" },
    backgroundColor: {
      default: colorVars["--honk-color-layer-02"],
      "[data-checked]": colorVars["--honk-color-accent-fill"],
    },
    boxShadow: {
      default: RING_MUTED,
      "[data-checked]": "none",
    },
    // Focus drawn with `outline` so it never collides with the ring box-shadow (button.tsx slot).
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: FOCUS_RING_WIDTH,
    outlineOffset: FOCUS_RING_OFFSET,
    opacity: { default: 1, "[data-disabled]": 0.4 },
    transitionProperty: "background-color, box-shadow",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  trackMd: { width: MD_TRACK_W, height: MD_TRACK_H },
  trackSm: { width: SM_TRACK_W, height: SM_TRACK_H },

  thumb: {
    display: "block",
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-on-accent"],
    pointerEvents: "none",
    transitionProperty: "transform",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  thumbMd: {
    width: MD_THUMB,
    height: MD_THUMB,
    transform: { default: "translateX(0)", "[data-checked]": MD_SHIFT },
  },
  thumbSm: {
    width: SM_THUMB,
    height: SM_THUMB,
    transform: { default: "translateX(0)", "[data-checked]": SM_SHIFT },
  },
});

const trackSizeBySize: Record<SwitchSize, stylex.StyleXStyles> = {
  sm: sx.trackSm,
  md: sx.trackMd,
};
// StyleX types conditional transform as unknown. Cast thumb size styles despite valid runtime CSS.

const thumbSizeBySize = {
  sm: sx.thumbSm,
  md: sx.thumbMd,
} as unknown as Record<SwitchSize, stylex.StyleXStyles>;

interface SwitchProps extends Omit<Base.Root.Props, "className" | "style"> {
  size?: SwitchSize;
  style?: StyleProp<HonkStyle>;
}

function Switch({ size = "md", style, ...rest }: SwitchProps): React.ReactElement {
  return (
    <Base.Root
      {...rest}
      data-slot="switch"
      {...applyStyle(stylex.props(sx.root, trackSizeBySize[size]), style)}
    >
      <Base.Thumb data-slot="switch-thumb" {...stylex.props(sx.thumb, thumbSizeBySize[size])} />
    </Base.Root>
  );
}

export { Switch };
export type { SwitchProps, SwitchSize };
