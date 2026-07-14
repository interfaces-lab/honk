// The checkbox — honk's staged boolean input, built on Base UI's Checkbox (Checkbox.Root, a
// role="checkbox" span with a hidden form <input> beside it, + Checkbox.Indicator, the tick that
// mounts once the box is ticked). The whole concept in one file (ADR 0011: one file per concept). A
// checkbox is the binary sibling of the switch: reach for it in a FORM you stage and submit (a
// multi-select row, a settings form), where a switch is for a setting that takes effect the instant
// it flips.
//
// STYLING (round-8 doctrine): a primitive is Base UI + StyleX only — no className, no Tailwind
// (Tailwind is the APP arranging primitives, never a primitive's internals). StyleX owns the whole
// surface reading the token bus, so a dialkit setProperty on a --honk-* var repaints every checkbox
// with zero React. We do NOT expose className/style; the app nudges one instance with `xstyle` (a
// StyleX override, footgun-free), and className/style are Omitted from the public props. Handlers,
// ref, aria, and Base UI's data-state ride `...rest`, spread before the StyleX props so styling stays
// ours.
//
// ANATOMY. The box is a rounded square that flips fill + ring on state: unchecked = a layer-01 field
// carrying a hairline border-base ring; checked (or indeterminate) = the accent fill (the ring drops
// — the accent IS the surface). The ring is an INSET box-shadow, never a real border, so toggling it
// never shifts layout (the button.tsx ring idiom). Base UI stamps data-checked / data-indeterminate /
// data-disabled on BOTH the Root and the Indicator (verified against the installed 1.6.0
// CheckboxRootDataAttributes + the Indicator's state mapping), so every state styles itself on its
// OWN attribute — no descendant selector, the switch.tsx idiom.
//
// THE TICK. The Indicator (Base UI mounts it only while checked OR indeterminate) holds two marks
// sharing one box: a real <Icon> checkmark for the checked state, and a centered DASH for
// indeterminate. The checkmark paints in `currentColor`, which the Indicator sets to on-accent — so
// on indeterminate we simply flip that currentColor to `transparent` to blank the checkmark, while
// the dash keeps an EXPLICIT on-accent fill and is revealed by the Indicator's own
// `[data-indeterminate]` (drawn as a ::before bar, so it overlays the always-rendered checkmark
// without disturbing the flex centering). Keeping the checkmark mounted-but-transparent on
// indeterminate also stabilises the box the dash centres in. This keeps a real central-icons glyph
// for the common case yet needs no render-prop branching — pure on-self StyleX (the ::before's
// `[data-indeterminate]` condition is compile-verified on StyleX 0.19).
//
// SIZES. A tick box is smaller than the 24/28/32 button/control heights, so its geometry is named
// intrinsic consts here (the no-raw-values anatomy exception button.tsx takes for its focus ring),
// not a controlVars snap — 18/16px, honkkit's own size-4.5 / size-4, which also line up height-for-
// height with switch.tsx's md/sm track so a checkbox and a switch sit level in the same settings row.
// Two densities reusing button's size-prop shape: `md` (18) is the canonical box, `sm` (16) the
// compact/dense-row one.
//
// MOTION (ADR 0025 / the stylex reduced-motion rule). The tick FADES in on Base UI's transitionStatus
// data-attrs (data-starting-style / data-ending-style, the tooltip idiom) — enter on the fast tier,
// exit on the instant tier (faster than enter), each with its own prefers-reduced-motion → 0s
// sibling. (Opacity only, no scale: the one scale token is overlay-semantic and imperceptible on a
// 12px mark, so a clean fade is the honest reveal.) The box's fill + ring flip rides the hover tier.
// Focus is an accent `outline` on :focus-visible — a slot apart from the ring box-shadow so the two
// never collide (the button.tsx focus recipe).

import { Checkbox as Base } from "@base-ui/react/checkbox";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Icon } from "./icon";
import { IconCheckmark1 } from "./icons";
import { colorVars, motionVars, radiusVars } from "./tokens.stylex";

type CheckboxSize = "sm" | "md";

// ── Box + tick anatomy (named intrinsics — checkbox geometry, not shared design vocabulary) ──
// Justified named consts (the no-raw-values anatomy exception, per button.tsx's focus-ring intrinsics
// and status-dot's DOT_SIZE). Box sizes are honkkit's own size-4.5 / size-4, matched to switch.tsx's
// track heights so the two controls align in a row.
const BOX_SIZE_MD = "18px";
const BOX_SIZE_SM = "16px";
// The indeterminate dash — a short centered bar (honkkit's IconMinusSmall stand-in; that glyph is not
// in @honk/ui's curated icon set, and a bar needs no import). Sized to read inside the 12px checkmark
// box; its COLOR is a token (see sx.indicator "::before").
const DASH_WIDTH = "8px";
const DASH_HEIGHT = "2px";
// The hairline ring drawn as an inset shadow (not a real border, so toggling it never shifts layout) —
// the button.tsx idiom. The geometry is literal; the COLOR is a token.
const RING_BASE = `inset 0 0 0 1px ${colorVars["--honk-color-border-base"]}`;
// Focus-ring intrinsics — the shipped app's 1px hairline / 2px gap; the color stays a token (button.tsx).
const FOCUS_RING_WIDTH = "1px";
const FOCUS_RING_OFFSET = "2px";

