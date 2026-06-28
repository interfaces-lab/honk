"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import * as stylex from "@stylexjs/stylex";
import type * as React from "react";

import {
  colorVars,
  motionVars,
  radiusVars,
  sizeVars,
  spacingVars,
  typographyVars,
} from "./theme/tokens.stylex";
import { mergeProps } from "./utils";
import { themeProps } from "./utils/themeProps";

type ButtonVariant =
  | "default"
  | "destructive"
  | "destructive-outline"
  | "ghost"
  | "link"
  | "outline"
  | "secondary";
type ButtonSize =
  | "default"
  | "icon"
  | "icon-lg"
  | "icon-sm"
  | "icon-xl"
  | "icon-xs"
  | "lg"
  | "sm"
  | "xl"
  | "xs";
type ButtonTypography = "body" | "caption" | "detail" | "inherit" | "sidebar" | "title";

interface ButtonProps extends ButtonPrimitive.Props {
  icon?: React.ReactNode;
  endContent?: React.ReactNode;
  isIconOnly?: boolean;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  typography?: ButtonTypography;
  xstyle?: stylex.StyleXStyles;
}

const primaryHover = "color-mix(in oklab, var(--primary) 90%, transparent)";
const destructiveHover = "color-mix(in oklab, var(--destructive) 90%, transparent)";
const destructiveWash = "color-mix(in oklab, var(--destructive) 4%, transparent)";
const destructiveBorder = "color-mix(in oklab, var(--destructive) 32%, transparent)";
const secondaryPressed = "color-mix(in oklab, var(--secondary) 80%, transparent)";

