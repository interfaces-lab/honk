// The menu — honk's dropdown menu (a button opens a floating list of actions), built on Base UI's
// Menu. The whole concept in one file (ADR 0011: one concept per file).
//
// WHY BASE UI (round-8 doctrine): the design system adopts Base UI and ports its primitives into
// @honk/ui. Menu gives us the composite-widget keyboard model for free — roving focus, type-ahead,
// Escape/outside-press dismissal, and the [data-highlighted] active-row attr — none of which a
// hand-rolled list would get right. ADR 0025 bans useEffect in OUR code, not a library's internals:
// Base UI owns the portal + positioning + focus effects, so this file stays a set of stateless
// styled wrappers. The Root's open state is Base UI's (uncontrolled via defaultOpen, or controlled
// by the app) — we add none.
//
// THE OVERLAY SURFACE (shared with tooltip.tsx VERBATIM): the Popup reads the SAME token bus as the
// tooltip — bg-base fill, floating elevation, text-primary ink, ui font, the on-self scale-fade
// keyed on Base UI's [data-starting-style]/[data-ending-style] — so every overlay in the system
// repaints together when a --honk-* var is dialed. Two deliberate departures from the tooltip: the
// corner is the WINDOW radius (a menu is a window-tier surface, not a control-tier hint), and the
// popup EATS the pointer (its rows are clickable) instead of the tooltip's pointer-events:none.
//
// THE STYLING SPLIT (round-8 doctrine): a primitive is Base UI + StyleX only — no Tailwind, no
// className/style in public props. StyleX owns the whole surface reading the token bus; the app
// nudges one instance with `xstyle` (a StyleX override, footgun-free), and className/style are
// Omitted from every part's props. The Positioner carries ONLY the overlay's stacking (an overlay's
// z-index is a primitive internal, tooltip.tsx idiom); the Popup carries the surface.
//
// COMPOUND SHAPE (like Shell): `Menu = { Root, Trigger, Popup, Item, Separator, Group, GroupLabel }`.
// Our Menu.Popup folds Base UI's Portal + Positioner inside itself (mirroring how <Tooltip> hides
// them), so the app writes one `<Menu.Popup>` instead of the raw four-level nest. The Trigger stays
// separate — the app anchors its own <Button> onto it via `render`. Nested selectors use the same
// row and popup vocabulary through SubmenuRoot/SubmenuTrigger/SubmenuPopup. CheckboxItem,
// RadioItem/RadioGroup, and long-menu Viewport scrolling remain deferred.
//
// TOKEN GROUPS: color (surface, ink, the highlight wash, the hairline ring), elevation (floating),
// radius (window + control), font (ui family + the chrome size ramp), motion (the scale-fade +
// highlight tiers, each with its reduced-motion sibling), space (the popup's block padding),
// control (the row's height/pad/gap — a menu row snaps to the shared control scale), z (the menu
// tier of the overlay stack).

import { Menu as Base } from "@base-ui/react/menu";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import {
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
  zVars,
} from "./tokens.stylex";

// ── Surface + row anatomy (named intrinsics — menu geometry, not shared design vocabulary) ──────
// The no-raw-values anatomy exception (tooltip.tsx's TOOLTIP_MAX_WIDTH precedent): module-level, so
// the create-scoped lint never sees the px; any color inside such a const is still a token.
// A menu wants a comfortable minimum so short actions don't collapse to a sliver, and a cap so a
// runaway label wraps instead of stretching the window.
const MENU_MIN_WIDTH = "200px";
const MENU_MAX_WIDTH = "320px";
// The separator rule's thickness — one device pixel (the separator.tsx HAIRLINE idiom).
const HAIRLINE = "1px";
// The menu's fine vertical grain: the sliver that frames a separator off its neighbor rows and
// breathes a group label away from its items. One value, so the menu's internal rhythm is uniform.
const MENU_FINE_GAP = "4px";
// Gap between the trigger and the popup (a number — Base UI's sideOffset takes px). A dropdown sits
// snug under its trigger, tighter than the tooltip's 6px hint gutter.
const MENU_GUTTER_PX = 4;
// Nested menus touch the parent row, preserving the hover bridge from the shipped selector.
const SUBMENU_GUTTER_PX = 0;
const SUBMENU_ALIGN_OFFSET_PX = -4;

// A hairline definition ring drawn as an INSET shadow (never a real border, so it adds no layout
// box) — the button.tsx idiom. Composed into the elevation shadow below so the menu edge reads
// crisp against a same-tone surface. The geometry is literal; the COLOR is a token.
const RING_MUTED = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;

const sx = stylex.create({
  // The Positioner carries ONLY the overlay's stacking — an overlay's z-index is a PRIMITIVE
  // internal (its slot in the overlay stack), so it lives in StyleX reading the z token, never a
  // Tailwind utility (tooltip.tsx sx.positioner). Nothing else belongs here.
  positioner: {
    zIndex: zVars["--honk-z-menu"],
  },
  // The Popup surface — the tooltip's exact token set (so overlays repaint together), at the
  // window radius, plus the hairline ring composed into the floating elevation.
  popup: {
    minWidth: MENU_MIN_WIDTH,
    maxWidth: MENU_MAX_WIDTH,
    // Block padding frames the row list off the rounded top/bottom corners; the inline axis is
    // deliberately flush — rows are full-bleed and carry their own inline padding, so a highlighted
    // row reads as a clean edge-to-edge bar and the separator spans the full width with no negative
    // margin math (honkkit's approach, simplified by dropping the inner-padding it has to bleed past).
    paddingBlock: spaceVars["--honk-space-gutter"],
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `${elevationVars["--honk-elevation-floating"]}, ${RING_MUTED}`,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    // The popup takes keyboard focus for roving item navigation; the highlighted row is the visible
    // focus indicator, so the container's own browser focus ring is suppressed (honkkit menu surface).
    outline: "none",
    // Base UI emits --transform-origin on the popup (the corner it grew from); read it in place (a
    // library var, not a --honk token). Enter/exit scale-fade is COPIED from tooltip.tsx sx.popup:
    // hidden + scaled at the start/end frames, full at rest, driven by Base UI's on-self data-attrs.
    // Reduced motion pins scale 1 and zeroes the duration below (every animated call site carries
    // its own r-m sibling). UNLIKE the tooltip, this popup keeps pointerEvents at the default `auto`
    // — its rows are interactive, so there is no pointer-events:none here.
    transformOrigin: "var(--transform-origin)",
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
      "[data-instant]": "0s", // Base UI's jitter-free reposition / same-menu transitions: no animation
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  // A menu row: a flex line snapped to the shared control scale (the same height/pad/gap a Button
  // reads), so a menu row and a small button are the same size across the system. The HIGHLIGHTED
  // state is Base UI's [data-highlighted] — the keyboard/pointer active row (verified against the
  // installed MenuItemDataAttributes enum), NOT :focus. [data-disabled] dims + drops the pointer.
  item: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    boxSizing: "border-box",
    height: controlVars["--honk-control-h-md"],
    paddingInline: controlVars["--honk-control-pad-md"],
    borderRadius: radiusVars["--honk-radius-control"],
    color: colorVars["--honk-color-text-primary"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: 1, // tight box; the fixed height + center-alignment place the label, not leading
    userSelect: "none",
    // No per-row focus outline — the highlight fill IS the focus indicator (composite-widget model).
    outline: "none",
    cursor: { default: "pointer", "[data-disabled]": "default" },
    // The highlight is a translucent interaction WASH (state-hover), not a step up the layer ladder:
    // a row highlight is a transient pointer/keyboard state (kin to hover/press), and a wash reads
    // consistently on the floating bg-base surface where the subtle opaque layer-01 step would all
    // but vanish in the light arm. The task sanctions this token for the row highlight.
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": colorVars["--honk-color-state-hover"],
    },
    opacity: { default: 1, "[data-disabled]": 0.4 },
    // Highlight fades on the hover tier, with its own reduced-motion off-switch (Law 8).
    transitionProperty: "background-color, opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  submenuTrigger: {
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": colorVars["--honk-color-state-hover"],
      "[data-popup-open]": colorVars["--honk-color-state-hover"],
    },
  },
  // A section label above a group's rows — a quiet muted caption, inline-aligned with the row labels
  // (same control inline padding), a sliver of block air separating it from its items.
  groupLabel: {
    paddingInline: controlVars["--honk-control-pad-md"],
    paddingBlock: MENU_FINE_GAP,
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontWeight: fontVars["--honk-font-weight-medium"],
    userSelect: "none",
  },
  // The in-menu divider — the separator.tsx horizontal look (a 1px BACKGROUND fill, border-muted,
  // full width — one honest line that never shifts layout), framed off its neighbor rows by the
  // menu's fine gap. Full-bleed because the popup has no inline padding for it to bleed past.
  separator: {
    height: HAIRLINE,
    marginBlock: MENU_FINE_GAP,
    backgroundColor: colorVars["--honk-color-border-muted"],
  },
});

// ── Popup (our wrapper folds Portal + Positioner, like tooltip.tsx hides them) ──────────────────
// The app writes `<Menu.Popup>…rows…</Menu.Popup>` and we expand it to Portal > Positioner > Popup.
// side/align/sideOffset drive the Positioner (a dropdown defaults to below-start of the trigger);
// the rest of Base UI's Popup props (finalFocus, id, …) ride `...rest` onto Base.Popup.
interface MenuPopupProps extends Omit<Base.Popup.Props, "className" | "style"> {
  // Which side of the trigger the menu opens on, and how it aligns along that side. Base UI
  // auto-flips/shifts when a side has no room. Defaults: below the trigger, start-aligned.
  side?: Base.Positioner.Props["side"];
  align?: Base.Positioner.Props["align"];
  // Gap between the trigger and the popup, in px.
  sideOffset?: number;
  alignOffset?: Base.Positioner.Props["alignOffset"];
  // StyleX escape hatch for the app to nudge one instance without the StyleX-vs-Tailwind footgun.
  xstyle?: stylex.StyleXStyles;
}

