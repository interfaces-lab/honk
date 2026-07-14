// The tooltip — a hover/focus label, built on Base UI's tooltip (the shipped identity: honkkit
// wraps the same @base-ui/react primitive). The whole concept in one file (ADR 0011).
//
// WHY BASE UI (round-8 doctrine): the design system adopts Base UI and ports its primitives into
// @honk/ui. ADR 0025 bans useEffect in OUR code, not a library's internals — Base UI is a
// library, so its portal + positioning effects are fine. Base UI also gives the enter/exit
// animation a hand-rolled Popover-API tooltip cannot: it toggles data-starting-style /
// data-ending-style ON THE POPUP, which StyleX on-self attribute selectors reach (the same idiom
// honkkit's menu surface uses, menu-styles.ts:54-66) — so honk's blessed 120ms overlay
// scale-fade lives in StyleX, no @starting-style needed.
//
// THE STYLING SPLIT (round-8 doctrine, refined by the GPT-5.5 consult):
//   • StyleX owns EVERYTHING internal to the primitive — the popup surface + its on-self
//     data-state animation (sx.popup), and the positioner's own stacking (sx.positioner z-index,
//     reading the z token). An overlay's z-index is a primitive internal, not app layout.
//   • Tailwind is NOT used inside a primitive: it is reserved for the APP arranging primitives
//     (flex/grid/gap/size around them). So this file is StyleX + Base UI only — no className.
//   • Tokens stay the single bus: sx reads colorVars/zVars/etc., so one dialkit setProperty on a
//     --honk-* var repaints the live surface with zero React.
//
// TWO SHAPES:
//   • Tooltip           — trigger-based (Base UI merges onto the child via `render`); the normal case.
//   • AnchoredTooltip   — controlled + triggerless, anchored via a function anchor `() => el`; for
//     the tab strip, whose delegated-events model has no per-tab trigger to hang a Trigger on.

import { Tooltip as Base } from "@base-ui/react/tooltip";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import {
  colorVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
  zVars,
} from "./tokens.stylex";

// ── Interaction constants (JS timings — named, not tokens; the tabs.tsx precedent) ──────────
// Open delay: long enough that scrubbing across triggers doesn't flash tooltips (shipped meters
// use 150ms, Base UI defaults ~600ms, opencode 400ms — 500 splits them for title tooltips).
const TOOLTIP_OPEN_DELAY_MS = 500;
// Grouping window: after one tooltip closes, another opens instantly within this window, so
// moving across a row of triggers doesn't re-wait the delay each time (opencode's skip window).
const TOOLTIP_SKIP_MS = 300;
// Gap between the anchor and the popup — the shipped chat-title tooltip's sideOffset / opencode's
// gutter are both 6.
const TOOLTIP_GUTTER_PX = 6;

// ── Surface intrinsics (named, justified — tooltip anatomy, not shared vocabulary) ──────────
const TOOLTIP_MAX_WIDTH = "280px";
const TOOLTIP_PAD_X = "8px";
const TOOLTIP_PAD_Y = "4px";

// ── Styles (StyleX; the POPUP surface + on-self Base UI data-state animation) ────────────────

