// The alert dialog — honk's FORCED-DECISION modal: a centered card over a dimming scrim that the
// user must resolve with an explicit action (Confirm / Cancel), NOT by clicking away. Built on Base
// UI's AlertDialog — the Dialog primitive with two invariants the library bakes in and we cannot
// (and must not) loosen: it is ALWAYS modal, and outside-press / focus-out dismissal is disabled, so
// the scrim can't be clicked to escape the choice; the popup also carries role="alertdialog" (Base
// UI's useRenderDialogRoot(props, "alert-dialog") sets modal=true, disablePointerDismissal=true,
// role="alertdialog"). The whole concept — the compound AlertDialog.* parts — in one file (ADR 0011).
//
// WHY BASE UI (round-8 doctrine): the design system adopts Base UI and ports its primitives into
// @honk/ui. A modal needs a focus trap, a scroll lock, a portal, and the aria wiring (the popup's
// aria-labelledby → Title, aria-describedby → Description); ADR 0025 bans useEffect in OUR code, not
// a library's internals, so Base UI owns ALL of that and this file stays stateless styled wrappers.
// The Root's open state is Base UI's (uncontrolled via defaultOpen, or controlled by the app).
//
// SAME SURFACE AS THE DIALOG / POPOVER (deliberately shared): a modal is just a Popover surface that
// centers in the viewport instead of anchoring to a trigger. The Popup reuses the popover recipe
// VERBATIM — bg-base fill, window-tier radius, a hairline definition ring composed in FRONT of the
// floating elevation (one boxShadow), text-primary ink, the ui font — plus the blessed on-self
// scale-fade keyed on Base UI's [data-starting-style]/[data-ending-style], so every overlay in the
// system repaints together off the token bus. THREE modal-only deltas from the anchored popover:
//   (1) NO Positioner — Base UI's dialog/alert-dialog have none; the Popup positions ITSELF. We
//       center it with position:fixed + left/top 50% + a translate(-50%,-50%) — a plain (never
//       conditional) transform string, so the on-self scale rides the separate `scale` property (the
//       property split: transform stays a string StyleX can type, scale stays a conditional number
//       like the siblings — this sidesteps StyleX's conditional-transform=`unknown` gap entirely, no
//       cast needed). transformOrigin is `center` (a modal grows from its own middle), NOT the
//       popover's var(--transform-origin) (which names the anchored side).
//   (2) a DIMMING SCRIM — a Base.Backdrop wash (colorVars --honk-color-scrim) fixed over the whole
//       viewport with its OWN opacity fade, folded into our Popup wrapper beneath the card.
//   (3) card geometry — a max-width + a viewport-capped max-height with the body scrolling, so a
//       long confirmation still fits a small window.
//
// STRUCTURE (mirrors popover.tsx): our AlertDialog.Popup folds Portal > Backdrop > Popup so the app
// writes ONE <AlertDialog.Popup>. Header (a flex column holding Title + Description) and Footer (a
// right-aligned action row over a hairline divider) are thin styled layout wrappers — honkkit's
// dialog earns these. Root / Trigger / Close are thin re-exports: the app hangs OUR <Button> on the
// Trigger and Close via `render` (Button already Omits className/style), so styling stays ours.
//
// STYLING (round-8 doctrine): Base UI + StyleX only — no className, no Tailwind. Our styled parts
// Omit className/style and take an `xstyle` StyleX escape hatch, styled by SPREADING stylex.props.
//
// PARTS (verified against the installed @base-ui/react 1.6.0 alert-dialog .d.ts — its parts are
// root/trigger/portal/backdrop/popup/title/description/close/viewport, NO positioner; the popup +
// backdrop + title + description + close are the shared Dialog parts, re-exported):
//   Root        — groups the parts, owns open state (re-export; renders no element).
//   Trigger     — the app's own <Button>, merged on via `render` (re-export).
//   Popup       — OUR wrapper: folds Portal > Backdrop(scrim) > Popup(centered card + scale-fade).
//   Title       — the heading (<h2>); labels the popup (aria-labelledby). body size, medium weight.
//   Description — the supporting caption (<p>); describes the popup (aria-describedby). muted.
//   Header      — OUR layout wrapper: a flex column stacking Title + Description.
//   Footer      — OUR layout wrapper: a right-aligned action row over a hairline top divider.
//   Close       — a button that resolves the dialog (re-export; the app renders our <Button>).
//
// TOKENS: color (bg-base / text-primary / text-muted / border-muted / the scrim wash), elevation
// (floating), radius (window), font (ui family + body/caption sizes + title/detail leadings + medium
// weight), motion (the overlay scale-fade tokens), space (the footer's inter-button gutter), z
// (dialog — both scrim and card sit on this tier; the card wins by DOM order, rendered after).

import { AlertDialog as Base } from "@base-ui/react/alert-dialog";
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

