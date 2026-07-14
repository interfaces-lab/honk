// The dialog — honk's modal overlay: a focused card that CENTERS in the viewport over a dimming
// scrim, for a short interruption the user must dispatch before returning to the app (rename a
// thread, confirm a discard). Built on Base UI's Dialog, which is modal by default — it owns the
// focus trap, the document scroll lock, and outside-press / Escape dismissal. The whole concept —
// the compound Dialog.* parts — in one file (ADR 0011: one concept per file).
//
// WHY BASE UI (round-8 doctrine): the design system adopts Base UI and ports its primitives into
// @honk/ui. ADR 0025 bans useEffect in OUR code, not a library's internals — Base UI owns the
// portal, the focus trap, and the scroll lock a modal needs, so this file stays a set of stateless
// styled wrappers with no effects of its own. Base UI toggles data-starting-style / data-ending-style
// ON the backdrop AND the popup, which StyleX on-self attribute selectors reach — so honk's blessed
// overlay scale-fade lives in StyleX, no @starting-style needed (the tooltip / popover idiom).
//
// HOW A MODAL DIFFERS FROM THE POPOVER (verified against the installed @base-ui/react 1.6.0 dialog
// .d.ts): a dialog is NOT anchored to a trigger, so it has NO Positioner — the parts are
// root / trigger / portal / backdrop / popup / title / description / close (/ viewport). The POPUP
// centers ITSELF (position:fixed + left/top 50% + a translate(-50%,-50%)) instead of riding a
// positioner, and — being unanchored — it emits neither --transform-origin nor data-instant (there is
// nothing to reposition), so it grows from its own CENTER and drops the tooltip's [data-instant]
// reset. Everything else is the popover surface, deliberately shared: bg-base fill + window radius +
// a hairline definition ring composed into the floating elevation, the ui font, the on-self
// opacity+scale fade — one token bus, so every overlay repaints together when a --honk-* var is dialed.
//
// THE SCRIM: a styled Base.Backdrop beneath the popup — fixed, inset 0, the --honk-color-scrim wash,
// its own opacity fade (fast in / instant out, reduced-motion 0s), at the dialog z tier. The popup
// shares that z tier and, sitting AFTER the backdrop inside the portal, paints above it.
//
// CENTERING × SCALE (the one modal-specific trap): the popup needs transform for the centering AND a
// scale for the fade. Driving both through `transform` would force a CONDITIONAL transform, which
// StyleX types as `unknown` (the switch.tsx thumb gap). So we SPLIT the two across CSS properties —
// the centering lives in `transform` (a non-conditional string, which types cleanly) and the fade
// lives in the separate `scale` property (conditional, keyed on Base UI's on-self data-attrs — the
// proven popover / menu / tooltip idiom). Two independent properties: neither clobbers the other and
// no cast is needed.
//
// STYLING (round-8 doctrine): Base UI + StyleX only — no className, no Tailwind. Our styled parts
// Omit className/style and take an `xstyle` StyleX hatch, styled by SPREADING stylex.props. The parts
// the app drives through `render` (Trigger, Close hang OUR <Button>) or places itself (Root) are THIN
// RE-EXPORTS of the Base part.
//
// PARTS:
//   Root        — groups the parts, owns open state, modal by default (re-export).
//   Trigger     — the app's own <Button>, merged on via `render` (re-export).
//   Popup       — OUR wrapper: folds Portal > Backdrop(scrim) > Popup(centered card + scale-fade),
//                 so the app writes one <Dialog.Popup>, not the raw three-level nest.
//   Title       — the labelling heading (body size, medium weight); resets the <h2> margin.
//   Description — the supporting caption (<p>, muted); resets the margin.
//   Header      — an OPTIONAL flex column holding Title + Description (a thin layout wrapper).
//   Footer      — an OPTIONAL flex row of action buttons, right-aligned, over a hairline top rule.
//   Close       — a button that dismisses (re-export; the app renders our <Button> via `render`).
//
// TOKENS: color (scrim / bg-base / text-primary / text-muted / border-muted), elevation (floating),
// radius (window), font (ui family + body/caption sizes + title/detail leadings + medium weight),
// motion (the overlay scale-fade tokens), z (dialog), space (panel-pad / gutter rhythm).