const styles = stylex.create({
  root: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radiusVars["--honk-kit-radius-control"],
    borderStyle: "solid",
    borderWidth: 1,
    boxSizing: "border-box",
    cursor: "var(--honk-button-cursor, pointer)",
    display: "inline-flex",
    flexShrink: 0,
    fontFamily: typographyVars["--honk-kit-font-ui"],
    gap: spacingVars["--honk-kit-spacing-1-5"],
    justifyContent: "center",
    outline: {
      default: "none",
      ":focus-visible": `var(--honk-focus-ring-width, 1px) solid var(--honk-focus-ring-color, ${colorVars["--honk-kit-color-ring"]})`,
    },
    outlineOffset: {
      default: 0,
      ":focus-visible": "var(--honk-focus-ring-offset, 2px)",
    },
    position: "relative",
    transitionDuration: {
      default: motionVars["--honk-kit-motion-duration-ui"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionProperty: "color, background-color, border-color, box-shadow, opacity",
    transitionTimingFunction: motionVars["--honk-kit-motion-ease-shell"],
    userSelect: "none",
    whiteSpace: "nowrap",
    "::before": {
      borderRadius: "calc(var(--honk-radius-control) - 1px)",
      content: "''",
      inset: 0,
      pointerEvents: "none",
      position: "absolute",
    },
    ":disabled": {
      cursor: "default",
      opacity: 0.4,
      pointerEvents: "none",
    },
  },
  contentWrapper: {
    display: "contents",
  },
  iconWrapper: {
    alignItems: "center",
    display: "inline-flex",
    flexShrink: 0,
    justifyContent: "center",
  },
  labelText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  endContentWrapper: {
    alignItems: "center",
    color: "inherit",
    display: "inline-flex",
  },
});

const typographyStyles = stylex.create({
  body: {
    fontSize: typographyVars["--honk-kit-text-body"],
    fontWeight: 500,
    lineHeight: typographyVars["--honk-kit-leading-body"],
  },
  caption: {
    fontSize: typographyVars["--honk-kit-text-caption"],
    fontWeight: 400,
    lineHeight: typographyVars["--honk-kit-leading-caption"],
  },
  detail: {
    fontSize: typographyVars["--honk-kit-text-detail"],
    fontWeight: 400,
    lineHeight: typographyVars["--honk-kit-leading-detail"],
  },
  inherit: {
    fontWeight: 400,
  },
  sidebar: {
    fontSize: typographyVars["--honk-kit-text-sidebar-label"],
    fontWeight: 400,
    lineHeight: typographyVars["--honk-kit-leading-sidebar-label"],
  },
  title: {
    fontSize: typographyVars["--honk-kit-text-title"],
    fontWeight: 500,
    lineHeight: typographyVars["--honk-kit-leading-title"],
  },
});

const sizeStyles = stylex.create({
  default: {
    height: sizeVars["--honk-kit-size-button"],
    paddingInline: spacingVars["--honk-kit-spacing-2-5"],
  },
  icon: {
    height: "20px",
    padding: 0,
    width: "20px",
  },
  iconLg: {
    height: sizeVars["--honk-kit-size-button"],
    padding: 0,
    width: sizeVars["--honk-kit-size-button"],
  },
  iconSm: {
    height: "16px",
    padding: 0,
    width: "16px",
  },
  iconXl: {
    height: "28px",
    padding: 0,
    width: "28px",
  },
  iconXs: {
    borderRadius: radiusVars["--honk-kit-radius-sm"],
    height: "14px",
    padding: 0,
    width: "14px",
    "::before": {
      borderRadius: "calc(var(--radius-sm) - 1px)",
    },
  },
  lg: {
    height: sizeVars["--honk-kit-size-button-lg"],
    paddingInline: spacingVars["--honk-kit-spacing-3"],
  },
  sm: {
    gap: spacingVars["--honk-kit-spacing-1"],
    height: sizeVars["--honk-kit-size-button-sm"],
    paddingInline: spacingVars["--honk-kit-spacing-2"],
  },
  xl: {
    fontSize: typographyVars["--honk-kit-text-title"],
    height: sizeVars["--honk-kit-size-button-xl"],
    lineHeight: typographyVars["--honk-kit-leading-title"],
    paddingInline: spacingVars["--honk-kit-spacing-3-5"],
  },
  xs: {
    borderRadius: radiusVars["--honk-kit-radius-sm"],
    fontSize: typographyVars["--honk-kit-text-detail"],
    gap: spacingVars["--honk-kit-spacing-1"],
    height: sizeVars["--honk-kit-size-button-xs"],
    lineHeight: typographyVars["--honk-kit-leading-detail"],
    paddingInline: spacingVars["--honk-kit-spacing-1-5"],
    "::before": {
      borderRadius: "calc(var(--radius-sm) - 1px)",
    },
  },
});

const iconSizeStyles = stylex.create({
  default: {
    fontSize: sizeVars["--honk-kit-size-icon-default"],
    height: sizeVars["--honk-kit-size-icon-default"],
    width: sizeVars["--honk-kit-size-icon-default"],
  },
  sm: {
    fontSize: sizeVars["--honk-kit-size-icon-sm"],
    height: sizeVars["--honk-kit-size-icon-sm"],
    width: sizeVars["--honk-kit-size-icon-sm"],
  },
});

const variantStyles = stylex.create({
  default: {
    backgroundColor: {
      default: colorVars["--honk-kit-color-primary"],
      ":hover": primaryHover,
      ":active": primaryHover,
    },
    borderColor: "transparent",
    boxShadow: "none",
    color: colorVars["--honk-kit-color-primary-foreground"],
  },
  destructive: {
    backgroundColor: {
      default: colorVars["--honk-kit-color-destructive"],
      ":hover": destructiveHover,
      ":active": destructiveHover,
    },
    borderColor: colorVars["--honk-kit-color-destructive"],
    boxShadow: `0 1px 2px color-mix(in oklab, var(--destructive) 16%, transparent)`,
    color: colorVars["--honk-kit-color-white"],
  },
  destructiveOutline: {
    backgroundColor: {
      default: colorVars["--honk-kit-color-popover"],
      ":hover": destructiveWash,
      ":active": destructiveWash,
    },
    borderColor: {
      default: colorVars["--honk-kit-color-input"],
      ":hover": destructiveBorder,
      ":active": destructiveBorder,
    },
    boxShadow: "0 1px 2px color-mix(in oklab, black 5%, transparent)",
    color: colorVars["--honk-kit-color-destructive-foreground"],
  },
  ghost: {
    backgroundColor: {
      default: "transparent",
      ":hover": colorVars["--honk-kit-color-bg-quaternary"],
      ":active": colorVars["--honk-kit-color-bg-tertiary"],
    },
    borderColor: "transparent",
    boxShadow: "none",
    color: {
      default: colorVars["--honk-kit-color-fg-secondary"],
      ":hover": colorVars["--honk-kit-color-fg-primary"],
    },
  },
  link: {
    backgroundColor: "transparent",
    borderColor: "transparent",
    boxShadow: "none",
    color: "inherit",
    textDecorationLine: {
      default: "none",
      ":hover": "underline",
      ":active": "underline",
    },
    textUnderlineOffset: 4,
  },
  outline: {
    backgroundColor: {
      default: colorVars["--honk-kit-color-bg-quinary"],
      ":hover": colorVars["--honk-kit-color-bg-quaternary"],
      ":active": colorVars["--honk-kit-color-bg-tertiary"],
    },
    borderColor: {
      default: colorVars["--honk-kit-color-stroke-tertiary"],
      ":hover": colorVars["--honk-kit-color-stroke-secondary"],
    },
    boxShadow: "none",
    color: {
      default: colorVars["--honk-kit-color-fg-secondary"],
      ":hover": colorVars["--honk-kit-color-fg-primary"],
    },
  },
  secondary: {
    backgroundColor: {
      default: colorVars["--honk-kit-color-secondary"],
      ":hover": colorVars["--honk-kit-color-hover"],
      ":active": secondaryPressed,
    },
    borderColor: "transparent",
    boxShadow: "none",
    color: colorVars["--honk-kit-color-secondary-foreground"],
  },
});

const sizeStyleByProp: Record<ButtonSize, stylex.StyleXStyles> = {
  default: sizeStyles.default,
  icon: sizeStyles.icon,
  "icon-lg": sizeStyles.iconLg,
  "icon-sm": sizeStyles.iconSm,
  "icon-xl": sizeStyles.iconXl,
  "icon-xs": sizeStyles.iconXs,
  lg: sizeStyles.lg,
  sm: sizeStyles.sm,
  xl: sizeStyles.xl,
  xs: sizeStyles.xs,
};

const variantStyleByProp: Record<ButtonVariant, stylex.StyleXStyles> = {
  default: variantStyles.default,
  destructive: variantStyles.destructive,
  "destructive-outline": variantStyles.destructiveOutline,
  ghost: variantStyles.ghost,
  link: variantStyles.link,
  outline: variantStyles.outline,
  secondary: variantStyles.secondary,
};

const typographyStyleByProp: Record<ButtonTypography, stylex.StyleXStyles> = {
  body: typographyStyles.body,
  caption: typographyStyles.caption,
  detail: typographyStyles.detail,
  inherit: typographyStyles.inherit,
  sidebar: typographyStyles.sidebar,
  title: typographyStyles.title,
};

const iconSizeStyleByButtonSize: Record<ButtonSize, stylex.StyleXStyles> = {
  default: iconSizeStyles.default,
  icon: iconSizeStyles.default,
  "icon-lg": iconSizeStyles.default,
  "icon-sm": iconSizeStyles.default,
  "icon-xl": iconSizeStyles.default,
  "icon-xs": iconSizeStyles.sm,
  lg: iconSizeStyles.default,
  sm: iconSizeStyles.default,
  xl: iconSizeStyles.default,
  xs: iconSizeStyles.sm,
};

const iconButtonSizes = new Set<ButtonSize>(["icon", "icon-lg", "icon-sm", "icon-xl", "icon-xs"]);

const warnedIconButtons = new Set<string>();

function warnIfMissingIconButtonName({
  ariaLabel,
  ariaLabelledBy,
  className,
  size,
  title,
}: {
  ariaLabel?: ButtonProps["aria-label"];
  ariaLabelledBy?: ButtonProps["aria-labelledby"];
  className?: ButtonProps["className"];
  size: ButtonSize;
  title?: ButtonProps["title"];
}) {
  if (!iconButtonSizes.has(size)) return;
  if (ariaLabel || ariaLabelledBy || title) return;

  const warningKey = `${size}:${typeof className === "function" ? "classNameFn" : (className ?? "")}`;
  if (warnedIconButtons.has(warningKey)) return;
  warnedIconButtons.add(warningKey);

  console.warn(
    "HonkKit Button with an icon-only size needs aria-label, aria-labelledby, or title.",
  );
}

function ButtonIconSlot({ children, size }: { children: React.ReactNode; size: ButtonSize }) {
  return (
    <span {...stylex.props(styles.iconWrapper, iconSizeStyleByButtonSize[size])}>
      {children}
    </span>
  );
}

// Legacy children are rendered verbatim, matching the pre-stylex CVA button: the
// root `inline-flex` + `gap` + `alignItems:center` lays out icon + text, and icon
// sizing is driven by the caller's `[&_svg]:size-*` utilities or explicit icon
// classes. Wrapping arbitrary component children (e.g. Truncate/MiddleTruncate)
// in an icon slot misclassifies text as icons, force-sizes them to 100%/100%, and
// drops the gap/padding that the root flex provides.
function renderLegacyChildren(children: React.ReactNode): React.ReactNode {
  return children;
}

function renderButtonContent({
  children,
  endContent,
  icon,
  isIconOnly,
  label,
  size,
}: {
  children: React.ReactNode;
  endContent: React.ReactNode;
  icon: React.ReactNode;
  isIconOnly: boolean;
  label: string | undefined;
  size: ButtonSize;
}): React.ReactNode {
  const content = children ?? label;

  if (icon == null && endContent == null && !isIconOnly && label == null) {
    return renderLegacyChildren(children);
  }

  return (
    <span {...stylex.props(styles.contentWrapper)}>
      {icon != null ? <ButtonIconSlot size={size}>{icon}</ButtonIconSlot> : null}
      {!isIconOnly && content != null ? (
        <span {...stylex.props(styles.labelText)}>{content}</span>
      ) : null}
      {!isIconOnly && endContent != null ? (
        <span {...stylex.props(styles.endContentWrapper)}>{endContent}</span>
      ) : null}
    </span>
  );
}

function Button({
  children,
  className,
  endContent,
  icon,
  isIconOnly = false,
  label,
  render,
  size = "default",
  style,
  type,
  typography = "body",
  variant = "default",
  xstyle,
  ...props
}: ButtonProps) {
  warnIfMissingIconButtonName({
    ariaLabel: props["aria-label"],
    ariaLabelledBy: props["aria-labelledby"],
    className,
    size,
    title: props.title,
  });

  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] =
    type ?? (render ? undefined : "button");
  const mergedProps = mergeProps(
    themeProps("button", { variant, size, typography }),
    stylex.props(
      styles.root,
      typographyStyleByProp[typography],
      sizeStyleByProp[size],
      variantStyleByProp[variant],
      xstyle,
    ),
    typeof className === "function" ? undefined : className,
    typeof style === "function" ? undefined : style,
  );
  const mergedClassName =
    typeof mergedProps.className === "string" ? mergedProps.className : undefined;
  const classNameProp: ButtonPrimitive.Props["className"] =
    typeof className === "function"
      ? (state) => [mergedClassName, className(state)].filter(Boolean).join(" ") || undefined
      : mergedClassName;
  const mergedStyle = mergedProps.style;
  const styleProp: ButtonPrimitive.Props["style"] =
    typeof style === "function"
      ? (state) => {
          const resolvedStyle = style(state);
          return mergedStyle && resolvedStyle
            ? { ...mergedStyle, ...resolvedStyle }
            : (resolvedStyle ?? mergedStyle);
        }
      : mergedStyle;

  return (
    <ButtonPrimitive
      {...mergedProps}
      {...props}
      className={classNameProp}
      data-slot="button"
      render={render}
      style={styleProp}
      type={typeValue}
    >
      {renderButtonContent({ children, endContent, icon, isIconOnly, label, size })}
    </ButtonPrimitive>
  );
}

export { Button };
export type { ButtonProps, ButtonSize, ButtonTypography, ButtonVariant };
