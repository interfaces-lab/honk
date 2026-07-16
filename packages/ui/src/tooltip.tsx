import { Tooltip as Base } from "@base-ui/react/tooltip";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, elevationVars, fontVars, motionVars, radiusVars, zVars } from "./tokens.stylex";

// Long enough that scrubbing across triggers does not flash tooltips.
const TOOLTIP_OPEN_DELAY_MS = 500;
// After one close, another opens instantly within this window.
const TOOLTIP_SKIP_MS = 300;
const TOOLTIP_GUTTER_PX = 6;

const TOOLTIP_MAX_WIDTH = "280px";
const TOOLTIP_PAD_X = "8px";
const TOOLTIP_PAD_Y = "4px";

const sx = stylex.create({
  positioner: {
    zIndex: zVars["--honk-z-tooltip"],
  },
  popup: {
    maxWidth: TOOLTIP_MAX_WIDTH,
    paddingInline: TOOLTIP_PAD_X,
    paddingBlock: TOOLTIP_PAD_Y,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: elevationVars["--honk-elevation-floating"],
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-caption"],
    lineHeight: fontVars["--honk-leading-detail"],
    pointerEvents: "none",
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

const tooltipPopupStyles = sx;

function TooltipProvider(props: Base.Provider.Props): React.ReactElement {
  return (
    <Base.Provider
      delay={TOOLTIP_OPEN_DELAY_MS}
      closeDelay={0}
      timeout={TOOLTIP_SKIP_MS}
      {...props}
    />
  );
}

interface TooltipProps {
  label: React.ReactNode;
  children: React.ReactElement;
  side?: Base.Positioner.Props["side"];
  align?: Base.Positioner.Props["align"];
  sideOffset?: number;
  defaultOpen?: boolean;
  delay?: number;
  closeDelay?: number;
  disabled?: boolean;
  popupStyle?: StyleProp<HonkStyle>;
}

function Tooltip({
  label,
  children,
  side = "top",
  align = "center",
  sideOffset = TOOLTIP_GUTTER_PX,
  defaultOpen,
  delay,
  closeDelay,
  disabled,
  popupStyle,
}: TooltipProps): React.ReactElement {
  return (
    <Base.Root defaultOpen={defaultOpen} disabled={disabled}>
      <Base.Trigger render={children} delay={delay} closeDelay={closeDelay} />
      <Base.Portal>
        <Base.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          positionMethod="fixed"
          {...stylex.props(sx.positioner)}
        >
          <Base.Popup {...applyStyle(stylex.props(sx.popup), popupStyle)}>{label}</Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}

type TooltipAnchor = Base.Positioner.Props["anchor"];

interface AnchoredTooltipProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  anchor: TooltipAnchor;
  children: React.ReactNode;
  side?: Base.Positioner.Props["side"];
  align?: Base.Positioner.Props["align"];
  sideOffset?: number;
}

function AnchoredTooltip({
  open,
  onOpenChange,
  anchor,
  children,
  side = "bottom",
  align = "start",
  sideOffset = TOOLTIP_GUTTER_PX,
}: AnchoredTooltipProps): React.ReactElement {
  return (
    <Base.Root open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      <Base.Portal>
        <Base.Positioner
          anchor={anchor}
          side={side}
          align={align}
          sideOffset={sideOffset}
          positionMethod="fixed"
          {...stylex.props(sx.positioner)}
        >
          <Base.Popup {...stylex.props(sx.popup)}>{children}</Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}

export { AnchoredTooltip, Tooltip, TooltipProvider, tooltipPopupStyles };
export type { AnchoredTooltipProps, TooltipAnchor, TooltipProps };
