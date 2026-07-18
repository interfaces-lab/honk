// Keyboard key chrome.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, fontVars, radiusVars } from "./tokens.stylex";

type KbdSize = "sm" | "md";

const KEY_H_SM = "16px";
const KEY_H_MD = "20px";
const KEY_PAD_X = "4px";
const KEY_RING = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxSizing: "border-box",
    borderRadius: radiusVars["--honk-radius-control"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    lineHeight: 1,
    whiteSpace: "nowrap",
    backgroundColor: colorVars["--honk-color-layer-01"],
    color: colorVars["--honk-color-text-muted"],
    boxShadow: KEY_RING,
  },
  sm: {
    height: KEY_H_SM,
    minWidth: KEY_H_SM,
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px key chrome padding is fixed intrinsic; generic space scale is 8/10/12px, no token owns 4px inline padding
    paddingInline: KEY_PAD_X,
    fontSize: fontVars["--honk-font-size-micro"],
  },
  md: {
    height: KEY_H_MD,
    minWidth: KEY_H_MD,
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px key chrome padding is fixed intrinsic; generic space scale is 8/10/12px, no token owns 4px inline padding
    paddingInline: KEY_PAD_X,
    fontSize: fontVars["--honk-font-size-caption"],
  },
});

const sizeStyles: Record<KbdSize, stylex.StyleXStyles> = {
  sm: styles.sm,
  md: styles.md,
};

interface KbdProps {
  size?: KbdSize;
  children: React.ReactNode;
  style?: StyleProp<HonkStyle>;
}

function Kbd({ size = "md", children, style }: KbdProps): React.ReactElement {
  return (
    <kbd data-slot="kbd" {...applyStyle(stylex.props(styles.root, sizeStyles[size]), style)}>
      {children}
    </kbd>
  );
}

export { Kbd };
export type { KbdProps, KbdSize };
