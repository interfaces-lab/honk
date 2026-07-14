// The popover — honk's bare floating surface anchored to a trigger, holding ARBITRARY interactive
// content (a small form, a cluster of actions, a confirm prompt) — unlike the tooltip, whose popup
// is a plain non-interactive label. Built on Base UI's Popover, the SAME primitive family the
// tooltip wraps, so the two overlays share ONE surface recipe (below) and repaint together off the
// token bus. The whole concept — the compound Popover.* parts — in one file (ADR 0011).
//
// WHY BASE UI (round-8 doctrine): the design system adopts Base UI and ports its primitives into
// @honk/ui. ADR 0025 bans useEffect in OUR code, not a library's internals — Base UI owns the
// portal, the anchor positioning, AND the focus management a popover needs (move focus in on open,
// return it to the trigger on close), so these stay stateless styled wrappers. Base UI toggles
// data-starting-style / data-ending-style ON THE POPUP, which StyleX on-self attribute selectors
// reach — so honk's blessed overlay scale-fade lives in StyleX, no @starting-style needed (the
// tooltip idiom, reused verbatim).
//
// THE SURFACE IS THE TOOLTIP'S (deliberately shared): the positioner carries ONLY the stacking
// (z-popover); the popup carries the surface — bg-base fill, floating elevation, window-tier radius,
// ui font — plus the on-self scale-fade, the same tokens as tooltip.tsx so one dialkit setProperty
// repaints every overlay at once. THREE deltas from the tooltip, each because a popover is an
// interactive floating CARD, not a hint chip: (1) the popup eats the pointer (pointerEvents stays
// auto — omit the tooltip's pointerEvents:none); (2) a window-tier radius + a hairline definition
// ring (a floating card wants an edge; the tooltip's tiny control chip does not); (3) content is
// inset by the card-pad token (--honk-space-panel-pad) so arbitrary children get breathing room.
//
// STYLING (round-8 doctrine): Base UI + StyleX only — no className, no Tailwind. Our styled parts
// (Popup / Title / Description) Omit className/style and take an `xstyle` StyleX escape hatch, styled
// by SPREADING stylex.props. The composition parts the app drives through `render` (Trigger, Close)
// or places itself (Root, Arrow) are THIN RE-EXPORTS of the Base part: the app hangs OUR <Button> on
// the Trigger/Close via `render={<Button/>}`, and Button already Omits className/style, so styling
// stays ours without this file re-wrapping a control it does not paint.
//
// PARTS (verified against the installed @base-ui/react 1.6.0 popover .d.ts + its DataAttributes):
//   Root        — groups the parts, owns open state (re-export; renders no element of its own).
//   Trigger     — the app's own <Button>, merged on via `render` (re-export).
//   Popup       — OUR wrapper: folds Portal > Positioner(z + side/sideOffset/align) > Popup(surface
//                 + scale-fade), so the app writes one <Popover.Popup>, not the raw 4-level nest.
//   Title       — a small heading (body size, medium weight, text-primary); resets the <h2> margin.
//   Description — a muted caption paragraph (<p>); resets the margin.
//   Close       — a button that dismisses (re-export; the app renders our <Button> via `render`).
//   Arrow       — an unstyled positioning hook (re-export). The default popover is arrowless (the
//                 tooltip precedent); a surface-matched arrow (rotated square + partial ring) is
//                 deferred until a call site needs one.
//
// TOKENS: color (bg-base / text-primary / text-muted / border-muted), elevation (floating), radius
// (window), font (ui family + body/caption sizes + title/detail leadings + medium weight), motion
// (the overlay scale-fade tokens), z (popover), space (panel-pad).

import { Popover as Base } from "@base-ui/react/popover";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import {
  colorVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
  zVars,
} from "./tokens.stylex";

// Gap between the trigger and the popup (Positioner sideOffset). A JS prop value, not a design
// token — the tooltip's TOOLTIP_GUTTER_PX precedent; 8 gives an interactive surface a touch more air
// than the tooltip's 6.
const POPOVER_GUTTER_PX = 8;

// A hairline definition ring drawn as an INSET box-shadow (not a real border, so it never shifts
// layout and composes with the elevation shadow in one boxShadow) — the button.tsx idiom. The
// geometry is literal; the COLOR stays a token. A floating card reads its own edge with this even
// where the light-mode drop shadow is faint.
const RING_MUTED = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;

