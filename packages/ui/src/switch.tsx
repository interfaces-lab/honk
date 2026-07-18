// Instant-effect toggle. Inset shadow ring so state toggles do not shift layout.

import { Switch as Base } from "@base-ui/react/switch";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, controlVars, motionVars, radiusVars } from "./tokens.stylex";

type SwitchSize = "sm" | "md";

const RING_MUTED = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;

const sx = stylex.create({
  root: {
    appearance: "none",
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px thumb inset is fixed switch-track geometry, no spacing token owns it
    padding: "2px",
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
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
    opacity: { default: 1, "[data-disabled]": 0.4 },
    transitionProperty: "background-color, box-shadow",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  trackMd: { width: "30px", height: "18px" },
  trackSm: { width: "26px", height: "16px" },

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
    width: "14px",
    height: "14px",
    transform: { default: "translateX(0)", "[data-checked]": "translateX(12px)" },
  },
  thumbSm: {
    width: "12px",
    height: "12px",
    transform: { default: "translateX(0)", "[data-checked]": "translateX(10px)" },
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
