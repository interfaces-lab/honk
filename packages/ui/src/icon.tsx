// <Icon> — the glyph leaf. Wraps a central-icons glyph in a sized, toned box. NO logic, NO state,
// NO effects (ADR 0025): a size/tone picks a pre-built style object, stylex merges them (base →
// size → tone → caller xstyle last).
//
// THE SIZING PATTERN (required, and the reason there is a wrapper at all): StyleX 0.19 has no
// descendant selectors, so the box can't be sized by targeting the inner <svg>. Instead the wrapper
// span sets `font-size` from an --honk-icon-size-* token and the glyph is rendered at size="1em", so
// the glyph fills the token-sized font box — the token owns the geometry, and tone flows in through
// `currentColor` (every central-icons stroke is currentColor). The glyph is passed as a COMPONENT
// (icon={IconFolder1}) and rendered here directly — no cloneElement, no children juggling.
//
// Prop grammar mirrors honkkit's prior Icon (packages/honkkit/src/icon.tsx) minus its Base-UI
// coupling (useRender/mergeProps/themeProps): this package is StyleX-only and effect-free, so the
// render-delegation and external-CSS-targeting surfaces are dropped. Tones are re-expressed over
// THIS package's color tokens; `current` (the default) inherits the surrounding text color.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { colorVars, iconVars } from "./tokens.stylex";

// The shape every central-icons glyph satisfies (verified: React.FC<{size?; ariaHidden?} & SVGProps>,
// default size 24, strokes in currentColor). Typed structurally rather than imported from the pack so
// the primitive wraps ANY such glyph and stays icon-library-agnostic.
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
  // The glyph component to render, e.g. icon={IconCrossSmall}.
  icon: Glyph;
  size?: IconSize;
  tone?: IconTone;
  // Accessible name. Omit for a decorative glyph (the default → aria-hidden); provide it when the
  // icon carries meaning on its own (→ role="img" + the label). Most call sites wrap the icon in a
  // labelled control and leave this unset.
  label?: string;
  // Caller override, merged last (charter merge order).
  xstyle?: stylex.StyleXStyles;
}

// The glyph fills the wrapper's icon-size font box. Fixed intrinsic of the sizing pattern above, not
// a design value — a named constant with this justification per the stylex skill (Tokens rule 3).
const GLYPH_SIZE = "1em";

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    // pin the line box to the glyph so inherited leading never stretches the 1em icon box
    lineHeight: 1,
  },
  // Size sets font-size only; the glyph's size="1em" reads it (see THE SIZING PATTERN).
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
  // Tone = the paint colour; the glyph's currentColor strokes inherit it. `current` inherits the
  // surrounding text colour (so an icon inside a hover-tinted control follows the control for free).
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

// Lookup tables — the variant→style pick happens in JS, so the render body is branch-free.
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
  xstyle,
}: IconProps): React.ReactElement {
  const decorative = label === undefined;
  return (
    <span
      // decorative by default; a provided label promotes the glyph to an accessible image
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : "img"}
      aria-label={label}
      data-slot="icon"
      {...stylex.props(styles.root, sizeStyles[size], toneStyles[tone], xstyle)}
    >
      <Glyph size={GLYPH_SIZE} />
    </span>
  );
}

export { Icon };
export type { Glyph, IconProps, IconSize, IconTone };
