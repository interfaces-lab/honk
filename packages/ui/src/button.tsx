// The button — honk's clickable control, built on Base UI's Button (native `<button>` semantics,
// disabled handling, and `render` composition for polymorphism). The whole concept — the text
// Button and the square IconButton — in one file (ADR 0011: one file per concept).
//
// STYLING (round-8 doctrine, refined by the GPT-5.5 consult): a primitive is StyleX + Base UI only.
// StyleX owns the whole surface — geometry, variant fills, self hover/press/focus/disabled state —
// reading the token bus so a dialkit setProperty repaints every button with zero React. Tailwind is
// NOT used here; it is for the APP arranging primitives (a wrapper's flex/grid/gap), never a
// primitive's internals. So there is no className styling inside this file.
//
// VARIANTS map to honk's identity, not honkkit's legacy CVA sprawl (7×10). The shell's button
// vocabulary is chrome-subtle (the wireframe's one real button, .gbtn, is a layer fill + hairline
// ring + muted text — principles.md §"one button" minimalism), so `secondary` is the DEFAULT and
// the loud accent fill (`primary`) is the opt-in brand action (Send/Confirm). Five variants, each
// mapping to a real token group:
//   primary   — accent fill + on-accent text; the one brand-forward action.
//   secondary — layer fill + hairline ring + primary text; the .gbtn chrome button (DEFAULT).
//   ghost     — no fill until hover; muted→primary text; toolbars and dense chrome.
//   outline   — bg-base fill + visible ring; a bordered neutral.
//   danger    — the status err triplet as a fill (err-bg + err-fg + err-border); destructive.
// Neutral variants hover by climbing the layer ladder (identity-specific steps); the two filled
// variants (primary/danger) hover via the tokenized state-tint inset (see tokens.stylex.ts).

import { Button as Base } from "@base-ui/react/button";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import {
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
} from "./tokens.stylex";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type ButtonSize = "sm" | "md" | "lg";

// The state-tint inset: a full-cover inset shadow (huge spread, clipped to the radius) that washes
// the whole fill. Named here — it is button mechanics, not shared design vocabulary. The COLOR is a
// token; only the geometry is literal.
const STATE_TINT_HOVER = `inset 0 0 0 100px ${colorVars["--honk-color-state-hover"]}`;
const STATE_TINT_PRESS = `inset 0 0 0 100px ${colorVars["--honk-color-state-press"]}`;
// A hairline ring drawn as an inset shadow (not a border, so toggling it never shifts layout).
// Neutral buttons ring with border-STRONG (20% fg, ~1.6:1 on white — ALF's contrast_200 edge):
// the divider-grade muted/base hairlines (8%/10%, ~1.2:1) cannot carry a button's only shape
// signal on a white card — that was the invisible-button defect (2026-07-12 contrast retune).
const RING_STRONG = `inset 0 0 0 1px ${colorVars["--honk-color-border-strong"]}`;
// The raised-chip bevel a neutral button wears so it reads as a control on the white card, not a
// flat near-white tint (the "buttons don't read" defect). This is opencode v2's
// --v2-elevation-button-neutral, which honk tokenized but never wired onto the button: the strong
// ring carries the edge, the bevel adds the depth that makes the shape read.
const NEUTRAL_BEVEL = elevationVars["--honk-elevation-button-neutral"];
const RING_DANGER = `inset 0 0 0 1px ${colorVars["--honk-color-err-border"]}`;
// Focus ring intrinsics (the shipped app's --honk-focus-ring-width/-offset: 1px hairline, 2px gap).
// Named, not tokenized — a control-anatomy constant, like the tooltip's pad; the color is a token.
const FOCUS_RING_WIDTH = "1px";
const FOCUS_RING_OFFSET = "2px";

