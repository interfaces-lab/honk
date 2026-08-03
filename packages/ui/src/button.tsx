import { Button as Base } from "@base-ui/react/button";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import {
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
} from "./tokens.stylex";

type ButtonVariant = "primary" | "neutral" | "quiet" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

const sx = stylex.create({
  root: {
    appearance: "none",
    boxSizing: "border-box",
    position: "relative",
    isolation: "isolate",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    maxWidth: "100%",
    gap: controlVars["--honk-control-gap"],
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: "transparent",
    fontFamily: fontVars["--honk-font-family-ui"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
    lineHeight: 1,
    whiteSpace: "nowrap",
    userSelect: "none",
    textDecoration: "none",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
    opacity: { default: 1, ":disabled": controlVars["--honk-control-disabled-opacity"] },
    transitionProperty: "background-color, box-shadow, color, opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
    "::before": {
      content: '""',
      position: "absolute",
      inset: 0,
      zIndex: -2,
      borderRadius: "inherit",
      pointerEvents: "none",
    },
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      zIndex: -1,
      borderRadius: "inherit",
      pointerEvents: "none",
      transitionProperty: "background-color, box-shadow",
      transitionDuration: {
        default: motionVars["--honk-motion-duration-hover"],
        "@media (prefers-reduced-motion: reduce)": "0s",
      },
      transitionTimingFunction: motionVars["--honk-motion-ease-out"],
    },
  },
  block: { width: "100%" },

  sizeSm: {
    height: controlVars["--honk-control-h-sm"],
    paddingInline: controlVars["--honk-control-pad-sm"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  sizeMd: {
    height: controlVars["--honk-control-h-md"],
    paddingInline: controlVars["--honk-control-pad-md"],
    fontSize: fontVars["--honk-font-size-body"],
  },
  sizeLg: {
    height: controlVars["--honk-control-h-lg"],
    paddingInline: controlVars["--honk-control-pad-lg"],
    fontSize: fontVars["--honk-font-size-body"],
  },

  iconSm: {
    height: controlVars["--honk-control-h-sm"],
    width: controlVars["--honk-control-h-sm"],
    paddingInline: 0,
    fontSize: fontVars["--honk-font-size-detail"],
  },
  iconMd: {
    height: controlVars["--honk-control-h-md"],
    width: controlVars["--honk-control-h-md"],
    paddingInline: 0,
    fontSize: fontVars["--honk-font-size-body"],
  },
  iconLg: {
    height: controlVars["--honk-control-h-lg"],
    width: controlVars["--honk-control-h-lg"],
    paddingInline: 0,
    fontSize: fontVars["--honk-font-size-body"],
  },
});

const variants = stylex.create({
  primary: {
    color: colorVars["--honk-color-on-accent"],
    boxShadow: {
      default: elevationVars["--honk-elevation-button-solid"],
      ":disabled": "none",
    },
    "::before": {
      backgroundColor: colorVars["--honk-color-accent-fill"],
    },
    "::after": {
      backgroundColor: {
        default: "transparent",
        ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
        ":active": colorVars["--honk-color-state-press"],
      },
      boxShadow: {
        default: elevationVars["--honk-elevation-button-highlight"],
        ":disabled": "none",
      },
    },
  },
  neutral: {
    color: colorVars["--honk-color-text-primary"],
    boxShadow: {
      default: elevationVars["--honk-elevation-button-neutral"],
      ":disabled": "none",
    },
    "::before": {
      backgroundColor: colorVars["--honk-color-bg-base"],
    },
    "::after": {
      backgroundColor: {
        default: "transparent",
        ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
        ":active": colorVars["--honk-color-state-press"],
      },
      boxShadow: {
        default: elevationVars["--honk-elevation-button-highlight"],
        ":disabled": "none",
      },
    },
  },
  quiet: {
    "::before": {
      backgroundColor: {
        default: "transparent",
        ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
        ":active": colorVars["--honk-color-state-press"],
      },
    },
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
  },
  destructive: {
    color: colorVars["--honk-color-err-fg"],
    boxShadow: {
      default: elevationVars["--honk-elevation-button-solid"],
      ":disabled": "none",
    },
    "::before": {
      backgroundColor: colorVars["--honk-color-err-bg"],
    },
    "::after": {
      backgroundColor: {
        default: "transparent",
        ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
        ":active": colorVars["--honk-color-state-press"],
      },
      boxShadow: {
        default: elevationVars["--honk-elevation-button-highlight"],
        ":disabled": "none",
      },
    },
  },
});

const sizeStyleBySize: Record<ButtonSize, stylex.StyleXStyles> = {
  sm: sx.sizeSm,
  md: sx.sizeMd,
  lg: sx.sizeLg,
};
const iconSizeStyleBySize: Record<ButtonSize, stylex.StyleXStyles> = {
  sm: sx.iconSm,
  md: sx.iconMd,
  lg: sx.iconLg,
};
interface ButtonProps extends Omit<Base.Props, "className" | "style"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconStart?: React.ReactNode;
  iconEnd?: React.ReactNode;
  block?: boolean;
  style?: StyleProp<HonkStyle>;
}

function Button({
  variant = "neutral",
  size = "md",
  iconStart,
  iconEnd,
  block = false,
  style,
  type,
  render,
  children,
  ...rest
}: ButtonProps): React.ReactElement {
  return (
    <Base
      {...rest}
      // Default to type=button so form hosts do not submit. Composed `render` leaves type unset.
      type={type ?? (render ? undefined : "button")}
      render={render}
      data-slot="button"
      {...applyStyle(
        stylex.props(sx.root, sizeStyleBySize[size], variants[variant], block && sx.block),
        style,
      )}
    >
      {iconStart}
      {children}
      {iconEnd}
    </Base>
  );
}

interface IconButtonProps extends Omit<Base.Props, "className" | "style"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  "aria-label": string;
  style?: StyleProp<HonkStyle>;
}

function IconButton({
  variant = "quiet",
  size = "md",
  style,
  type,
  render,
  children,
  ...rest
}: IconButtonProps): React.ReactElement {
  return (
    <Base
      {...rest}
      type={type ?? (render ? undefined : "button")}
      render={render}
      data-slot="icon-button"
      {...applyStyle(stylex.props(sx.root, iconSizeStyleBySize[size], variants[variant]), style)}
    >
      {children}
    </Base>
  );
}

export { Button, IconButton };
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps };
