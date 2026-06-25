"use client";

import { mergeProps as mergeBaseProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { colorVars, sizeVars } from "./theme/tokens.stylex";
import { mergeProps } from "./utils";
import { themeProps } from "./utils/themeProps";

type IconSize = "default" | "lg" | "sm" | "xl" | "xs";
type IconTone =
  | "accent"
  | "current"
  | "primary"
  | "quaternary"
  | "secondary"
  | "tertiary"
  | "warning";

interface IconProps extends useRender.ComponentProps<"span"> {
  icon?: React.ReactNode;
  size?: IconSize;
  tone?: IconTone;
  xstyle?: stylex.StyleXStyles;
}

type IconElementProps = {
  "aria-hidden"?: boolean | "false" | "true" | undefined;
  className?: string | undefined;
  focusable?: boolean | "false" | "true" | undefined;
  size?: number | string | undefined;
  style?: React.CSSProperties | undefined;
};

const styles = stylex.create({
  root: {
    alignItems: "center",
    display: "inline-flex",
    flexShrink: 0,
    justifyContent: "center",
  },
});

const sizeStyles = stylex.create({
  default: {
    height: sizeVars["--honk-kit-size-icon-default"],
    width: sizeVars["--honk-kit-size-icon-default"],
  },
  lg: {
    height: sizeVars["--honk-kit-size-icon-lg"],
    width: sizeVars["--honk-kit-size-icon-lg"],
  },
  sm: {
    height: sizeVars["--honk-kit-size-icon-sm"],
    width: sizeVars["--honk-kit-size-icon-sm"],
  },
  xl: {
    height: sizeVars["--honk-kit-size-icon-xl"],
    width: sizeVars["--honk-kit-size-icon-xl"],
  },
  xs: {
    height: sizeVars["--honk-kit-size-icon-xs"],
    width: sizeVars["--honk-kit-size-icon-xs"],
  },
});

const toneStyles = stylex.create({
  accent: {
    color: colorVars["--honk-kit-color-icon-accent-primary"],
  },
  current: {
    color: "currentColor",
  },
  primary: {
    color: colorVars["--honk-kit-color-icon-primary"],
  },
  quaternary: {
    color: colorVars["--honk-kit-color-icon-quaternary"],
  },
  secondary: {
    color: colorVars["--honk-kit-color-icon-secondary"],
  },
  tertiary: {
    color: colorVars["--honk-kit-color-icon-tertiary"],
  },
  warning: {
    color: colorVars["--honk-kit-color-icon-warning"],
  },
});

function hasSizeClass(className: string | undefined): boolean {
  return /(?:^|\s)(?:size|h|w)-/.test(className ?? "");
}

function normalizeIconElement(icon: React.ReactNode): React.ReactNode {
  if (!React.isValidElement<IconElementProps>(icon)) {
    return icon;
  }

  const iconProps: Partial<IconElementProps> = {
    "aria-hidden": icon.props["aria-hidden"] ?? true,
    focusable: icon.props.focusable ?? false,
  };

  if (
    !hasSizeClass(icon.props.className) &&
    icon.props.size == null &&
    icon.props.style?.width == null &&
    icon.props.style?.height == null
  ) {
    iconProps.style = {
      ...icon.props.style,
      display: "block",
      height: "100%",
      width: "100%",
    };
  }

  return React.cloneElement(icon, iconProps);
}

function Icon({
  children,
  className,
  icon,
  render,
  size = "default",
  style,
  tone = "current",
  xstyle,
  ...props
}: IconProps) {
  const defaultProps = {
    ...mergeProps(
      themeProps("icon", { size, tone }),
      stylex.props(styles.root, sizeStyles[size], toneStyles[tone], xstyle),
      className,
      style,
    ),
    children: normalizeIconElement(icon ?? children),
    "data-slot": "icon",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeBaseProps<"span">(defaultProps, props),
    render,
  });
}

export { Icon };
export type { IconProps, IconSize, IconTone };