import { Dialog as Base } from "@base-ui/react/dialog";
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
// The no-raw-values anatomy exception (tooltip.tsx's TOOLTIP_MAX_WIDTH precedent): module-level, so
// the create-scoped lint never sees the px; any COLOR inside such a const stays a token.
// A rename/confirm modal is a small, focused card — narrow enough to read as one column, but width
// 100% (below) lets it shrink to fit a narrow viewport.
const DIALOG_MAX_WIDTH = "480px"; // shared with alert-dialog.tsx so the two modals read identically
// The height cap: never taller than 640px, and never within 24px of either viewport edge (the 48px is
// 24px top + 24px bottom breathing room). Past this the body scrolls (overflowY on the popup) rather
// than the card growing off-screen. dvh (not vh) so mobile browser chrome doesn't clip it.
const DIALOG_MAX_HEIGHT = "min(640px, calc(100dvh - 48px))";
// The card's inner inset. A modal wants more air than a dense panel's 12px pad (--honk-space-panel-pad),
// so this is its own justified intrinsic rather than a space token.
const DIALOG_PAD = "20px";
// The tight gap between the Title and its Description inside the Header (menu.tsx's MENU_FINE_GAP
// precedent) — grouped closer than the panel-pad rhythm that separates Header / body / Footer.
const DIALOG_HEADER_GAP = "4px";

// A hairline definition ring drawn as an INSET box-shadow (not a real border, so it never shifts
// layout and composes with the elevation shadow in one boxShadow) — the popover.tsx idiom. The
// geometry is literal; the COLOR stays a token.
const RING_MUTED = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;
// The Footer's top divider — a 1px hairline drawn as an inset box-shadow at the footer's top edge
// (same no-layout-shift idiom as the ring), so the action bar reads as a distinct band. Inset by the
// card padding on each side (a lighter, modern rule than a full-bleed border). COLOR is a token.
const FOOTER_HAIRLINE = `inset 0 1px 0 0 ${colorVars["--honk-color-border-muted"]}`;

const sx = stylex.create({
  // The scrim — a fixed full-viewport wash under the popup that dims the app and signals modality.
  // Its own opacity fade keyed on Base UI's on-self data-attrs (fast in / instant out — the blessed
  // pairing), with a reduced-motion sibling zeroing the duration (Law 8). At the dialog z tier; the
  // popup shares that tier but paints on top by DOM order (it follows the backdrop in the portal).
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: colorVars["--honk-color-scrim"],
    zIndex: zVars["--honk-z-dialog"],
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
      "[data-ending-style]": motionVars["--honk-motion-duration-instant"], // out 80ms (faster than in)
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  // The popup — a self-centering card carrying the shared popover surface. It positions ITSELF
  // (fixed + left/top 50% + the translate below) since a modal has no Positioner; the flex column +
  // panel-pad gap give Header / body / Footer their vertical rhythm, and overflowY:auto lets an
  // over-tall body scroll inside the height cap instead of pushing the card off-screen.
  popup: {
    boxSizing: "border-box",
    position: "fixed",
    left: "50%",
    top: "50%",
    // Centering only — a non-conditional string, so it steers clear of StyleX's conditional-transform
    // `unknown` gap. The enter/exit scale rides the separate `scale` property below (see the header's
    // "CENTERING × SCALE" note), so the two transforms never clobber each other.
    transform: "translate(-50%, -50%)",
    // The card shares the backdrop's z tier and MUST set it explicitly: the backdrop carries an
    // explicit z-index, so leaving the popup at `auto` would let the scrim (positive z) paint OVER
    // the card. Equal z + rendered AFTER the backdrop in the portal → the card wins by DOM order.
    zIndex: zVars["--honk-z-dialog"],
    width: "100%", // fill up to the max; on a narrow viewport it shrinks to fit rather than overflow
    maxWidth: DIALOG_MAX_WIDTH,
    maxHeight: DIALOG_MAX_HEIGHT,
    overflowY: "auto", // an over-tall body scrolls the card; the common short modal never triggers it
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-panel-pad"], // the rhythm between Header / body / Footer
    padding: DIALOG_PAD,
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    // The hairline ring in front of the elevation, one boxShadow (the inset ring draws inside, the
    // elevation drops outside — they never overlap; the popover.tsx surface recipe).
    boxShadow: `${RING_MUTED}, ${elevationVars["--honk-elevation-floating"]}`,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    // The modal takes focus (Base UI's trap); the trapped content is the focus indicator, so the
    // container's own browser focus ring is suppressed.
    outline: "none",
    // A modal grows from its own CENTER (it emits no --transform-origin — nothing anchors it).
    transformOrigin: "center",
    // Enter/exit scale-fade, driven by Base UI's on-self data-attrs (the popover idiom): hidden +
    // scaled at the start/end frames, full at rest. `scale` is a property apart from `transform`
    // (which holds the centering), so the conditional value types cleanly. Reduced motion pins scale
    // 1 and zeroes the duration below (Law 8).
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
    // NOTE: no [data-instant] reset here — that attr is a Positioner's jitter-free reposition signal,
    // and a modal has no Positioner (verified: DialogPopupDataAttributes has no data-instant).
  },
  // The labelling heading — body size at medium weight out-ranks the muted caption below by a real
  // step (the popover.tsx title treatment, shared across overlays). Reset the <h2>'s browser margin.
  title: {
    margin: 0,
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-title"],
    fontWeight: fontVars["--honk-font-weight-medium"],
    color: colorVars["--honk-color-text-primary"],
  },
  // Supporting copy under the title — a muted caption. Reset the <p>'s browser margin (the Header owns
  // the gap to the title).
  description: {
    margin: 0,
    fontSize: fontVars["--honk-font-size-caption"],
    lineHeight: fontVars["--honk-leading-detail"],
    color: colorVars["--honk-color-text-muted"],
  },
  // Header — a thin column that groups the Title and Description tightly together (the fine gap),
  // sitting at the top of the card's flex rhythm.
  header: {
    display: "flex",
    flexDirection: "column",
    gap: DIALOG_HEADER_GAP,
  },
  // Footer — the action bar: a right-aligned row of buttons over a hairline top rule, with its own
  // pad above the buttons so the rule sits centered in the space the popup's gap opens above it.
  footer: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spaceVars["--honk-space-gutter"], // the sliver between the action buttons
    paddingTop: spaceVars["--honk-space-panel-pad"], // air between the rule and the buttons
    boxShadow: FOOTER_HAIRLINE,
  },
});

