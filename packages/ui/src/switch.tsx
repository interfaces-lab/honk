// The switch — honk's on/off toggle, built on Base UI's Switch (Switch.Root, a role="switch" span
// with a hidden form <input> beside it, + Switch.Thumb, the sliding knob). The whole concept in one
// file (ADR 0011: one file per concept). A switch is the binary sibling of the checkbox: reach for
// it when a setting takes effect the instant it flips (a feature flag, a theme), not a form field
// you stage and submit.
//
// STYLING (round-8 doctrine): a primitive is Base UI + StyleX only — no className, no Tailwind
// (Tailwind is the APP arranging primitives, never a primitive's own internals). StyleX owns the
// whole surface reading the token bus, so a dialkit setProperty on a --honk-* var repaints every
// switch with zero React. We do NOT expose className/style; the app nudges one instance with
// `xstyle` (a StyleX override, footgun-free), and className/style are Omitted from the public props
// for exactly that reason. Handlers, ref, aria, and Base UI's data-state ride `...rest`, spread
// before the StyleX props so the styling stays ours.
//
// ANATOMY. The track is a pill that flips on check: unchecked = a neutral layer-02 well carrying a
// hairline border-muted ring; checked = the accent fill (the ring drops — the accent IS the
// surface). The ring is drawn as an INSET box-shadow, never a real border, so toggling it never
// shifts layout (the button.tsx ring idiom). The thumb is an on-accent (white) circle inset
// THUMB_INSET on every side; it slides left→right by animating `translate` keyed on its OWN
// `data-checked` — Base UI stamps that attr on both the Root and the Thumb (verified against the
// installed 1.6.0 SwitchThumbDataAttributes), so the knob styles itself with no descendant selector.
// Base UI does NOT auto-position the thumb; we lay it out as a flex child, so there is no absolute
// positioning to keep in sync — travel is pure transform (no layout, no paint of box geometry).
//
// SIZES. A switch track is shorter than the 24/28/32 button/control heights, so its geometry is
// control-family-ish: named intrinsic consts here (the no-raw-values anatomy exception, the same
// license button.tsx takes for its focus-ring width), not a controlVars snap. Two densities reusing
// button.tsx's size-prop shape — `md` is the canonical toggle, `sm` the compact menu-row switch
// (honkkit's menuRoot density).
//
// MOTION (ADR 0025 / the stylex reduced-motion rule). Two jobs, each on its own motion token AND its
// own prefers-reduced-motion sibling that zeroes the duration: the fill/ring flip rides
// duration-hover, the thumb slide rides duration-fast (a hair slower, so the knob visibly travels
// just after the fill turns). Focus is an accent `outline` on :focus-visible — a slot apart from the
// ring box-shadow so the two never collide (the button.tsx focus recipe).

import { Switch as Base } from "@base-ui/react/switch";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { colorVars, motionVars, radiusVars } from "./tokens.stylex";

type SwitchSize = "sm" | "md";

// ── Track + thumb anatomy (named intrinsics — switch geometry, not shared design vocabulary) ──
// Every dimension is a justified named const (the no-raw-values anatomy exception, per button.tsx's
// focus-ring intrinsics and status-dot's DOT_SIZE). The thumb is inset THUMB_INSET on all sides;
// travel = width − thumb − 2·inset, so the knob lands flush against the far inset when checked.
const THUMB_INSET = "2px"; // gap between thumb and track edge (nets a 2px inset at both densities)
const MD_TRACK_W = "30px";
const MD_TRACK_H = "18px";
const MD_THUMB = "14px";
const SM_TRACK_W = "26px";
const SM_TRACK_H = "16px";
const SM_THUMB = "12px";
// The checked-state slide, as whole transform strings (travel = trackW − thumb − 2·inset). Base UI
// stamps data-checked on the Thumb itself (verified against 1.6.0 SwitchThumbDataAttributes and at
// runtime), so the thumb keys its OWN transform on [data-checked] — no descendant selector, no CSS
// var (a conditional custom property doesn't emit its state variant in StyleX). Plain string
// literals, module-level so the no-raw-values lint (create-scoped) never sees the px.
const MD_SHIFT = "translateX(12px)"; // 30 − 14 − 2·2
const SM_SHIFT = "translateX(10px)"; // 26 − 12 − 2·2