// ── Card anatomy (named intrinsics — modal geometry, not shared design vocabulary) ──────────────
// The no-raw-values anatomy exception (tooltip.tsx's TOOLTIP_MAX_WIDTH / menu.tsx's MENU_MIN_WIDTH
// precedent): module-level, so the create-scoped lint never sees the px; any color inside such a
// const is still a token. A future dialog.tsx shares these so the two modals stay visually identical.
const DIALOG_MAX_WIDTH = "480px";
// Cap the height at a sane ceiling AND at the viewport minus a 24px top/bottom margin (48px total),
// so a tall confirmation scrolls its body instead of running off a short window. dvh tracks the
// dynamic viewport (mobile browser chrome), min() takes whichever is smaller.
const DIALOG_MAX_HEIGHT = "min(640px, calc(100dvh - 48px))";
// The card inset. A modal is a larger, more prominent surface than a 12px popover chip, so it earns
// more room; 20px is shared with dialog.tsx so the two modals read identically.
const DIALOG_PAD = "20px";
// The vertical rhythm between the popup's sections (the flex column's rowGap) AND, reused, the gap
// from the footer's divider down to its buttons — so the divider reads with equal air above and below.
const DIALOG_GAP = "12px";
// Title → description: a tight pairing, closer than the section rhythm (they are one labelled unit).
const DIALOG_HEADER_GAP = "4px";

// A hairline definition ring drawn as an INSET box-shadow (not a real border, so it never shifts
// layout and composes with the elevation shadow in one boxShadow) — the popover.tsx idiom. Geometry
// is literal; the COLOR stays a token.
const RING_MUTED = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;
// The footer's top divider — a 1px hairline at the footer's top edge, also an inset box-shadow (no
// layout shift). Inset by the card padding, so it aligns with the content column rather than
// bleeding to the card edges (the menu.tsx "no negative-margin math" simplification).
const FOOTER_DIVIDER = `inset 0 1px 0 0 ${colorVars["--honk-color-border-muted"]}`;

const sx = stylex.create({
  // The scrim — a dimming wash fixed over the whole viewport BENEATH the card. Its own opacity fade
  // (fast in / instant out, the overlay pairing) is driven by Base UI's on-self data-attrs; reduced
  // motion zeroes it (Law 8). Sits on the dialog z-tier; the card, rendered after it in the portal,
  // stacks above at the same z by DOM order. Background is the scrim token (not a surface — a
  // translucent overlay, the same neutral-black language as the state tints).
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: zVars["--honk-z-dialog"],
    backgroundColor: colorVars["--honk-color-scrim"],
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
      default: motionVars["--honk-motion-duration-fast"], // fade in 120ms
      "[data-ending-style]": motionVars["--honk-motion-duration-instant"], // fade out 80ms
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  // The card — the popover surface, self-centered in the viewport (no Positioner). position:fixed +
  // left/top 50% + a translate(-50%,-50%) centers it; the translate is a plain string (never
  // conditional), so the scale-fade rides the separate `scale` property below — the property split
  // that avoids StyleX's conditional-transform=`unknown` gap. transformOrigin center: the card grows
  // from its own middle, not the popover's anchored side.
  popup: {
    boxSizing: "border-box",
    position: "fixed",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    transformOrigin: "center",
    zIndex: zVars["--honk-z-dialog"],
    // A column of sections (Header / body / Footer) spaced by the section rhythm.
    display: "flex",
    flexDirection: "column",
    rowGap: DIALOG_GAP,
    // Fills the available width, capped at the card max; on a window narrower than the cap it shrinks
    // to fit instead of overflowing. The height is capped and the card scrolls its own overflow.
    width: "100%",
    maxWidth: DIALOG_MAX_WIDTH,
    maxHeight: DIALOG_MAX_HEIGHT,
    overflowY: "auto",
    padding: DIALOG_PAD,
    // Surface (popover.tsx recipe, verbatim): bg-base fill, window radius, the hairline ring in FRONT
    // of the floating elevation (inset ring draws inside, elevation drops outside — one boxShadow,
    // never overlapping), text-primary ink, the ui font + a body-size base for arbitrary children.
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `${RING_MUTED}, ${elevationVars["--honk-elevation-floating"]}`,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    // Base UI moves focus INTO the card on open; the card container itself takes no visible focus ring.
    outline: "none",
    // Enter/exit scale-fade (the tooltip/popover idiom): hidden + scaled at the start/end frames,
    // full at rest, driven by Base UI's on-self data-attrs. Reduced motion pins scale 1 and zeroes
    // the duration (Law 8 — every animated call site carries its own r-m sibling). No [data-instant]
    // case: a centered modal never repositions (that attr is the anchored-positioner's, absent here).
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
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  // Header — a flex column stacking the Title over the Description, a tight pairing gap between them.
  header: {
    display: "flex",
    flexDirection: "column",
    rowGap: DIALOG_HEADER_GAP,
  },
  // The labelling heading. body size (13px) at medium weight out-ranks the muted caption below by a
  // real step (honk has no dedicated "label" tier); reset the <h2>'s default margin so it sits flush.
  title: {
    margin: 0,
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-title"],
    fontWeight: fontVars["--honk-font-weight-medium"],
    color: colorVars["--honk-color-text-primary"],
  },
  // Supporting copy under the title — a muted caption. Reset the <p>'s default margin (the Header
  // owns the title→description gap).
  description: {
    margin: 0,
    fontSize: fontVars["--honk-font-size-caption"],
    lineHeight: fontVars["--honk-leading-detail"],
    color: colorVars["--honk-color-text-muted"],
  },
  // Footer — the action row: buttons pushed to the trailing edge, gutter-gapped, sitting below a
  // hairline top divider (the inset box-shadow above) with the section rhythm of air under it.
  footer: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spaceVars["--honk-space-gutter"],
    paddingTop: DIALOG_GAP,
    boxShadow: FOOTER_DIVIDER,
  },
});