const sx = stylex.create({
  root: {
    appearance: "none",
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    gap: controlVars["--honk-control-gap"],
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontWeight: fontVars["--honk-font-weight-medium"],
    lineHeight: 1,
    whiteSpace: "nowrap",
    userSelect: "none",
    textDecoration: "none", // stays clean when rendered as an <a> via `render`
    cursor: { default: "pointer", ":disabled": "default" },
    // Focus is drawn with `outline` so it never collides with the variants' box-shadow rings/tints.
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: FOCUS_RING_WIDTH,
    outlineOffset: FOCUS_RING_OFFSET,
    opacity: { default: 1, ":disabled": 0.4 },
    transitionProperty: "background-color, box-shadow, color, opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  block: { width: "100%" },

  // Text sizes — height + inline padding + type, all from the control scale.
  sizeSm: {
    height: controlVars["--honk-control-h-sm"],
    paddingInline: controlVars["--honk-control-pad-sm"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  sizeMd: {
    height: controlVars["--honk-control-h-md"],
    paddingInline: controlVars["--honk-control-pad-md"],
    fontSize: fontVars["--honk-font-size-body"],
  },
  sizeLg: {
    height: controlVars["--honk-control-h-lg"],
    paddingInline: controlVars["--honk-control-pad-lg"],
    fontSize: fontVars["--honk-font-size-body"],
  },

  // Icon-only sizes — square, no inline padding; the glyph centers in the control box.
  iconSm: {
    height: controlVars["--honk-control-h-sm"],
    width: controlVars["--honk-control-h-sm"],
    paddingInline: 0,
    fontSize: fontVars["--honk-font-size-detail"],
  },
  iconMd: {
    height: controlVars["--honk-control-h-md"],
    width: controlVars["--honk-control-h-md"],
    paddingInline: 0,
    fontSize: fontVars["--honk-font-size-body"],
  },
  iconLg: {
    height: controlVars["--honk-control-h-lg"],
    width: controlVars["--honk-control-h-lg"],
    paddingInline: 0,
    fontSize: fontVars["--honk-font-size-body"],
  },
});

const variants = stylex.create({
  // Filled brand action. Fill uses the FILL arm of the accent pair (accent-fill stays deep in
  // dark so the white label holds); hover/press wash it with the state tint.
  primary: {
    backgroundColor: colorVars["--honk-color-accent-fill"],
    color: colorVars["--honk-color-on-accent"],
    boxShadow: {
      default: "none",
      ":hover": { "@media (hover: hover)": STATE_TINT_HOVER },
      ":active": STATE_TINT_PRESS,
    },
  },
  // The .gbtn chrome button: control fill + visible ring + primary text; hover walks the
  // control trio (ALF contrast_50→100→200 — Bluesky's own secondary ramp), which reads on the
  // white card where the layer ladder's contrast_25 rest fill dissolved.
  secondary: {
    backgroundColor: {
      default: colorVars["--honk-color-control"],
      ":hover": {
        "@media (hover: hover)": colorVars["--honk-color-control-hover"],
      },
      ":active": colorVars["--honk-color-control-press"],
    },
    color: colorVars["--honk-color-text-primary"],
    boxShadow: `${RING_STRONG}, ${NEUTRAL_BEVEL}`,
  },
  // No fill at rest; a transient state wash works on whichever surface hosts the button.
  // Tab-plane fills stay private to tabs because a ghost button may sit on a card or dialog.
  ghost: {
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
      ":active": colorVars["--honk-color-state-press"],
    },
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
  },
  // Bordered neutral on the base surface; hover fills the first control step under the ring.
  // Same strong ring as secondary — a white-on-white fill leaves the ring as the outline
  // button's ONLY shape signal, so a divider-grade hairline is not enough here either.
  outline: {
    backgroundColor: {
      default: colorVars["--honk-color-bg-base"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-control"] },
      ":active": colorVars["--honk-color-control-hover"],
    },
    color: colorVars["--honk-color-text-primary"],
    boxShadow: `${RING_STRONG}, ${NEUTRAL_BEVEL}`,
  },
  // Destructive, in the status err triplet (a subtle pale fill, not a loud red) — honk carries
  // status by the same fg/bg/border language everywhere. The ring stays; the tint deepens on press.
  danger: {
    backgroundColor: colorVars["--honk-color-err-bg"],
    color: colorVars["--honk-color-err-fg"],
    boxShadow: {
      default: RING_DANGER,
      ":hover": {
        "@media (hover: hover)": `${RING_DANGER}, ${STATE_TINT_HOVER}`,
      },
      ":active": `${RING_DANGER}, ${STATE_TINT_PRESS}`,
    },
  },
});

const sizeStyleBySize: Record<ButtonSize, stylex.StyleXStyles> = {
  sm: sx.sizeSm,
  md: sx.sizeMd,
  lg: sx.sizeLg,
};
const iconSizeStyleBySize: Record<ButtonSize, stylex.StyleXStyles> = {
  sm: sx.iconSm,
  md: sx.iconMd,
  lg: sx.iconLg,
};
// A primitive is styled by SPREADING stylex.props onto its Base UI element (the proven tooltip
// idiom) — never literal className=/style= attributes (the StyleX charter forbids those). So the
// button does NOT expose className/style: the app composes layout on a WRAPPER (Tailwind), and one
// instance is nudged with `xstyle` (a StyleX override, footgun-free). className/style are Omitted
// from the public props for exactly that reason. Base UI's own composition (a Tooltip.Trigger
// merging onto the button via `render`) still flows through — event handlers, ref, aria, and
// data-state ride `...rest`, which is spread before the StyleX className so styling stays ours.
interface ButtonProps extends Omit<Base.Props, "className" | "style"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  // Optional leading/trailing content (usually an <Icon>); laid out by the root's flex + gap.
  iconStart?: React.ReactNode;
  iconEnd?: React.ReactNode;
  // Fill the inline axis (a full-width action, e.g. a composer's primary button).
  block?: boolean;
  // StyleX escape hatch for the app to nudge one instance without the StyleX-vs-Tailwind footgun.
  xstyle?: stylex.StyleXStyles;
}

function Button({
  variant = "secondary",
  size = "md",
  iconStart,
  iconEnd,
  block = false,
  xstyle,
  type,
  render,
  children,
  ...rest
}: ButtonProps): React.ReactElement {
  return (
    <Base
      {...rest}
      // A plain button must not default to type="submit" inside a form; when composed as another
      // element via `render` (e.g. an <a>), leave type unset.
      type={type ?? (render ? undefined : "button")}
      render={render}
      data-slot="button"
      {...stylex.props(
        sx.root,
        sizeStyleBySize[size],
        variants[variant],
        block && sx.block,
        xstyle,
      )}
    >
      {iconStart}
      {children}
      {iconEnd}
    </Base>
  );
}

interface IconButtonProps extends Omit<Base.Props, "className" | "style"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  // Icon-only controls have no text, so an accessible name is REQUIRED (a Tooltip usually supplies
  // the same label visually — the two pair up on toolbar buttons).
  "aria-label": string;
  xstyle?: stylex.StyleXStyles;
}

function IconButton({
  variant = "ghost",
  size = "md",
  xstyle,
  type,
  render,
  children,
  ...rest
}: IconButtonProps): React.ReactElement {
  return (
    <Base
      {...rest}
      type={type ?? (render ? undefined : "button")}
      render={render}
      data-slot="icon-button"
      {...stylex.props(sx.root, iconSizeStyleBySize[size], variants[variant], xstyle)}
    >
      {children}
    </Base>
  );
}

export { Button, IconButton };
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps };
