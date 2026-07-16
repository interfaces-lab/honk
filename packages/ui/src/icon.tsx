// central-icons leaf. size then tone then caller style.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, iconVars } from "./tokens.stylex";

type Glyph = React.ComponentType<
  { size?: string | number } & React.SVGProps<SVGSVGElement>
>;

type IconSize = "xs" | "sm" | "md" | "lg" | "xl";
type IconTone =
  | "current"
  | "muted"
  | "faint"
  | "accent"
  | "ok"
  | "warn"
  | "err"
  | "info";

interface IconProps {
  icon: Glyph;
  size?: IconSize;
  tone?: IconTone;
  // Omit label for decorative glyphs (aria-hidden). Provide label when the icon is the sole cue.

  label?: string;
  style?: StyleProp<HonkStyle>;
}

const GLYPH_SIZE = "1em";

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    lineHeight: 1,
  },
  sizeXs: {
    fontSize: iconVars["--honk-icon-size-xs"],
  },
  sizeSm: {
    fontSize: iconVars["--honk-icon-size-sm"],
  },
  sizeMd: {
    fontSize: iconVars["--honk-icon-size-md"],
  },
  sizeLg: {
    fontSize: iconVars["--honk-icon-size-lg"],
  },
  sizeXl: {
    fontSize: iconVars["--honk-icon-size-xl"],
  },
  toneCurrent: {
    color: "currentColor",
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
  toneInfo: {
    color: colorVars["--honk-color-info-fg"],
  },
});

const sizeStyles: Record<IconSize, stylex.StyleXStyles> = {
  xs: styles.sizeXs,
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
  xl: styles.sizeXl,
};

const toneStyles: Record<IconTone, stylex.StyleXStyles> = {
  current: styles.toneCurrent,
  muted: styles.toneMuted,
  faint: styles.toneFaint,
  accent: styles.toneAccent,
  ok: styles.toneOk,
  warn: styles.toneWarn,
  err: styles.toneErr,
  info: styles.toneInfo,
};

function Icon({
  icon: Glyph,
  size = "md",
  tone = "current",
  label,
  style,
}: IconProps): React.ReactElement {
  const decorative = label === undefined;
  return (
    <span
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : "img"}
      aria-label={label}
      data-slot="icon"
      {...applyStyle(stylex.props(styles.root, sizeStyles[size], toneStyles[tone]), style)}
    >
      <Glyph size={GLYPH_SIZE} />
    </span>
  );
}

export { Icon };
export type { Glyph, IconProps, IconSize, IconTone };
