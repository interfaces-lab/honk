"use client";

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

type TextElement = "span" | "p" | "div" | "label" | "h1" | "h2" | "h3";
type TextSize = "xs" | "sm" | "base" | "lg" | "xl" | "tab" | "chrome" | "workbench";
type TextTone =
  | "primary"
  | "secondary"
  | "tertiary"
  | "quaternary"
  | "destructive"
  | "success"
  | "warning"
  | "inherit";
type TextWeight = "regular" | "medium" | "semibold";
type TextDisplay = "inline" | "block" | "inline-block";
type TextAlign = "start" | "center" | "end";

type TextProps<Element extends TextElement = "span"> = Omit<
  React.ComponentPropsWithoutRef<Element>,
  "as" | "className" | "style"
> & {
  as?: Element;
  size?: TextSize;
  tone?: TextTone;
  weight?: TextWeight;
  display?: TextDisplay;
  align?: TextAlign;
  truncate?: boolean;
  tabularNums?: boolean;
};

const styles = stylex.create({
  root: {
    fontFamily: "var(--honk-font-ui)",
  },
  sizeXs: {
    fontSize: "var(--honk-text-caption)",
    lineHeight: "var(--honk-leading-caption)",
  },
  sizeSm: {
    fontSize: "var(--honk-text-detail)",
    lineHeight: "var(--honk-leading-detail)",
  },
  sizeBase: {
    fontSize: "var(--honk-text-body)",
    lineHeight: "var(--honk-leading-body)",
  },
  sizeLg: {
    fontSize: "var(--honk-text-title)",
    lineHeight: "var(--honk-leading-title)",
  },
  sizeXl: {
    fontSize: "var(--honk-text-heading)",
    lineHeight: "var(--honk-leading-heading)",
  },
  sizeTab: {
    fontSize: "var(--honk-text-tab)",
    lineHeight: "var(--honk-leading-tab)",
  },
  sizeChrome: {
    fontSize: "var(--honk-text-chrome)",
    lineHeight: "var(--honk-leading-chrome)",
  },
  sizeWorkbench: {
    fontSize: "var(--honk-text-conversation-lg)",
    lineHeight: "var(--honk-leading-conversation-lg)",
  },
  tonePrimary: {
    color: "var(--honk-fg-primary)",
  },
  toneSecondary: {
    color: "var(--honk-fg-secondary)",
  },
  toneTertiary: {
    color: "var(--honk-fg-tertiary)",
  },
  toneQuaternary: {
    color: "var(--honk-fg-quaternary)",
  },
  toneDestructive: {
    color: "var(--honk-fg-red-primary)",
  },
  toneSuccess: {
    color: "var(--honk-fg-green-primary)",
  },
  toneWarning: {
    color: "var(--honk-tone-yellow)",
  },
  weightRegular: {
    fontWeight: 400,
  },
  weightMedium: {
    fontWeight: 500,
  },
  weightSemibold: {
    fontWeight: 590,
  },
  displayInline: {
    display: "inline",
  },
  displayBlock: {
    display: "block",
  },
  displayInlineBlock: {
    display: "inline-block",
  },
  alignStart: {
    textAlign: "start",
  },
  alignCenter: {
    textAlign: "center",
  },
  alignEnd: {
    textAlign: "end",
  },
  truncate: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tabularNums: {
    fontVariantNumeric: "tabular-nums",
  },
});

const sizeStyles: Record<TextSize, stylex.StyleXStyles> = {
  base: styles.sizeBase,
  chrome: styles.sizeChrome,
  lg: styles.sizeLg,
  sm: styles.sizeSm,
  tab: styles.sizeTab,
  workbench: styles.sizeWorkbench,
  xl: styles.sizeXl,
  xs: styles.sizeXs,
};

const toneStyles: Record<TextTone, stylex.StyleXStyles | null> = {
  destructive: styles.toneDestructive,
  inherit: null,
  primary: styles.tonePrimary,
  quaternary: styles.toneQuaternary,
  secondary: styles.toneSecondary,
  success: styles.toneSuccess,
  tertiary: styles.toneTertiary,
  warning: styles.toneWarning,
};

const weightStyles: Record<TextWeight, stylex.StyleXStyles> = {
  medium: styles.weightMedium,
  regular: styles.weightRegular,
  semibold: styles.weightSemibold,
};

const displayStyles: Record<TextDisplay, stylex.StyleXStyles> = {
  block: styles.displayBlock,
  inline: styles.displayInline,
  "inline-block": styles.displayInlineBlock,
};

const alignStyles: Record<TextAlign, stylex.StyleXStyles> = {
  center: styles.alignCenter,
  end: styles.alignEnd,
  start: styles.alignStart,
};

function Text<Element extends TextElement = "span">(props: TextProps<Element>) {
  const {
    align,
    as,
    display,
    size = "base",
    tabularNums,
    tone = "primary",
    truncate,
    weight = "regular",
    ...textProps
  } = props;
  const Component = as ?? "span";

  return React.createElement(Component, {
    ...stylex.props(
      styles.root,
      sizeStyles[size],
      toneStyles[tone],
      weightStyles[weight],
      display ? displayStyles[display] : null,
      align ? alignStyles[align] : null,
      truncate ? styles.truncate : null,
      tabularNums ? styles.tabularNums : null,
    ),
    "data-slot": "text",
    ...textProps,
  });
}

export { Text };
export type { TextAlign, TextDisplay, TextElement, TextProps, TextSize, TextTone, TextWeight };
