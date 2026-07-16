// Chrome typography leaf. Long-form reading uses Prose.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, fontVars } from "./tokens.stylex";

type TextElement = "span" | "p" | "div";
type TextSize = "xs" | "sm" | "base" | "lg" | "xl";
type TextTone = "inherit" | "primary" | "muted" | "faint" | "accent" | "ok" | "warn" | "err";
type TextWeight = "regular" | "medium" | "semibold";
type TextFamily = "ui" | "mono";
type TextAlign = "start" | "center" | "end";

type TextProps<Element extends TextElement = "span"> = Omit<
  React.ComponentPropsWithoutRef<Element>,
  "as" | "className" | "style"
> & {
  as?: Element;
  size?: TextSize;
  tone?: TextTone;
  weight?: TextWeight;
  family?: TextFamily;
  align?: TextAlign;
  truncate?: boolean;
  tabularNums?: boolean;
  style?: StyleProp<HonkStyle>;
};

const styles = stylex.create({
  root: {
    fontFamily: fontVars["--honk-font-family-ui"],
  },
  familyMono: {
    fontFamily: fontVars["--honk-font-family-mono"],
  },
  sizeXs: {
    fontSize: fontVars["--honk-text-caption"],
    lineHeight: fontVars["--honk-leading-caption"],
  },
  sizeSm: {
    fontSize: fontVars["--honk-text-detail"],
    lineHeight: fontVars["--honk-leading-detail"],
  },
  sizeBase: {
    fontSize: fontVars["--honk-text-body"],
    lineHeight: fontVars["--honk-leading-body"],
  },
  sizeLg: {
    fontSize: fontVars["--honk-text-title"],
    lineHeight: fontVars["--honk-leading-title"],
  },
  sizeXl: {
    fontSize: fontVars["--honk-text-heading"],
    lineHeight: fontVars["--honk-leading-heading"],
  },
  tonePrimary: {
    color: colorVars["--honk-color-text-primary"],
  },
  toneMuted: {
    color: colorVars["--honk-color-text-muted"],
  },
  toneFaint: {
    color: colorVars["--honk-color-text-faint"],
  },
  toneAccent: {
    color: colorVars["--honk-color-accent"],
  },
  toneOk: {
    color: colorVars["--honk-color-ok-fg"],
  },
  toneWarn: {
    color: colorVars["--honk-color-warn-fg"],
  },
  toneErr: {
    color: colorVars["--honk-color-err-fg"],
  },
  weightRegular: {
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
  weightMedium: {
    fontWeight: fontVars["--honk-font-weight-medium"],
  },
  weightSemibold: {
    fontWeight: fontVars["--honk-font-weight-semibold"],
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
  xs: styles.sizeXs,
  sm: styles.sizeSm,
  base: styles.sizeBase,
  lg: styles.sizeLg,
  xl: styles.sizeXl,
};

const toneStyles: Record<TextTone, stylex.StyleXStyles | undefined> = {
  inherit: undefined,
  primary: styles.tonePrimary,
  muted: styles.toneMuted,
  faint: styles.toneFaint,
  accent: styles.toneAccent,
  ok: styles.toneOk,
  warn: styles.toneWarn,
  err: styles.toneErr,
};

const weightStyles: Record<TextWeight, stylex.StyleXStyles> = {
  regular: styles.weightRegular,
  medium: styles.weightMedium,
  semibold: styles.weightSemibold,
};

const alignStyles: Record<TextAlign, stylex.StyleXStyles> = {
  start: styles.alignStart,
  center: styles.alignCenter,
  end: styles.alignEnd,
};

function Text<Element extends TextElement = "span">(props: TextProps<Element>): React.ReactElement {
  const {
    align,
    as,
    family = "ui",
    size = "base",
    tabularNums,
    tone = "primary",
    truncate,
    weight = "regular",
    style,
    ...rest
  } = props;
  const Component = as ?? "span";

  return React.createElement(Component, {
    "data-slot": "text",
    ...applyStyle(
      stylex.props(
        styles.root,
        sizeStyles[size],
        toneStyles[tone],
        weightStyles[weight],
        family === "mono" && styles.familyMono,
        align ? alignStyles[align] : undefined,
        truncate ? styles.truncate : undefined,
        tabularNums ? styles.tabularNums : undefined,
      ),
      style,
    ),
    ...rest,
  });
}

export { Text };
export type { TextAlign, TextElement, TextFamily, TextProps, TextSize, TextTone, TextWeight };