// A hairline ring drawn as an inset shadow (not a real border, so toggling it never shifts layout) —
// the button.tsx idiom. The geometry is literal; the COLOR is a token.
const RING_MUTED = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;
// Focus-ring intrinsics — the shipped app's 1px hairline / 2px gap; the color stays a token (button.tsx).
const FOCUS_RING_WIDTH = "1px";
const FOCUS_RING_OFFSET = "2px";

const sx = stylex.create({
  // The track — a pill that flips fill + ring on `data-checked` (Base UI sets it on the Root span).
  root: {
    appearance: "none",
    boxSizing: "border-box", // width/height INCLUDE the inset padding, so the travel math holds
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0, // never compress in a settings row's flex line
    padding: THUMB_INSET,
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-pill"],
    userSelect: "none",
    cursor: { default: "pointer", "[data-disabled]": "default" },
    backgroundColor: {
      default: colorVars["--honk-color-layer-02"],
      // The FILL arm — the white thumb must hold on the checked track in both modes.
      "[data-checked]": colorVars["--honk-color-accent-fill"],
    },
    // Unchecked well carries the hairline ring; the accent fill needs none (it IS the surface).
    boxShadow: {
      default: RING_MUTED,
      "[data-checked]": "none",
    },
    // Focus drawn with `outline` so it never collides with the ring box-shadow (button.tsx slot).
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: FOCUS_RING_WIDTH,
    outlineOffset: FOCUS_RING_OFFSET,
    // The Root renders a span (a non-native button), so disabled is a data-attr, not `:disabled`.
    opacity: { default: 1, "[data-disabled]": 0.4 },
    // The fill + ring flip — the hover tier (a touch quicker than the knob slide below).
    transitionProperty: "background-color, box-shadow",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  trackMd: { width: MD_TRACK_W, height: MD_TRACK_H },
  trackSm: { width: SM_TRACK_W, height: SM_TRACK_H },

  // The thumb — an on-accent circle that slides on its own `data-checked` (Base UI stamps that attr
  // on the Thumb too, so the translate keys off the knob itself; no Root-descendant selector needed).
  thumb: {
    display: "block",
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-pill"], // a pill radius on a square box = a circle
    backgroundColor: colorVars["--honk-color-on-accent"],
    pointerEvents: "none", // the click belongs to the Root; the knob never eats it
    // The slide — the fast tier, on `transform` alone (never triggers layout); the checked shift
    // itself lives on thumbMd/thumbSm, keyed on the thumb's own [data-checked].
    transitionProperty: "transform",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  thumbMd: {
    width: MD_THUMB,
    height: MD_THUMB,
    transform: { default: "translateX(0)", "[data-checked]": MD_SHIFT },
  },
  thumbSm: {
    width: SM_THUMB,
    height: SM_THUMB,
    transform: { default: "translateX(0)", "[data-checked]": SM_SHIFT },
  },
});

const trackSizeBySize: Record<SwitchSize, stylex.StyleXStyles> = {
  sm: sx.trackSm,
  md: sx.trackMd,
};
// StyleX infers a conditional `transform` value's type as `unknown` (a known gap — it types a
// conditional color/length/number fine, but not transform/translate), so sx.thumbMd/thumbSm don't
// structurally satisfy StyleXStyles even though the compiled CSS is correct and the runtime objects
// ARE valid styles. Cast past that inference gap here, once.
const thumbSizeBySize = {
  sm: sx.thumbSm,
  md: sx.thumbMd,
} as unknown as Record<SwitchSize, stylex.StyleXStyles>;

// className/style are Omitted from the public props (see the header): the app composes layout on a
// wrapper and nudges one instance with `xstyle`. Everything else — checked/defaultChecked,
// onCheckedChange, disabled, name/value for form submission, aria — rides Base.Root.Props via rest.
interface SwitchProps extends Omit<Base.Root.Props, "className" | "style"> {
  size?: SwitchSize;
  // StyleX escape hatch for the app to nudge one instance without the StyleX-vs-Tailwind footgun.
  xstyle?: stylex.StyleXStyles;
}

function Switch({ size = "md", xstyle, ...rest }: SwitchProps): React.ReactElement {
  return (
    <Base.Root
      {...rest}
      data-slot="switch"
      {...stylex.props(sx.root, trackSizeBySize[size], xstyle)}
    >
      <Base.Thumb data-slot="switch-thumb" {...stylex.props(sx.thumb, thumbSizeBySize[size])} />
    </Base.Root>
  );
}

export { Switch };
export type { SwitchProps, SwitchSize };