const sx = stylex.create({
  // The Positioner carries ONLY the overlay's stacking. An overlay's z-index is a PRIMITIVE internal
  // (its slot in the overlay stack), so it lives in StyleX reading the z token, not app layout
  // (tooltip.tsx sx.positioner, verbatim — only the token differs: z-popover, not z-tooltip).
  positioner: {
    zIndex: zVars["--honk-z-popover"],
  },
  popup: {
    // Surface — a floating card: bg-base fill, window-tier radius (larger than the tooltip's control
    // chip), the floating elevation with a hairline definition ring composed in front of it, the ui
    // font + a sane body-size/primary-text base for arbitrary children. Tokens only.
    boxSizing: "border-box",
    padding: spaceVars["--honk-space-panel-pad"], // 12px card inset — arbitrary children get room
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    // The hairline ring in front of the elevation, one boxShadow (inset ring draws inside, the
    // elevation drops outside — they never overlap; button.tsx composes rings + tints the same way).
    boxShadow: `${RING_MUTED}, ${elevationVars["--honk-elevation-floating"]}`,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    // NO pointerEvents:none — a popover IS interactive, so its popup eats the pointer (the one place
    // it parts ways with the tooltip's surface). Default (auto) is exactly that, so it stays unset.

    // Base UI emits --transform-origin on the popup (the side it grew from); read it in place
    // (a library var, not a --honk token — round-8 Law 4).
    transformOrigin: "var(--transform-origin)",
    // Enter/exit scale-fade, driven by Base UI's on-self data-attrs (the tooltip idiom, verbatim):
    // hidden + scaled at the start/end frames, full at rest. Reduced motion pins scale 1 and zeroes
    // the duration below (Law 8 — every animated call site carries its own r-m sibling).
    opacity: {
      default: 1,
      "[data-starting-style]": 0,
      "[data-ending-style]": 0,
    },
    scale: {
      default: 1,
      "[data-starting-style]": motionVars["--honk-motion-scale-overlay"],
      "[data-ending-style]": motionVars["--honk-motion-scale-overlay"],
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transitionProperty: "opacity, scale",
    transitionTimingFunction: {
      // enter decelerates (house curve); exit accelerates away (ease-in) — the blessed pairing.
      default: motionVars["--honk-motion-ease-out"],
      "[data-ending-style]": motionVars["--honk-motion-ease-in"],
    },
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"], // enter 120ms
      "[data-ending-style]": motionVars["--honk-motion-duration-instant"], // exit 80ms (faster than enter)
      "[data-instant]": "0s", // Base UI's jitter-free reposition: no transition
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  // A small heading that labels the popover. body size (13px) at medium weight out-ranks the caption
  // description below by a real step (honk has no dedicated "label" tier); reset the <h2>'s default
  // browser margin so it sits flush at the top of the card.
  title: {
    margin: 0,
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-title"],
    fontWeight: fontVars["--honk-font-weight-medium"],
    color: colorVars["--honk-color-text-primary"],
  },
  // Supporting copy under the title — a muted caption. Reset the <p>'s default margin (the app owns
  // the gap between parts via the wrapper it lays them out in).
  description: {
    margin: 0,
    fontSize: fontVars["--honk-font-size-caption"],
    lineHeight: fontVars["--honk-leading-detail"],
    color: colorVars["--honk-color-text-muted"],
  },
});

// ── Popup — the surface, folding Portal > Positioner > Popup so the app writes one element ──────
// className/style are Omitted (the StyleX charter's no-classname-style rule): the app composes its
// content inside and nudges the surface with `xstyle`. side/sideOffset/align steer the Positioner;
// everything else (initialFocus/finalFocus, id, aria, render, children) rides Base.Popup via `rest`,
// spread BEFORE the StyleX props so the styling stays ours (the button.tsx order).
interface PopoverPopupProps extends Omit<Base.Popup.Props, "className" | "style"> {
  side?: Base.Positioner.Props["side"];
  sideOffset?: number;
  align?: Base.Positioner.Props["align"];
  // StyleX escape hatch for the app to nudge one surface (e.g. a fixed width) without the
  // StyleX-vs-Tailwind footgun.
  xstyle?: stylex.StyleXStyles;
}

function PopoverPopup({
  side = "bottom",
  sideOffset = POPOVER_GUTTER_PX,
  align = "center",
  xstyle,
  children,
  ...rest
}: PopoverPopupProps): React.ReactElement {
  return (
    <Base.Portal>
      <Base.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        {...stylex.props(sx.positioner)}
      >
        <Base.Popup {...rest} data-slot="popover" {...stylex.props(sx.popup, xstyle)}>
          {children}
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}

// ── Title — the labelling heading ──────────────────────────────────────────────────────────────
interface PopoverTitleProps extends Omit<Base.Title.Props, "className" | "style"> {
  xstyle?: stylex.StyleXStyles;
}

function PopoverTitle({ xstyle, ...rest }: PopoverTitleProps): React.ReactElement {
  return <Base.Title {...rest} data-slot="popover-title" {...stylex.props(sx.title, xstyle)} />;
}

// ── Description — the supporting caption ────────────────────────────────────────────────────────
interface PopoverDescriptionProps extends Omit<Base.Description.Props, "className" | "style"> {
  xstyle?: stylex.StyleXStyles;
}

function PopoverDescription({ xstyle, ...rest }: PopoverDescriptionProps): React.ReactElement {
  return (
    <Base.Description {...rest} data-slot="popover-description" {...stylex.props(sx.description, xstyle)} />
  );
}

// The compound namespace (composed by the app like Shell). Root/Trigger/Close/Arrow are thin
// re-exports of the Base part — the app drives them through `render` (Trigger, Close hang our
// <Button>) or places them itself (Root wraps, Arrow is an optional positioning hook), and none of
// them is a surface THIS file paints, so re-wrapping would only add a passthrough. Popup/Title/
// Description are our styled wrappers above.
const Popover = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Popup: PopoverPopup,
  Title: PopoverTitle,
  Description: PopoverDescription,
  Close: Base.Close,
  Arrow: Base.Arrow,
};

export { Popover };
export type { PopoverPopupProps, PopoverTitleProps, PopoverDescriptionProps };
