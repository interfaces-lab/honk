// Interactive floating surface. Shares the tooltip overlay recipe with pointer events kept on.

import { Popover as Base } from "@base-ui/react/popover";
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

const POPOVER_GUTTER_PX = 8;

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
  title: {
    margin: 0,
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-title"],
    fontWeight: fontVars["--honk-font-weight-medium"],
    color: colorVars["--honk-color-text-primary"],
  },
  description: {
    margin: 0,
    fontSize: fontVars["--honk-font-size-caption"],
    lineHeight: fontVars["--honk-leading-detail"],
    color: colorVars["--honk-color-text-muted"],
  },
});

interface PopoverPopupProps extends Omit<Base.Popup.Props, "className" | "style"> {
  side?: Base.Positioner.Props["side"];
  sideOffset?: number;
  align?: Base.Positioner.Props["align"];
  anchor?: Base.Positioner.Props["anchor"];
  positionMethod?: Base.Positioner.Props["positionMethod"];
  collisionAvoidance?: Base.Positioner.Props["collisionAvoidance"];
  collisionPadding?: Base.Positioner.Props["collisionPadding"];
  style?: StyleProp<HonkStyle>;
}

function PopoverPopup({
  side = "bottom",
  sideOffset = POPOVER_GUTTER_PX,
  align = "center",
  anchor,
  positionMethod,
  collisionAvoidance,
  collisionPadding,
  style,
  children,
  ...rest
}: PopoverPopupProps): React.ReactElement {
  return (
    <Base.Portal>
      <Base.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        anchor={anchor}
        positionMethod={positionMethod}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={collisionPadding}
        {...stylex.props(sx.positioner)}
      >
        <Base.Popup {...rest} data-slot="popover" {...applyStyle(stylex.props(sx.popup), style)}>
          {children}
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}

interface PopoverTitleProps extends Omit<Base.Title.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function PopoverTitle({ style, ...rest }: PopoverTitleProps): React.ReactElement {
  return <Base.Title {...rest} data-slot="popover-title" {...applyStyle(stylex.props(sx.title), style)} />;
}

interface PopoverDescriptionProps extends Omit<Base.Description.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function PopoverDescription({ style, ...rest }: PopoverDescriptionProps): React.ReactElement {
  return (
    <Base.Description {...rest} data-slot="popover-description" {...applyStyle(stylex.props(sx.description), style)} />
  );
}

const Popover = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Popup: PopoverPopup,
  Title: PopoverTitle,
  Description: PopoverDescription,
  Close: Base.Close,
  Arrow: Base.Arrow,
};

export { Popover };
export type { PopoverPopupProps, PopoverTitleProps, PopoverDescriptionProps };
