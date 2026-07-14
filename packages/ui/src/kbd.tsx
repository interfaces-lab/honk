// The kbd — a keyboard-key chip (the "⌘K" hint trailing a menu item, the "Esc" on a dismiss
// affordance, the "/" that focuses search). Renders a native <kbd>, the HTML element for keyboard
// input, so the shortcut carries real semantics to assistive tech instead of masquerading as a
// styled <span>. A pure StyleX display leaf like Badge/StatusDot/Text/Icon: a key hint is never
// clicked or focused, so — unlike Button/Tooltip — it needs NO Base UI, only the token bus. (A key
// that actually DOES something is a Button, optionally with a Kbd label inside — not a clickable
// Kbd.) No motion, no focus ring: a display leaf has no interaction state to animate.
//
// LOOK — a small monospace coin. `minWidth = height` so a lone glyph (K, /, ?) reads as a square
// keycap, while a longer label (Esc, Tab) grows past the coin on its inline padding. The surface
// speaks the same chip language as Badge — a layer-01 fill under a border-muted hairline ring —
// tuned quiet on purpose: text-muted foreground, the monospace family (a keycap IS keyboard type),
// and the two smallest steps of the type ramp (micro on sm, caption on md). Every painted value is
// a token (colorVars / fontVars / radiusVars) so a dialkit setProperty repaints every key with zero
// React; only the coin/pad/ring GEOMETRY is a named intrinsic — component anatomy that sits
// deliberately BELOW the interactive control scale, because a keycap is not a control (the Badge
// precedent, whose 20px md coin is honkkit's shipped kbd size).
//
// The ring is drawn as an inset box-shadow, never a real border, so it stays inside the coin's box
// and toggling it (via xstyle) can't shift layout — the Button/Badge ring idiom.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { colorVars, fontVars, radiusVars } from "./tokens.stylex";

type KbdSize = "sm" | "md";

// Kbd anatomy — named intrinsics (the Badge/StatusDot precedent), one rung below the interactive
// control scale (controlVars starts at 24px): a keycap is a display coin, not a control. The md
// coin matches honkkit's shipped kbd (20px); sm steps one 4px grid rung down to 16px. `minWidth =
// height` makes a single glyph square; the small inline pad only shows once a label outgrows the
// coin. The COLOR inside the ring is still a token — only the 1px hairline width is intrinsic.
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
    // Monospace by nature — a keycap prints keyboard type — and this also resets the browser's own
    // <kbd> UA font so every key renders identically across engines.
    fontFamily: fontVars["--honk-font-family-mono"],
    fontWeight: fontVars["--honk-font-weight-medium"],
    lineHeight: 1,
    whiteSpace: "nowrap",
    backgroundColor: colorVars["--honk-color-layer-01"],
    color: colorVars["--honk-color-text-muted"],
    boxShadow: KEY_RING,
  },
  // Coin sizes — height == minWidth so a lone glyph is square; the shared small pad only shows past
  // the coin. Type takes the two smallest ramp steps: micro (sm) / caption (md).
  sm: {
    height: KEY_H_SM,
    minWidth: KEY_H_SM,
    paddingInline: KEY_PAD_X,
    fontSize: fontVars["--honk-font-size-micro"],
  },
  md: {
    height: KEY_H_MD,
    minWidth: KEY_H_MD,
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
  // The key label — a glyph ("K", "/"), a symbol ("⌘", "⇧"), or a short word ("Esc", "Tab").
  children: React.ReactNode;
  // StyleX escape hatch — the app nudges one instance without reaching for className/style.
  xstyle?: stylex.StyleXStyles;
}

function Kbd({ size = "md", children, xstyle }: KbdProps): React.ReactElement {
  return (
    <kbd data-slot="kbd" {...stylex.props(styles.root, sizeStyles[size], xstyle)}>
      {children}
    </kbd>
  );
}

export { Kbd };
export type { KbdProps, KbdSize };