const sx = stylex.create({
  // The Positioner carries only the overlay's stacking. An overlay's z-index is a PRIMITIVE
  // internal (its place in the overlay stack), not app-layout composition — so it lives in StyleX
  // reading the z token, NOT a Tailwind utility (GPT-5.5's refined division: Tailwind is for the
  // app arranging primitives; a primitive styles its own internals). Keeping the Positioner
  // StyleX-only also satisfies the no-mix rule (never StyleX + Tailwind on one element).
  positioner: {
    zIndex: zVars["--honk-z-tooltip"],
  },
  popup: {
    // Surface — the shipped honk tooltip (tooltip research §1): elevated card, control radius,
    // floating shadow, caption type, 8px×4px padding. Tokens only.
    maxWidth: TOOLTIP_MAX_WIDTH,
    paddingInline: TOOLTIP_PAD_X,
    paddingBlock: TOOLTIP_PAD_Y,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: elevationVars["--honk-elevation-floating"],
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-caption"],
    lineHeight: fontVars["--honk-leading-detail"],
    // Never eats the pointer — leaving the trigger hides it, no safe area to cross.
    pointerEvents: "none",
    // Base UI emits --transform-origin on the popup (the side it grew from); read it in place
    // (a library var, not a --honk token — round-8 Law 4).
    transformOrigin: "var(--transform-origin)",
    // Enter/exit scale-fade, driven by Base UI's on-self data-attrs (the menu-styles idiom):
    // hidden + scaled at the start/end frames, full at rest. Reduced motion pins scale 1 and
    // zeroes the duration below (Law 8 — every animated call site carries its own r-m sibling).
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
});

// The popup surface, exported so the tab strip's AnchoredTooltip and any consumer render the
// identical surface without re-declaring it.
const tooltipPopupStyles = sx;

// ── Provider (mount ONCE at the shell root) ──────────────────────────────────────────────────
// Shares the open delay + the skip-grouping window across every trigger-based Tooltip, so
// scrubbing between controls doesn't re-wait the full delay.

function TooltipProvider(props: Base.Provider.Props): React.ReactElement {
  return (
    <Base.Provider
      delay={TOOLTIP_OPEN_DELAY_MS}
      closeDelay={0}
      timeout={TOOLTIP_SKIP_MS}
      {...props}
    />
  );
}

// ── The trigger-based primitive ──────────────────────────────────────────────────────────────

interface TooltipProps {
  // The tooltip content (usually a short string; a node for the rare rich label).
  label: React.ReactNode;
  // The single trigger element — Base UI's `render` merges the trigger's props/ref onto it, so no
  // wrapper element is added (must be a DOM-prop-accepting element).
  children: React.ReactElement;
  side?: Base.Positioner.Props["side"];
  sideOffset?: number;
  // Start open (uncontrolled) — mainly for demoing the surface without a hover.
  defaultOpen?: boolean;
}

function Tooltip({
  label,
  children,
  side = "top",
  sideOffset = TOOLTIP_GUTTER_PX,
  defaultOpen,
}: TooltipProps): React.ReactElement {
  return (
    <Base.Root defaultOpen={defaultOpen}>
      <Base.Trigger render={children} />
      <Base.Portal>
        <Base.Positioner side={side} sideOffset={sideOffset} {...stylex.props(sx.positioner)}>
          <Base.Popup {...stylex.props(sx.popup)}>{label}</Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}

// ── The controlled, triggerless shape (for delegated hosts like the tab strip) ──────────────
// The host owns the open state, the delay, and the anchor (a function returning the hovered
// element's rect on demand). Base UI still portals + positions + animates; our code only flips
// `open` inside event handlers — zero useEffect on our side.

type TooltipAnchor = Base.Positioner.Props["anchor"];

interface AnchoredTooltipProps {
  open: boolean;
  // Base UI's own close intents (Escape, anchor hidden) flow back here so the host can clear.
  onOpenChange?: (open: boolean) => void;
  // A function anchor `() => el` is preferred over a bare element: Base UI observes the returned
  // element for size/position so the popup tracks it, and one stable function covers every
  // hovered target (GPT-5.5 consult) — the host swaps the ref, not the prop.
  anchor: TooltipAnchor;
  children: React.ReactNode;
  side?: Base.Positioner.Props["side"];
  align?: Base.Positioner.Props["align"];
  sideOffset?: number;
}

function AnchoredTooltip({
  open,
  onOpenChange,
  anchor,
  children,
  side = "bottom",
  align = "start",
  sideOffset = TOOLTIP_GUTTER_PX,
}: AnchoredTooltipProps): React.ReactElement {
  return (
    <Base.Root open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      <Base.Portal>
        <Base.Positioner
          anchor={anchor}
          side={side}
          align={align}
          sideOffset={sideOffset}
          // fixed positioning: the anchor lives in the titlebar, which the window can't scroll,
          // and fixed keeps the popup glued through any ancestor transform.
          positionMethod="fixed"
          {...stylex.props(sx.positioner)}
        >
          <Base.Popup {...stylex.props(sx.popup)}>{children}</Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}

export { AnchoredTooltip, Tooltip, TooltipProvider, tooltipPopupStyles };
export type { AnchoredTooltipProps, TooltipAnchor, TooltipProps };