// ── Popup — folds Portal > Backdrop(scrim) > Popup so the app writes one element ─────────────────
// className/style are Omitted (the StyleX charter's no-classname-style rule): the app composes its
// content inside and nudges the surface with `xstyle`. Base UI's Popup props (initialFocus,
// finalFocus, id, aria, render, children) ride Base.Popup via `rest`, spread BEFORE the StyleX props
// so styling stays ours (the popover.tsx order). The Backdrop takes no props — it is internal chrome,
// not a part the app composes, so it is not exposed on the namespace.
interface AlertDialogPopupProps extends Omit<Base.Popup.Props, "className" | "style"> {
  // StyleX escape hatch for the app to nudge one surface (e.g. a wider confirm) without the
  // StyleX-vs-Tailwind footgun.
  xstyle?: stylex.StyleXStyles;
}

function AlertDialogPopup({ xstyle, children, ...rest }: AlertDialogPopupProps): React.ReactElement {
  return (
    <Base.Portal>
      <Base.Backdrop data-slot="alert-dialog-backdrop" {...stylex.props(sx.backdrop)} />
      <Base.Popup {...rest} data-slot="alert-dialog" {...stylex.props(sx.popup, xstyle)}>
        {children}
      </Base.Popup>
    </Base.Portal>
  );
}

// ── Title — the labelling heading (Base UI wires aria-labelledby to the popup) ───────────────────
interface AlertDialogTitleProps extends Omit<Base.Title.Props, "className" | "style"> {
  xstyle?: stylex.StyleXStyles;
}

function AlertDialogTitle({ xstyle, ...rest }: AlertDialogTitleProps): React.ReactElement {
  return <Base.Title {...rest} data-slot="alert-dialog-title" {...stylex.props(sx.title, xstyle)} />;
}

// ── Description — the supporting caption (Base UI wires aria-describedby to the popup) ────────────
interface AlertDialogDescriptionProps extends Omit<Base.Description.Props, "className" | "style"> {
  xstyle?: stylex.StyleXStyles;
}

function AlertDialogDescription({
  xstyle,
  ...rest
}: AlertDialogDescriptionProps): React.ReactElement {
  return (
    <Base.Description
      {...rest}
      data-slot="alert-dialog-description"
      {...stylex.props(sx.description, xstyle)}
    />
  );
}

// ── Header — a plain styled layout wrapper (not a Base UI part) stacking Title + Description ──────
interface AlertDialogHeaderProps extends Omit<React.ComponentPropsWithoutRef<"div">, "className" | "style"> {
  xstyle?: stylex.StyleXStyles;
}

function AlertDialogHeader({ xstyle, ...rest }: AlertDialogHeaderProps): React.ReactElement {
  return <div {...rest} data-slot="alert-dialog-header" {...stylex.props(sx.header, xstyle)} />;
}

// ── Footer — a plain styled layout wrapper (not a Base UI part): the right-aligned action row ─────
interface AlertDialogFooterProps extends Omit<React.ComponentPropsWithoutRef<"div">, "className" | "style"> {
  xstyle?: stylex.StyleXStyles;
}

function AlertDialogFooter({ xstyle, ...rest }: AlertDialogFooterProps): React.ReactElement {
  return <div {...rest} data-slot="alert-dialog-footer" {...stylex.props(sx.footer, xstyle)} />;
}

// The compound namespace (composed by the app like Popover/Menu). Root / Trigger / Close are thin
// re-exports of the Base part — the app drives them through `render` (Trigger + Close hang our
// <Button>) or places them itself (Root wraps), and none is a surface THIS file paints, so
// re-wrapping would only add a passthrough. Popup / Title / Description / Header / Footer are our
// styled wrappers above. Portal + Backdrop + Viewport are internal (folded into Popup or unused), so
// they are deliberately not surfaced.
const AlertDialog = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Popup: AlertDialogPopup,
  Title: AlertDialogTitle,
  Description: AlertDialogDescription,
  Header: AlertDialogHeader,
  Footer: AlertDialogFooter,
  Close: Base.Close,
};

export { AlertDialog };
export type {
  AlertDialogDescriptionProps,
  AlertDialogFooterProps,
  AlertDialogHeaderProps,
  AlertDialogPopupProps,
  AlertDialogTitleProps,
};