const sx = stylex.create({
  // The box — a rounded square that flips fill + ring on `data-checked` / `data-indeterminate`
  // (Base UI stamps both on the Root span).
  root: {
    appearance: "none",
    boxSizing: "border-box", // width/height are the exact box; the tick centres inside via flex
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0, // never compress in a form row's flex line
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    userSelect: "none",
    cursor: { default: "pointer", "[data-disabled]": "default" },
    // Unchecked field vs. the accent fill of a ticked or mixed box.
    backgroundColor: {
      default: colorVars["--honk-color-layer-01"],
      "[data-checked]": colorVars["--honk-color-accent-fill"],
      "[data-indeterminate]": colorVars["--honk-color-accent-fill"],
    },
    // Unchecked field carries the hairline ring; the accent fill needs none (it IS the surface).
    boxShadow: {
      default: RING_BASE,
      "[data-checked]": "none",
      "[data-indeterminate]": "none",
    },
    // Focus drawn with `outline` so it never collides with the ring box-shadow (button.tsx slot).
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: FOCUS_RING_WIDTH,
    outlineOffset: FOCUS_RING_OFFSET,
    // The Root renders a span (a non-native button), so disabled is a data-attr, not `:disabled`.
    opacity: { default: 1, "[data-disabled]": 0.4 },
    // The fill + ring flip — the hover tier.
    transitionProperty: "background-color, box-shadow",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  boxMd: { width: BOX_SIZE_MD, height: BOX_SIZE_MD },
  boxSm: { width: BOX_SIZE_SM, height: BOX_SIZE_SM },

  // The tick container (Base UI mounts it only while checked or indeterminate). It centres the
  // checkmark, sets the mark colour to on-accent, and fades in on Base UI's transitionStatus attrs.
  // `position: relative` anchors the indeterminate dash (::before). pointer-events off: the click is
  // the box's, never the mark's.
  indicator: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
    pointerEvents: "none",
    // The checkmark <Icon> paints in currentColor; indeterminate blanks it by flipping that
    // currentColor to transparent (the dash below keeps an explicit fill, so it stays visible).
    color: {
      default: colorVars["--honk-color-on-accent"],
      "[data-indeterminate]": "transparent",
    },
    // The indeterminate dash — a centered on-accent bar overlaid on the (blanked) checkmark, revealed
    // only on the Indicator's own `[data-indeterminate]`. An EXPLICIT backgroundColor (not
    // currentColor), so the transparent-mark flip above never hides it too.
    "::before": {
      content: '""',
      position: "absolute",
      inset: 0,
      margin: "auto", // centres the fixed-size bar in the tick box
      width: DASH_WIDTH,
      height: DASH_HEIGHT,
      borderRadius: radiusVars["--honk-radius-pill"],
      backgroundColor: colorVars["--honk-color-on-accent"],
      display: { default: "none", "[data-indeterminate]": "block" },
    },
    // Appear: a fade keyed on Base UI's on-self transition attrs (the tooltip idiom). Enter on the
    // fast tier / exit on the instant tier; reduced motion zeroes both.
    opacity: {
      default: 1,
      "[data-starting-style]": 0,
      "[data-ending-style]": 0,
    },
    transitionProperty: "opacity",
    transitionTimingFunction: {
      default: motionVars["--honk-motion-ease-out"],
      "[data-ending-style]": motionVars["--honk-motion-ease-in"],
    },
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "[data-ending-style]": motionVars["--honk-motion-duration-instant"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
});

const boxSizeBySize: Record<CheckboxSize, stylex.StyleXStyles> = {
  sm: sx.boxSm,
  md: sx.boxMd,
};

// className/style are Omitted from the public props (see the header): the app composes layout on a
// wrapper and nudges one instance with `xstyle`. Everything else — checked/defaultChecked,
// indeterminate, onCheckedChange, disabled, name/value for form submission, required, aria — rides
// Base.Root.Props via rest.
interface CheckboxProps extends Omit<Base.Root.Props, "className" | "style"> {
  size?: CheckboxSize;
  // StyleX escape hatch for the app to nudge one instance without the StyleX-vs-Tailwind footgun.
  xstyle?: stylex.StyleXStyles;
}

function Checkbox({ size = "md", xstyle, ...rest }: CheckboxProps): React.ReactElement {
  return (
    <Base.Root
      {...rest}
      data-slot="checkbox"
      {...stylex.props(sx.root, boxSizeBySize[size], xstyle)}
    >
      {/* No keepMounted: Base UI mounts the tick on check/indeterminate and holds it through the exit
          fade. The checkmark stays rendered (just transparent) while indeterminate so the box the
          dash centres in never collapses. */}
      <Base.Indicator data-slot="checkbox-indicator" {...stylex.props(sx.indicator)}>
        <Icon icon={IconCheckmark1} size="xs" />
      </Base.Indicator>
    </Base.Root>
  );
}

export { Checkbox };
export type { CheckboxProps, CheckboxSize };
