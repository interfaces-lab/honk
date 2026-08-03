// Read-only hover surface. Shares the popover overlay recipe; opens on hover or
// focus only, never traps focus, and never blocks activating its trigger.

import { PreviewCard as Base } from "@base-ui/react/preview-card";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import {
  colorVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
  zVars,
} from "./tokens.stylex";

const PREVIEW_CARD_GUTTER_PX = 8;
// Deliberate pause so casual pointer travel across rows does not flash cards.
const PREVIEW_CARD_OPEN_DELAY_MS = 400;

const RING_MUTED = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;

const sx = stylex.create({
  positioner: {
    zIndex: zVars["--honk-z-popover"],
  },
  popup: {
    boxSizing: "border-box",
    padding: spaceVars["--honk-space-panel-pad"],
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `${RING_MUTED}, ${elevationVars["--honk-elevation-floating"]}`,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],

    transformOrigin: "var(--transform-origin)",
    opacity: {
      default: 1,
      "[data-starting-style]": 0,
      "[data-ending-style]": 0,
    },
    scale: {
      default: 1,
      "[data-starting-style]": motionVars["--honk-motion-scale-overlay"],
      "[data-ending-style]": motionVars["--honk-motion-scale-overlay"],
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transitionProperty: "opacity, scale",
    transitionTimingFunction: {
      default: motionVars["--honk-motion-ease-out"],
      "[data-ending-style]": motionVars["--honk-motion-ease-in"],
    },
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "[data-ending-style]": motionVars["--honk-motion-duration-instant"],
      "[data-instant]": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
});

interface PreviewCardTriggerProps extends Omit<Base.Trigger.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function PreviewCardTrigger({
  delay = PREVIEW_CARD_OPEN_DELAY_MS,
  style,
  ...rest
}: PreviewCardTriggerProps): React.ReactElement {
  return (
    <Base.Trigger
      delay={delay}
      {...rest}
      data-slot="preview-card-trigger"
      {...applyStyle({}, style)}
    />
  );
}

interface PreviewCardPopupProps extends Omit<Base.Popup.Props, "className" | "style"> {
  side?: Base.Positioner.Props["side"];
  sideOffset?: number;
  align?: Base.Positioner.Props["align"];
  anchor?: Base.Positioner.Props["anchor"];
  collisionAvoidance?: Base.Positioner.Props["collisionAvoidance"];
  collisionPadding?: Base.Positioner.Props["collisionPadding"];
  style?: StyleProp<HonkStyle>;
}

function PreviewCardPopup({
  side = "inline-end",
  sideOffset = PREVIEW_CARD_GUTTER_PX,
  align = "start",
  anchor,
  collisionAvoidance,
  collisionPadding,
  style,
  children,
  ...rest
}: PreviewCardPopupProps): React.ReactElement {
  return (
    <Base.Portal>
      <Base.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        anchor={anchor}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={collisionPadding}
        {...stylex.props(sx.positioner)}
      >
        <Base.Popup
          {...rest}
          data-slot="preview-card"
          {...applyStyle(stylex.props(sx.popup), style)}
        >
          {children}
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}

const PreviewCard = {
  Root: Base.Root,
  Trigger: PreviewCardTrigger,
  Popup: PreviewCardPopup,
};

export { PreviewCard };
export type { PreviewCardPopupProps, PreviewCardTriggerProps };