// ── Popup — the surface, folding Portal > Backdrop > Popup so the app writes one element ─────────
// className/style are Omitted (the StyleX charter's no-classname-style rule): the app composes its
// content inside and nudges the surface with `xstyle`. Base UI's own Popup props (initialFocus /
// finalFocus, id, aria, render, children) ride `...rest` onto Base.Popup, spread BEFORE the StyleX
// props so the styling stays ours (the popover.tsx order). The Backdrop is folded in, never exposed —
// its scrim is an internal of the modal surface, not a part the app arranges.
interface DialogPopupProps extends Omit<Base.Popup.Props, "className" | "style"> {
  // StyleX escape hatch for the app to nudge one surface (e.g. a wider dialog) without the
  // StyleX-vs-Tailwind footgun.
  xstyle?: stylex.StyleXStyles;
}

function DialogPopup({ xstyle, children, ...rest }: DialogPopupProps): React.ReactElement {
  return (
    <Base.Portal>
      <Base.Backdrop data-slot="dialog-backdrop" {...stylex.props(sx.backdrop)} />
      <Base.Popup {...rest} data-slot="dialog" {...stylex.props(sx.popup, xstyle)}>
        {children}
      </Base.Popup>
    </Base.Portal>
  );
}

// ── Title — the labelling heading ───────────────────────────────────────────────────────────────
interface DialogTitleProps extends Omit<Base.Title.Props, "className" | "style"> {
  xstyle?: stylex.StyleXStyles;
}

function DialogTitle({ xstyle, ...rest }: DialogTitleProps): React.ReactElement {
  return <Base.Title {...rest} data-slot="dialog-title" {...stylex.props(sx.title, xstyle)} />;
}

// ── Description — the supporting caption ─────────────────────────────────────────────────────────
interface DialogDescriptionProps extends Omit<Base.Description.Props, "className" | "style"> {
  xstyle?: stylex.StyleXStyles;
}

function DialogDescription({ xstyle, ...rest }: DialogDescriptionProps): React.ReactElement {
  return (
    <Base.Description {...rest} data-slot="dialog-description" {...stylex.props(sx.description, xstyle)} />
  );
}

// ── Header — the optional Title + Description column (a plain layout wrapper, not a Base UI part) ──
interface DialogHeaderProps extends Omit<React.ComponentProps<"div">, "className" | "style"> {
  xstyle?: stylex.StyleXStyles;
}

function DialogHeader({ xstyle, ...rest }: DialogHeaderProps): React.ReactElement {
  return <div {...rest} data-slot="dialog-header" {...stylex.props(sx.header, xstyle)} />;
}

// ── Footer — the optional action-button row (a plain layout wrapper, not a Base UI part) ──────────
interface DialogFooterProps extends Omit<React.ComponentProps<"div">, "className" | "style"> {
  xstyle?: stylex.StyleXStyles;
}

function DialogFooter({ xstyle, ...rest }: DialogFooterProps): React.ReactElement {
  return <div {...rest} data-slot="dialog-footer" {...stylex.props(sx.footer, xstyle)} />;
}

// The compound namespace (composed by the app like Popover / Menu). Root / Trigger / Close are thin
// re-exports of the Base part — the app drives them through `render` (Trigger + Close hang our
// <Button>) or places them itself (Root wraps + owns open state), and none is a surface THIS file
// paints, so re-wrapping would only add a passthrough. Popup / Title / Description / Header / Footer
// are our styled wrappers above.
const Dialog = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Popup: DialogPopup,
  Title: DialogTitle,
  Description: DialogDescription,
  Header: DialogHeader,
  Footer: DialogFooter,
  Close: Base.Close,
};

export { Dialog };
export type {
  DialogDescriptionProps,
  DialogFooterProps,
  DialogHeaderProps,
  DialogPopupProps,
  DialogTitleProps,
};