function MenuPopup({
  side = "bottom",
  align = "start",
  sideOffset = MENU_GUTTER_PX,
  alignOffset,
  xstyle,
  children,
  ...rest
}: MenuPopupProps): React.ReactElement {
  return (
    <Base.Portal>
      <Base.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        {...stylex.props(sx.positioner)}
      >
        <Base.Popup {...rest} data-slot="menu" {...stylex.props(sx.popup, xstyle)}>
          {children}
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}

// ── Item ────────────────────────────────────────────────────────────────────────────────────────
// A clickable row. onClick, disabled, closeOnClick, keyboard label, ref, and Base UI's data-attrs
// all ride `...rest`. The app fills it with content (an <Icon> + label, a trailing <Kbd>) — the
// flex row + control gap lay them out, no wrapper.
interface MenuItemProps extends Omit<Base.Item.Props, "className" | "style"> {
  xstyle?: stylex.StyleXStyles;
}

function MenuItem({ xstyle, ...rest }: MenuItemProps): React.ReactElement {
  return <Base.Item {...rest} data-slot="menu-item" {...stylex.props(sx.item, xstyle)} />;
}

// ── Submenu ────────────────────────────────────────────────────────────────────────────────────
// Base UI owns the hover delay, safe polygon, nested focus, and arrow-key handoff. The trigger
// keeps the same row anatomy as a normal item and adds a persistent highlight while its popup is open.
interface MenuSubmenuTriggerProps extends Omit<Base.SubmenuTrigger.Props, "className" | "style"> {
  xstyle?: stylex.StyleXStyles;
}

function MenuSubmenuTrigger({ xstyle, ...rest }: MenuSubmenuTriggerProps): React.ReactElement {
  return (
    <Base.SubmenuTrigger
      {...rest}
      data-slot="menu-submenu-trigger"
      {...stylex.props(sx.item, sx.submenuTrigger, xstyle)}
    />
  );
}

type MenuSubmenuPopupProps = MenuPopupProps;

function MenuSubmenuPopup(props: MenuSubmenuPopupProps): React.ReactElement {
  return (
    <MenuPopup
      side="inline-end"
      align="start"
      sideOffset={SUBMENU_GUTTER_PX}
      alignOffset={SUBMENU_ALIGN_OFFSET_PX}
      {...props}
    />
  );
}

// ── Separator ────────────────────────────────────────────────────────────────────────────────────
// Base UI's menu Separator IS the shared Separator (role="separator") — we give it the honk hairline
// look. A divider never animates, so (like separator.tsx) there is deliberately no motion here.
interface MenuSeparatorProps extends Omit<Base.Separator.Props, "className" | "style"> {
  xstyle?: stylex.StyleXStyles;
}

function MenuSeparator({ xstyle, ...rest }: MenuSeparatorProps): React.ReactElement {
  return (
    <Base.Separator {...rest} data-slot="menu-separator" {...stylex.props(sx.separator, xstyle)} />
  );
}

// ── GroupLabel ────────────────────────────────────────────────────────────────────────────────────
// The accessible label Base UI auto-associates with its parent Menu.Group (aria-labelledby). Styled
// as the quiet section caption above the group's rows.
interface MenuGroupLabelProps extends Omit<Base.GroupLabel.Props, "className" | "style"> {
  xstyle?: stylex.StyleXStyles;
}

function MenuGroupLabel({ xstyle, ...rest }: MenuGroupLabelProps): React.ReactElement {
  return (
    <Base.GroupLabel
      {...rest}
      data-slot="menu-group-label"
      {...stylex.props(sx.groupLabel, xstyle)}
    />
  );
}

// ── Compound namespace ──────────────────────────────────────────────────────────────────────────
// Root / Trigger / Group need no styling — Root renders no element (it wires open state), Trigger is
// the app's own <Button> merged on via `render`, and Group is a semantic role="group" wrapper — so
// they are thin re-exports of the Base UI parts (the sanctioned "re-export where no styling is
// needed" shape). Popup / Item / Separator / GroupLabel are our styled wrappers above.
const Menu = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Popup: MenuPopup,
  Item: MenuItem,
  Separator: MenuSeparator,
  Group: Base.Group,
  GroupLabel: MenuGroupLabel,
  SubmenuRoot: Base.SubmenuRoot,
  SubmenuTrigger: MenuSubmenuTrigger,
  SubmenuPopup: MenuSubmenuPopup,
};

export { Menu };
export type {
  MenuGroupLabelProps,
  MenuItemProps,
  MenuPopupProps,
  MenuSeparatorProps,
  MenuSubmenuPopupProps,
  MenuSubmenuTriggerProps,
};
