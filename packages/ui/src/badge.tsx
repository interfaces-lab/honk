import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import {
  colorVars,
  controlVars,
  fontVars,
  radiusVars,
} from "./tokens.stylex";

// No info tone. Status info has no background token and a badge needs one.
type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "err" | "outline";
type BadgeSize = "sm" | "md";

const BADGE_H_SM = "16px";
const BADGE_H_MD = "20px";
// Inset ring so outline tone never shifts layout.
const BADGE_RING = `inset 0 0 0 1px ${colorVars["--honk-color-border-base"]}`;

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxSizing: "border-box",
    gap: controlVars["--honk-control-gap"],
    borderRadius: radiusVars["--honk-radius-control"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    lineHeight: 1,
    whiteSpace: "nowrap",
  },
  sm: {
    height: BADGE_H_SM,
    minWidth: BADGE_H_SM,
    // oxlint-disable-next-line honk/design-no-raw-values -- badge sm horizontal inset is fixed intrinsic geometry; no spacing/control padding token owns 4px
    paddingInline: "4px",
    fontSize: fontVars["--honk-font-size-micro"],
  },
  md: {
    height: BADGE_H_MD,
    minWidth: BADGE_H_MD,
    // oxlint-disable-next-line honk/design-no-raw-values -- badge md horizontal inset is fixed intrinsic geometry; no spacing/control padding token owns 6px
    paddingInline: "6px",
    fontSize: fontVars["--honk-font-size-caption"],
  },
  neutral: {
    backgroundColor: colorVars["--honk-color-layer-01"],
    color: colorVars["--honk-color-text-muted"],
  },
  accent: {
    backgroundColor: colorVars["--honk-color-accent-fill"],
    color: colorVars["--honk-color-on-accent"],
  },
  ok: {
    backgroundColor: colorVars["--honk-color-ok-bg"],
    color: colorVars["--honk-color-ok-fg"],
  },
  warn: {
    backgroundColor: colorVars["--honk-color-warn-bg"],
    color: colorVars["--honk-color-warn-fg"],
  },
  err: {
    backgroundColor: colorVars["--honk-color-err-bg"],
    color: colorVars["--honk-color-err-fg"],
  },
  outline: {
    backgroundColor: colorVars["--honk-color-bg-base"],
    color: colorVars["--honk-color-text-primary"],
    boxShadow: BADGE_RING,
  },
});

const sizeStyles: Record<BadgeSize, stylex.StyleXStyles> = {
  sm: styles.sm,
  md: styles.md,
};
const toneStyles: Record<BadgeTone, stylex.StyleXStyles> = {
  neutral: styles.neutral,
  accent: styles.accent,
  ok: styles.ok,
  warn: styles.warn,
  err: styles.err,
  outline: styles.outline,
};

interface BadgeProps {
  tone?: BadgeTone;
  size?: BadgeSize;
  children: React.ReactNode;
  style?: StyleProp<HonkStyle>;
}

function Badge({
  tone = "neutral",
  size = "md",
  children,
  style,
}: BadgeProps): React.ReactElement {
  return (
    <span
      data-slot="badge"
      {...applyStyle(stylex.props(styles.root, sizeStyles[size], toneStyles[tone]), style)}
    >
      {children}
    </span>
  );
}

export { Badge };
export type { BadgeProps, BadgeSize, BadgeTone };
