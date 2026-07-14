// <Text> — the compact typography leaf. On-system chrome, verbs, detail, and labels use <Text> with
// a size/tone/weight/family chosen from the vocabulary, never a hand-styled span. Long-form
// semantic assistant output uses the Prose compound instead so reading measure and block rhythm
// stay intact. It
// carries NO logic and NO state: a size/tone/etc. picks a pre-built style object out of a lookup
// table, and stylex merges them in charter order (base → variant → caller xstyle last). Plain
// React.createElement + StyleX only — no Base UI, no effects (ADR 0025).
//
// Prop grammar inherited from honkkit's prior Text (packages/honkkit/src/text.tsx), trimmed to what
// the app's usage census actually proves and re-expressed over THIS package's tokens:
//   • `as`   — the element to render; span (default) / p / div only (h1–h3/label were never used).
//   • `size` — the prose ramp xs·sm·base·lg·xl → --honk-text-*/--honk-leading-* (10·11·12·13·16px).
//   • `tone` — a color from the token vocabulary; `inherit` emits nothing (inherit the parent's).
//   • `weight`, `family` (ui/mono — the chat's detail/output rows are mono), `align`, `truncate`,
//     `tabularNums` — self-explanatory type controls.
// className/style are deliberately Omit-ed: styled elements never take escape hatches; overrides go
// through `xstyle` (merged last).

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

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
  // Caller override, merged last (charter merge order).
  xstyle?: stylex.StyleXStyles;
};

const styles = stylex.create({
  // Base family is the UI sans; family="mono" overrides it below.
  root: {
    fontFamily: fontVars["--honk-font-family-ui"],
  },
  familyMono: {
    fontFamily: fontVars["--honk-font-family-mono"],
  },
  // Size = the prose ramp: each step pairs a --honk-text-* size with its --honk-leading-* line-height.
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
  // Tone = a color from the token vocabulary. `inherit` is the absence of a color rule (null below).
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

// Lookup tables — the variant→style pick happens in JS (stylex skill, Parent-state alternative 3:
// JS-resolved styles), so there is no branching in the render body. `inherit` maps to null: no color
// rule is emitted and the element inherits its parent's color.
const sizeStyles: Record<TextSize, stylex.StyleXStyles> = {
  xs: styles.sizeXs,
  sm: styles.sizeSm,
  base: styles.sizeBase,
  lg: styles.sizeLg,
  xl: styles.sizeXl,
};

const toneStyles: Record<TextTone, stylex.StyleXStyles | null> = {
  inherit: null,
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
    xstyle,
    ...rest
  } = props;
  const Component = as ?? "span";

  return React.createElement(Component, {
    // rest carries children + any passthrough DOM props (id, onClick, aria-*, …). className/style are
    // Omit-ed from the type, so stylex's className/style below are never clobbered.
    "data-slot": "text",
    ...stylex.props(
      styles.root,
      sizeStyles[size],
      toneStyles[tone],
      weightStyles[weight],
      family === "mono" && styles.familyMono,
      align ? alignStyles[align] : null,
      truncate ? styles.truncate : null,
      tabularNums ? styles.tabularNums : null,
      xstyle,
    ),
    ...rest,
  });
}

export { Text };
export type { TextAlign, TextElement, TextFamily, TextProps, TextSize, TextTone, TextWeight };
