// Form-staged boolean. Inset shadow ring so state toggles do not shift layout.

import { Checkbox as Base } from "@base-ui/react/checkbox";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Icon } from "./icon";
import { IconCheckmark1 } from "./icons";
import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, motionVars, radiusVars } from "./tokens.stylex";

type CheckboxSize = "sm" | "md";

const BOX_SIZE_MD = "18px";
const BOX_SIZE_SM = "16px";
const DASH_WIDTH = "8px";
const DASH_HEIGHT = "2px";
const RING_BASE = `inset 0 0 0 1px ${colorVars["--honk-color-border-base"]}`;
const FOCUS_RING_WIDTH = "1px";
const FOCUS_RING_OFFSET = "2px";

const sx = stylex.create({
  root: {
    appearance: "none",
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    userSelect: "none",
    cursor: { default: "pointer", "[data-disabled]": "default" },
    backgroundColor: {
      default: colorVars["--honk-color-layer-01"],
      "[data-checked]": colorVars["--honk-color-accent-fill"],
      "[data-indeterminate]": colorVars["--honk-color-accent-fill"],
    },
    boxShadow: {
      default: RING_BASE,
      "[data-checked]": "none",
      "[data-indeterminate]": "none",
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
  boxMd: { width: BOX_SIZE_MD, height: BOX_SIZE_MD },
  boxSm: { width: BOX_SIZE_SM, height: BOX_SIZE_SM },

  indicator: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
    pointerEvents: "none",
    color: {
      default: colorVars["--honk-color-on-accent"],
      "[data-indeterminate]": "transparent",
    },
    "::before": {
      content: '""',
      position: "absolute",
      inset: 0,
      margin: "auto",
      width: DASH_WIDTH,
      height: DASH_HEIGHT,
      borderRadius: radiusVars["--honk-radius-pill"],
      backgroundColor: colorVars["--honk-color-on-accent"],
      display: { default: "none", "[data-indeterminate]": "block" },
    },
    opacity: {
      default: 1,
      "[data-starting-style]": 0,
      "[data-ending-style]": 0,
    },
    transitionProperty: "opacity",
    transitionTimingFunction: {
      default: motionVars["--honk-motion-ease-out"],
      "[data-ending-style]": motionVars["--honk-motion-ease-in"],
    },
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "[data-ending-style]": motionVars["--honk-motion-duration-instant"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
});

const boxSizeBySize: Record<CheckboxSize, stylex.StyleXStyles> = {
  sm: sx.boxSm,
  md: sx.boxMd,
};

interface CheckboxProps extends Omit<Base.Root.Props, "className" | "style"> {
  size?: CheckboxSize;
  style?: StyleProp<HonkStyle>;
}

function Checkbox({ size = "md", style, ...rest }: CheckboxProps): React.ReactElement {
  return (
    <Base.Root
      {...rest}
      data-slot="checkbox"
      {...applyStyle(stylex.props(sx.root, boxSizeBySize[size]), style)}
    >
      {/* No keepMounted: Base UI mounts the tick on check/indeterminate and holds it through the exit
          fade. The checkmark stays rendered (just transparent) while indeterminate so the box the
          dash centres in never collapses. */}
      <Base.Indicator data-slot="checkbox-indicator" {...stylex.props(sx.indicator)}>
        <Icon icon={IconCheckmark1} size="xs" />
      </Base.Indicator>
    </Base.Root>
  );
}

export { Checkbox };
export type { CheckboxProps, CheckboxSize };
