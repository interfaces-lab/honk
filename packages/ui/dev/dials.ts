// The dialkit → StyleX token bridge. dialkit draws the knobs; this module rewrites the
// PUBLISHED --honk-* custom properties on <html> so every token consumer (shell, tabs, glyph)
// re-skins live with zero React involvement — inline styles on the root element beat the
// stylesheet defaults that @stylexjs/unplugin emits for defineVars.
//
// SHAPE: a CATALOG of per-component panels, not one global panel. Each story in dev/main.tsx
// mounts its own panel (ShellDials inside ShellStory, …), so the dial rail always shows controls
// for the component on screen, and each panel dials ONLY tokens its component actually reads.
// The always-on Theme panel (appearance + accent) stays mounted in RootLayout.
//
// Doctrine split (ADR 0025, zero useEffect in OUR code):
//   • The mount components below exist ONLY to register a panel with dialkit from inside React —
//     useDialKit is how a panel appears under <DialRoot/>, and its return value is discarded.
//   • The APPLICATION happens outside React: module-level DialStore subscriptions call the
//     appliers, which write document.documentElement.style. No component re-renders when a
//     slider moves — the CSS vars change and the paint follows.
//
// PERSISTENCE SEMANTICS (honest statement): applied values are sticky. When a story (and its
// panel) unmounts, the inline --honk-* styles it wrote STAY on <html> — switching stories must
// not reset tokens you just tuned. Nothing re-applies at page load, though: after a refresh the
// inline styles are gone, and a panel's persisted values (persist:true → localStorage) come back
// only when its story first mounts and the panel re-registers, which notifies the global feed
// and runs that panel's applier.
//
// DialStore is imported from the MAIN 'dialkit' entry on purpose: the 'dialkit/store' subpath
// bundles its own copy of the singleton, and useDialKit registers panels into the main entry's
// instance — mixing the two would subscribe to an empty store.

import { DialStore, useDialKit } from "dialkit";
import type { DialConfig } from "dialkit";
import { createElement, Fragment, useSyncExternalStore } from "react";
import type { ReactElement } from "react";

import {
  colorVars,
  controlVars,
  conversationVars,
  fontVars,
  iconVars,
  motionVars,
  proseVars,
  radiusVars,
  shellVars,
  spaceVars,
  toastVars,
  zVars,
} from "../src/tokens.stylex";

// StyleX compiles defineVars into { '--honk-space-gutter': 'var(--honk-space-gutter)', … } —
// the runtime value is the var() REFERENCE (literal '--' keys pass through unhashed). Unwrap
// it back to the property name setProperty needs, instead of hardcoding names that could
// drift from tokens.stylex.ts.
function cssVarName(reference: unknown): string {
  const match = /^var\((--[^),\s]+)/.exec(String(reference));
  if (match?.[1] === undefined) {
    throw new Error(`dials: not a StyleX var reference: ${String(reference)}`);
  }
  return match[1];
}

// ── The panel catalog ────────────────────────────────────────────────────────────────────────
// One spec per panel: a stable id (shared across remounts — StrictMode double-mounts included —
// and the localStorage persistence key `dialkit:<id>`), a display name for the rail, the dialkit
// config, and per-dial bindings onto CSS custom properties. Binding keys mirror config keys
// (an unbound key like Theme's `appearance` is applied by hand in applyPanelValues). Iterating
// a spec's bindings (not the store's values) is also what skips dialkit's internal '*.__mode'
// bookkeeping keys for free.
//
// Dial numbers are unitless — the BINDING owns units: a number with no `format` applies as
// `${value}px`; `format` handles everything else (ms durations, the conversation fg ramp where
// a % slider emits a color-mix over the fg base). String dials (hex colors) apply verbatim.
//
// Dial defaults mirror the current token values in tokens.stylex.ts (dark-arm accent), and the
// applier SKIPS values still sitting at their config default — so an untouched dial literally
// pins nothing and the stylesheet token (including both arms of a light-dark() pair) stays in
// charge. This matters most for color dials: applying the accent default would flatten
// light-dark(#3685bf, #599ce7) to one hex in both schemes. Dialing back exactly to the default
// un-pins (the token value shows again) — the honest reading of "default".
// [default, min, max, step] tuples per the dialkit README.

interface DialBinding {
  cssVar: string;
  format?: (value: number) => string;
}

interface PanelSpec {
  id: string;
  name: string;
  config: DialConfig;
  bindings: Record<string, DialBinding>;
}

// A % slider over the conversation fg ramp: tokens.stylex.ts derives fg-secondary/-tertiary as
// %-mixes of the ONE fg base, and the dial re-emits that exact derivation at the dialed %.
function fgMixPercent(value: number): string {
  return `color-mix(in srgb, ${String(colorVars["--honk-color-fg"])} ${value}%, transparent)`;
}

function milliseconds(value: number): string {
  return `${value}ms`;
}

// A raw number, no unit — for font weights, the overlay scale endpoint, and z-index (all consumed
// bare, not as px).
function unitless(value: number): string {
  return String(value);
}

// Theme — global, mounted in RootLayout, never unmounts. `appearance` drives color-scheme (no
// cssVar binding; see applyPanelValues); dialing `accent` pins ONE hex over the light-dark()
// pair — fine for a tweaking session.
const THEME_PANEL_ID = "theme";

const themePanel: PanelSpec = {
  id: THEME_PANEL_ID,
  name: "Theme",
  config: {
    appearance: { type: "select", options: ["system", "light", "dark"] },
    accent: "#599ce7",
  },
  bindings: {
    accent: { cssVar: cssVarName(colorVars["--honk-color-accent"]) },
  },
};

// Shell — the frame geometry the Shell story's miniatures read.
const shellPanel: PanelSpec = {
  id: "shell",
  name: "Shell",
  config: {
    gutter: [8, 0, 24, 1],
    panelPad: [12, 0, 32, 1],
    panelRadius: [10, 0, 24, 1],
    windowRadius: [12, 0, 24, 1],
    titlebarH: [34, 24, 56, 1],
  },
  bindings: {
    gutter: { cssVar: cssVarName(spaceVars["--honk-space-gutter"]) },
    panelPad: { cssVar: cssVarName(spaceVars["--honk-space-panel-pad"]) },
    panelRadius: { cssVar: cssVarName(radiusVars["--honk-radius-panel"]) },
    windowRadius: { cssVar: cssVarName(radiusVars["--honk-radius-window"]) },
    titlebarH: { cssVar: cssVarName(shellVars["--honk-shell-titlebar-h"]) },
  },
};

// Tabs — the strip's control geometry.
const tabsPanel: PanelSpec = {
  id: "tabs",
  name: "Tabs",
  config: {
    tabH: [28, 20, 44, 1],
    tabMaxW: [224, 120, 320, 4],
    tabGap: [13.5, 4, 24, 0.5],
    controlRadius: [6, 0, 16, 1],
  },
  bindings: {
    tabH: { cssVar: cssVarName(shellVars["--honk-shell-tab-h"]) },
    tabMaxW: { cssVar: cssVarName(shellVars["--honk-shell-tab-max-w"]) },
    tabGap: { cssVar: cssVarName(shellVars["--honk-shell-tab-gap"]) },
    controlRadius: { cssVar: cssVarName(radiusVars["--honk-radius-control"]) },
  },
};

// Text — the whole prose ramp, each size paired with its leading (ramp order: caption → detail
// → body → title → heading, matching the Text story's spec sheet).
const textPanel: PanelSpec = {
  id: "text",
  name: "Text",
  config: {
    caption: [10, 8, 14, 0.5],
    leadingCaption: [12, 8, 18, 1],
    detail: [11, 9, 15, 0.5],
    leadingDetail: [14, 10, 20, 1],
    body: [12, 10, 16, 0.5],
    leadingBody: [16, 12, 24, 1],
    title: [13, 11, 18, 0.5],
    leadingTitle: [18, 14, 26, 1],
    heading: [16, 12, 24, 0.5],
    leadingHeading: [21, 16, 32, 1],
  },
  bindings: {
    caption: { cssVar: cssVarName(fontVars["--honk-text-caption"]) },
    leadingCaption: { cssVar: cssVarName(fontVars["--honk-leading-caption"]) },
    detail: { cssVar: cssVarName(fontVars["--honk-text-detail"]) },
    leadingDetail: { cssVar: cssVarName(fontVars["--honk-leading-detail"]) },
    body: { cssVar: cssVarName(fontVars["--honk-text-body"]) },
    leadingBody: { cssVar: cssVarName(fontVars["--honk-leading-body"]) },
    title: { cssVar: cssVarName(fontVars["--honk-text-title"]) },
    leadingTitle: { cssVar: cssVarName(fontVars["--honk-leading-title"]) },
    heading: { cssVar: cssVarName(fontVars["--honk-text-heading"]) },
    leadingHeading: { cssVar: cssVarName(fontVars["--honk-leading-heading"]) },
  },
};

// Prose — the assistant reading role. The fixed pixel measure keeps headings and body copy aligned
// even though their font sizes differ; at the default face and size, 600px is roughly 68 characters.
const prosePanel: PanelSpec = {
  id: "prose",
  name: "Prose",
  config: {
    measure: [600, 440, 760, 20],
    size: [14, 12, 18, 0.5],
    leading: [22, 16, 30, 1],
    flowGap: [12, 4, 24, 1],
    sectionGap: [24, 12, 48, 1],
  },
  bindings: {
    measure: { cssVar: cssVarName(proseVars["--honk-prose-measure"]) },
    size: { cssVar: cssVarName(proseVars["--honk-prose-size"]) },
    leading: { cssVar: cssVarName(proseVars["--honk-prose-leading"]) },
    flowGap: { cssVar: cssVarName(proseVars["--honk-prose-flow-gap"]) },
    sectionGap: { cssVar: cssVarName(proseVars["--honk-prose-section-gap"]) },
  },
};

// Icon — the five glyph-box steps of the <Icon> size ramp.
const iconPanel: PanelSpec = {
  id: "icon",
  name: "Icon",
  config: {
    xs: [12, 8, 16, 1],
    sm: [14, 10, 18, 1],
    md: [16, 12, 22, 1],
    lg: [18, 14, 24, 1],
    xl: [20, 16, 28, 1],
  },
  bindings: {
    xs: { cssVar: cssVarName(iconVars["--honk-icon-size-xs"]) },
    sm: { cssVar: cssVarName(iconVars["--honk-icon-size-sm"]) },
    md: { cssVar: cssVarName(iconVars["--honk-icon-size-md"]) },
    lg: { cssVar: cssVarName(iconVars["--honk-icon-size-lg"]) },
    xl: { cssVar: cssVarName(iconVars["--honk-icon-size-xl"]) },
  },
};

// Conversation — row geometry, the bubble radius, the fg ramp's two %-mix steps (74/54 of the
// fg base, per tokens.stylex.ts), and the shimmer pass duration.
const conversationPanel: PanelSpec = {
  id: "conversation",
  name: "Conversation",
  config: {
    inset: [11, 0, 24, 1],
    rowMinH: [24, 16, 40, 1],
    rowGap: [4, 0, 12, 1],
    stepGap: [6, 0, 16, 1],
    bubbleRadius: [12, 0, 24, 1],
    fgSecondary: [74, 20, 100, 1],
    fgTertiary: [54, 20, 100, 1],
    shimmerMs: [2000, 500, 5000, 100],
  },
  bindings: {
    inset: { cssVar: cssVarName(conversationVars["--honk-conversation-inset"]) },
    rowMinH: { cssVar: cssVarName(conversationVars["--honk-conversation-row-min-h"]) },
    rowGap: { cssVar: cssVarName(conversationVars["--honk-conversation-row-gap"]) },
    stepGap: { cssVar: cssVarName(conversationVars["--honk-conversation-step-gap"]) },
    bubbleRadius: { cssVar: cssVarName(radiusVars["--honk-radius-bubble"]) },
    fgSecondary: {
      cssVar: cssVarName(colorVars["--honk-color-fg-secondary"]),
      format: fgMixPercent,
    },
    fgTertiary: {
      cssVar: cssVarName(colorVars["--honk-color-fg-tertiary"]),
      format: fgMixPercent,
    },
    shimmerMs: {
      cssVar: cssVarName(motionVars["--honk-motion-duration-shimmer"]),
      format: milliseconds,
    },
  },
};

// Toast — the friendly top-center pill's geometry and two-line type.
const toastPanel: PanelSpec = {
  id: "toast",
  name: "Toast",
  config: {
    offset: [18, 0, 48, 1],
    radius: [18, 0, 32, 1],
    paddingBlock: [12, 0, 24, 1],
    paddingInline: [16, 0, 32, 1],
    contentGap: [3, 0, 12, 1],
    itemGap: [12, 0, 24, 1],
    iconSize: [32, 16, 48, 1],
    borderWidth: [1, 0, 4, 0.5],
    title: [14, 10, 20, 0.5],
    titleLeading: [18, 12, 28, 1],
    description: [13, 9, 18, 0.5],
    descriptionLeading: [17, 12, 26, 1],
    closeSize: [22, 16, 32, 1],
  },
  bindings: {
    offset: { cssVar: cssVarName(toastVars["--honk-toast-offset"]) },
    radius: { cssVar: cssVarName(toastVars["--honk-toast-radius"]) },
    paddingBlock: { cssVar: cssVarName(toastVars["--honk-toast-padding-block"]) },
    paddingInline: { cssVar: cssVarName(toastVars["--honk-toast-padding-inline"]) },
    contentGap: { cssVar: cssVarName(toastVars["--honk-toast-content-gap"]) },
    itemGap: { cssVar: cssVarName(toastVars["--honk-toast-item-gap"]) },
    iconSize: { cssVar: cssVarName(toastVars["--honk-toast-icon-size"]) },
    borderWidth: { cssVar: cssVarName(toastVars["--honk-toast-border-width"]) },
    title: { cssVar: cssVarName(toastVars["--honk-toast-title-size"]) },
    titleLeading: { cssVar: cssVarName(toastVars["--honk-toast-title-leading"]) },
    description: { cssVar: cssVarName(toastVars["--honk-toast-description-size"]) },
    descriptionLeading: {
      cssVar: cssVarName(toastVars["--honk-toast-description-leading"]),
    },
    closeSize: { cssVar: cssVarName(toastVars["--honk-toast-close-size"]) },
  },
};

// Matrix has NO panel, deliberately: the glyph is sacred geometry — 2px dots on 4px cells with
// the 1.2s diagonal sweep (matrix.tsx header) — and geometry that never drifts gets no dials.

// ── The Design System master page (ds-*) ─────────────────────────────────────────────────────
// One panel per token GROUP, together dialing every NUMERIC token in tokens.stylex.ts exactly
// once. These are the "adjust every value in one place" surface, mounted ONLY on the /design route
// — deliberately SEPARATE from the per-story panels above. A var like radius-control has a knob
// here AND on the Tabs story, but the two routes never co-mount, so no two knobs fight for one
// --honk-* property. (One documented caveat: leaving /design for a component story re-applies that
// story's own defaults for any shared var — /design is the tune-and-export surface, so tune here,
// hit a panel's Copy to emit the JSON, then paste the values into tokens.stylex.ts.) Colors land
// in a follow-up pass: light-dark() pairs need per-arm knobs, unlike these single-value numbers.

const dsRadiusPanel: PanelSpec = {
  id: "ds-radius",
  name: "Radius",
  config: {
    panel: [10, 0, 24, 1],
    window: [12, 0, 24, 1],
    control: [6, 0, 16, 1],
    field: [8, 0, 20, 1],
    bubble: [12, 0, 24, 1],
  },
  bindings: {
    panel: { cssVar: cssVarName(radiusVars["--honk-radius-panel"]) },
    window: { cssVar: cssVarName(radiusVars["--honk-radius-window"]) },
    control: { cssVar: cssVarName(radiusVars["--honk-radius-control"]) },
    field: { cssVar: cssVarName(radiusVars["--honk-radius-field"]) },
    bubble: { cssVar: cssVarName(radiusVars["--honk-radius-bubble"]) },
  },
};

const dsSpacePanel: PanelSpec = {
  id: "ds-space",
  name: "Space",
  config: {
    gutter: [8, 0, 24, 1],
    panelPad: [12, 0, 32, 1],
    controlPadX: [10, 0, 24, 1],
  },
  bindings: {
    gutter: { cssVar: cssVarName(spaceVars["--honk-space-gutter"]) },
    panelPad: { cssVar: cssVarName(spaceVars["--honk-space-panel-pad"]) },
    controlPadX: { cssVar: cssVarName(spaceVars["--honk-space-control-pad-x"]) },
  },
};

const dsControlPanel: PanelSpec = {
  id: "ds-control",
  name: "Control",
  config: {
    hSm: [24, 16, 40, 1],
    hMd: [28, 20, 44, 1],
    hLg: [32, 24, 52, 1],
    padSm: [8, 0, 20, 1],
    padMd: [10, 0, 24, 1],
    padLg: [12, 0, 28, 1],
    gap: [6, 0, 16, 1],
  },
  bindings: {
    hSm: { cssVar: cssVarName(controlVars["--honk-control-h-sm"]) },
    hMd: { cssVar: cssVarName(controlVars["--honk-control-h-md"]) },
    hLg: { cssVar: cssVarName(controlVars["--honk-control-h-lg"]) },
    padSm: { cssVar: cssVarName(controlVars["--honk-control-pad-sm"]) },
    padMd: { cssVar: cssVarName(controlVars["--honk-control-pad-md"]) },
    padLg: { cssVar: cssVarName(controlVars["--honk-control-pad-lg"]) },
    gap: { cssVar: cssVarName(controlVars["--honk-control-gap"]) },
  },
};

// The prose ramp (each size paired with its leading) — matches textPanel but self-contained.
const dsProsePanel: PanelSpec = {
  id: "ds-prose",
  name: "Prose type",
  config: {
    caption: [10, 8, 14, 0.5],
    leadingCaption: [12, 8, 18, 1],
    detail: [11, 9, 15, 0.5],
    leadingDetail: [14, 10, 20, 1],
    body: [12, 10, 16, 0.5],
    leadingBody: [16, 12, 24, 1],
    title: [13, 11, 18, 0.5],
    leadingTitle: [18, 14, 26, 1],
    heading: [16, 12, 24, 0.5],
    leadingHeading: [21, 16, 32, 1],
  },
  bindings: {
    caption: { cssVar: cssVarName(fontVars["--honk-text-caption"]) },
    leadingCaption: { cssVar: cssVarName(fontVars["--honk-leading-caption"]) },
    detail: { cssVar: cssVarName(fontVars["--honk-text-detail"]) },
    leadingDetail: { cssVar: cssVarName(fontVars["--honk-leading-detail"]) },
    body: { cssVar: cssVarName(fontVars["--honk-text-body"]) },
    leadingBody: { cssVar: cssVarName(fontVars["--honk-leading-body"]) },
    title: { cssVar: cssVarName(fontVars["--honk-text-title"]) },
    leadingTitle: { cssVar: cssVarName(fontVars["--honk-leading-title"]) },
    heading: { cssVar: cssVarName(fontVars["--honk-text-heading"]) },
    leadingHeading: { cssVar: cssVarName(fontVars["--honk-leading-heading"]) },
  },
};

// The fixed chrome size ramp + the three UI weights (weights are unitless numbers).
const dsChromePanel: PanelSpec = {
  id: "ds-chrome",
  name: "Chrome & weight",
  config: {
    chromeBody: [13, 10, 18, 0.5],
    chromeDetail: [12, 9, 16, 0.5],
    chromeCaption: [11, 8, 15, 0.5],
    chromeMicro: [10, 8, 14, 0.5],
    weightRegular: [400, 100, 900, 10],
    weightMedium: [510, 100, 900, 10],
    weightSemibold: [590, 100, 900, 10],
  },
  bindings: {
    chromeBody: { cssVar: cssVarName(fontVars["--honk-font-size-body"]) },
    chromeDetail: { cssVar: cssVarName(fontVars["--honk-font-size-detail"]) },
    chromeCaption: { cssVar: cssVarName(fontVars["--honk-font-size-caption"]) },
    chromeMicro: { cssVar: cssVarName(fontVars["--honk-font-size-micro"]) },
    weightRegular: { cssVar: cssVarName(fontVars["--honk-font-weight-regular"]), format: unitless },
    weightMedium: { cssVar: cssVarName(fontVars["--honk-font-weight-medium"]), format: unitless },
    weightSemibold: {
      cssVar: cssVarName(fontVars["--honk-font-weight-semibold"]),
      format: unitless,
    },
  },
};

const dsIconPanel: PanelSpec = {
  id: "ds-icon",
  name: "Icon",
  config: {
    xs: [12, 8, 16, 1],
    sm: [14, 10, 18, 1],
    md: [16, 12, 22, 1],
    lg: [18, 14, 24, 1],
    xl: [20, 16, 28, 1],
  },
  bindings: {
    xs: { cssVar: cssVarName(iconVars["--honk-icon-size-xs"]) },
    sm: { cssVar: cssVarName(iconVars["--honk-icon-size-sm"]) },
    md: { cssVar: cssVarName(iconVars["--honk-icon-size-md"]) },
    lg: { cssVar: cssVarName(iconVars["--honk-icon-size-lg"]) },
    xl: { cssVar: cssVarName(iconVars["--honk-icon-size-xl"]) },
  },
};

// Durations in ms; the overlay scale endpoint is unitless (it lives inside scale()).
const dsMotionPanel: PanelSpec = {
  id: "ds-motion",
  name: "Motion",
  config: {
    instant: [80, 0, 400, 10],
    hover: [100, 0, 400, 10],
    fast: [120, 0, 400, 10],
    base: [150, 0, 600, 10],
    expand: [200, 0, 800, 10],
    collapsible: [100, 0, 400, 10],
    shimmer: [2000, 500, 5000, 100],
    spinner: [900, 300, 2000, 50],
    scaleOverlay: [0.98, 0.8, 1, 0.01],
  },
  bindings: {
    instant: {
      cssVar: cssVarName(motionVars["--honk-motion-duration-instant"]),
      format: milliseconds,
    },
    hover: { cssVar: cssVarName(motionVars["--honk-motion-duration-hover"]), format: milliseconds },
    fast: { cssVar: cssVarName(motionVars["--honk-motion-duration-fast"]), format: milliseconds },
    base: { cssVar: cssVarName(motionVars["--honk-motion-duration-base"]), format: milliseconds },
    expand: {
      cssVar: cssVarName(motionVars["--honk-motion-duration-expand"]),
      format: milliseconds,
    },
    collapsible: {
      cssVar: cssVarName(motionVars["--honk-motion-duration-collapsible"]),
      format: milliseconds,
    },
    shimmer: {
      cssVar: cssVarName(motionVars["--honk-motion-duration-shimmer"]),
      format: milliseconds,
    },
    spinner: {
      cssVar: cssVarName(motionVars["--honk-motion-duration-spinner"]),
      format: milliseconds,
    },
    scaleOverlay: {
      cssVar: cssVarName(motionVars["--honk-motion-scale-overlay"]),
      format: unitless,
    },
  },
};

// The overlay stacking order (unitless integers).
const dsZPanel: PanelSpec = {
  id: "ds-z",
  name: "Z-index",
  config: {
    titlebar: [50, 0, 200, 5],
    popover: [60, 0, 200, 5],
    menu: [60, 0, 200, 5],
    tooltip: [65, 0, 200, 5],
    dialog: [80, 0, 200, 5],
    command: [90, 0, 200, 5],
    toast: [100, 0, 200, 5],
  },
  bindings: {
    titlebar: { cssVar: cssVarName(zVars["--honk-z-titlebar"]), format: unitless },
    popover: { cssVar: cssVarName(zVars["--honk-z-popover"]), format: unitless },
    menu: { cssVar: cssVarName(zVars["--honk-z-menu"]), format: unitless },
    tooltip: { cssVar: cssVarName(zVars["--honk-z-tooltip"]), format: unitless },
    dialog: { cssVar: cssVarName(zVars["--honk-z-dialog"]), format: unitless },
    command: { cssVar: cssVarName(zVars["--honk-z-command"]), format: unitless },
    toast: { cssVar: cssVarName(zVars["--honk-z-toast"]), format: unitless },
  },
};

// The full window-chrome geometry (superset of shellPanel + tabsPanel, self-contained).
const dsShellPanel: PanelSpec = {
  id: "ds-shell",
  name: "Shell geometry",
  config: {
    titlebarH: [34, 24, 56, 1],
    titlebarSeat: [0, 0, 12, 1],
    tabH: [28, 20, 44, 1],
    tabMaxW: [224, 120, 320, 4],
    tabMinW: [28, 20, 48, 1],
    insetLeft: [80, 0, 120, 1],
    tabGap: [13.5, 4, 24, 0.5],
  },
  bindings: {
    titlebarH: { cssVar: cssVarName(shellVars["--honk-shell-titlebar-h"]) },
    titlebarSeat: { cssVar: cssVarName(shellVars["--honk-shell-titlebar-seat"]) },
    tabH: { cssVar: cssVarName(shellVars["--honk-shell-tab-h"]) },
    tabMaxW: { cssVar: cssVarName(shellVars["--honk-shell-tab-max-w"]) },
    tabMinW: { cssVar: cssVarName(shellVars["--honk-shell-tab-min-w"]) },
    insetLeft: { cssVar: cssVarName(shellVars["--honk-shell-inset-left"]) },
    tabGap: { cssVar: cssVarName(shellVars["--honk-shell-tab-gap"]) },
  },
};

const dsConversationPanel: PanelSpec = {
  id: "ds-conversation",
  name: "Conversation",
  config: {
    inset: [11, 0, 24, 1],
    rowMinH: [24, 16, 40, 1],
    rowGap: [4, 0, 12, 1],
    stepGap: [6, 0, 16, 1],
    fgSecondary: [74, 20, 100, 1],
    fgTertiary: [54, 20, 100, 1],
  },
  bindings: {
    inset: { cssVar: cssVarName(conversationVars["--honk-conversation-inset"]) },
    rowMinH: { cssVar: cssVarName(conversationVars["--honk-conversation-row-min-h"]) },
    rowGap: { cssVar: cssVarName(conversationVars["--honk-conversation-row-gap"]) },
    stepGap: { cssVar: cssVarName(conversationVars["--honk-conversation-step-gap"]) },
    fgSecondary: {
      cssVar: cssVarName(colorVars["--honk-color-fg-secondary"]),
      format: fgMixPercent,
    },
    fgTertiary: { cssVar: cssVarName(colorVars["--honk-color-fg-tertiary"]), format: fgMixPercent },
  },
};

const dsToastPanel: PanelSpec = {
  ...toastPanel,
  id: "ds-toast",
};

const dsReadingPanel: PanelSpec = {
  ...prosePanel,
  id: "ds-reading",
  name: "Reading prose",
};

// Mounted together only on /design (createPanelMount + DesignSystemDials below).
const DESIGN_PANELS: readonly PanelSpec[] = [
  dsRadiusPanel,
  dsSpacePanel,
  dsControlPanel,
  dsProsePanel,
  dsReadingPanel,
  dsChromePanel,
  dsIconPanel,
  dsMotionPanel,
  dsZPanel,
  dsShellPanel,
  dsConversationPanel,
  dsToastPanel,
];

const PANELS: readonly PanelSpec[] = [
  themePanel,
  shellPanel,
  tabsPanel,
  textPanel,
  prosePanel,
  iconPanel,
  conversationPanel,
  toastPanel,
  ...DESIGN_PANELS,
];

// ── Application (outside React) ─────────────────────────────────────────────────────────────

// Push one panel's current values onto <html>. Idempotent: same values → same inline styles.
// Absent values (panel not registered yet, or unregistered after its story left) are skipped,
// which is what makes applied values sticky across story switches.
// A dial's config default: slider tuples carry it first; string configs (hex colors) ARE it.
// Select configs have no cssVar binding, so they never reach the default check.
function configDefault(entry: DialConfig[string] | undefined): number | string | undefined {
  if (Array.isArray(entry)) {
    return entry[0];
  }
  if (typeof entry === "string" || typeof entry === "number") {
    return entry;
  }
  return undefined;
}

function applyPanelValues(spec: PanelSpec): void {
  const values = DialStore.getValues(spec.id);
  const rootStyle = document.documentElement.style;

  // Theme's appearance dial drives light-dark() resolution at the document root — a scheme
  // keyword, not a --honk-* var, so it can't be a binding. This covers everything OUTSIDE the
  // Shell frame; the frame itself pins its own color-scheme, so RootLayout also reads
  // useAppearance below and swaps the frame's xstyle (the manual theme-toggle escape shell.tsx
  // documents). Runs even before the panel registers, so first paint already has a scheme.
  if (spec.id === THEME_PANEL_ID) {
    const appearance = values["appearance"];
    rootStyle.colorScheme =
      appearance === "light" || appearance === "dark" ? appearance : "light dark";
  }

  for (const [key, binding] of Object.entries(spec.bindings)) {
    const value = values[key];
    // At the config default → un-pin: remove any inline override so the stylesheet token (both
    // arms of a light-dark() pair included) is what paints. Distinct from ABSENT (panel not
    // registered), which leaves whatever is applied — that is what keeps tuned values sticky
    // across story switches.
    if (value !== undefined && value === configDefault(spec.config[key])) {
      rootStyle.removeProperty(binding.cssVar);
      continue;
    }
    if (typeof value === "number") {
      rootStyle.setProperty(
        binding.cssVar,
        binding.format === undefined ? `${value}px` : binding.format(value),
      );
    } else if (typeof value === "string") {
      rootStyle.setProperty(binding.cssVar, value); // hex colors apply verbatim
    }
  }
}

// One stable applier per panel, so re-subscribing is idempotent (DialStore.subscribe backs onto
// a Set — re-adding the same function reference is a no-op).
const panelAppliers: ReadonlyMap<string, () => void> = new Map(
  PANELS.map((spec) => [
    spec.id,
    (): void => {
      applyPanelValues(spec);
    },
  ]),
);

function applyAndResubscribeAll(): void {
  for (const [panelId, applier] of panelAppliers) {
    DialStore.subscribe(panelId, applier);
    applier();
  }
}

// Wire the store to the document exactly once, at import. Two feeds are needed because they
// fail differently: value edits notify per-panel listeners (registration notifies BOTH feeds —
// registerPanel ends with notify(id) + notifyGlobal()), but unregisterPanel WIPES the panel's
// whole listener set (`listeners.delete(id)`), and panels here register/unregister all the
// time: StrictMode's probe unmount on every load, plus every story switch unregistering the
// old story's panel. Without re-arming, an applier would go deaf to slider edits after any
// wipe. Global listeners survive the wipe, and every wipe emits a global event, so re-adding
// ALL panel feeds there always heals them (subscribe backs onto a Set, so re-adds are
// idempotent) — including the feed of whichever panel registers next.
let isBoundToDocument = false;

function bindDialsToDocument(): void {
  if (isBoundToDocument || typeof document === "undefined") {
    return;
  }
  isBoundToDocument = true;
  DialStore.subscribeGlobal(applyAndResubscribeAll);
  applyAndResubscribeAll();
}

bindDialsToDocument();

// ── Panel mount components ──────────────────────────────────────────────────────────────────
// Mount one anywhere at all to make its panel exist — useDialKit registers into the module
// singleton, no context; <DialRoot/> just has to be mounted somewhere to display it. Each
// renders nothing; persist:true survives reloads, the stable id survives StrictMode's
// mount-unmount-mount. Stories mount their own panel (dev/main.tsx), which is what keeps the
// dial rail scoped to the story on screen.

function createPanelMount(spec: PanelSpec): () => null {
  return function PanelMount(): null {
    useDialKit(spec.name, spec.config, { id: spec.id, persist: true });
    return null;
  };
}

const ThemeDials = createPanelMount(themePanel);
const ShellDials = createPanelMount(shellPanel);
const TabsDials = createPanelMount(tabsPanel);
const TextDials = createPanelMount(textPanel);
const ProseDials = createPanelMount(prosePanel);
const IconDials = createPanelMount(iconPanel);
const ConversationDials = createPanelMount(conversationPanel);
const ToastDials = createPanelMount(toastPanel);

// The /design master page mounts EVERY token-group panel at once (one aggregate component so the
// route body stays a single tag). Each child registers its panel; the dial rail then shows the
// whole design system. Rendering a fixed list of components keeps hooks order stable (no hook runs
// in a loop here — each createPanelMount component owns its single useDialKit).
const DESIGN_PANEL_MOUNTS = DESIGN_PANELS.map(createPanelMount);

function DesignSystemDials(): ReactElement {
  return createElement(
    Fragment,
    null,
    DESIGN_PANEL_MOUNTS.map((Mount, index) =>
      createElement(Mount, { key: DESIGN_PANELS[index]?.id }),
    ),
  );
}

// ── Appearance, for React consumers ─────────────────────────────────────────────────────────
// The one dial the CSS-var path can't deliver: Shell declares its own color-scheme, and an
// element's own declaration beats anything inherited from <html>. So the frame's scheme is a
// React concern — read through this store hook (ADR 0025: useSyncExternalStore, no useEffect)
// and pinned via Shell's xstyle. StyleX's colorScheme type has no 'inherit', which is what
// forces the explicit three-way pick over a pass-through.

type Appearance = "system" | "light" | "dark";

function subscribeAppearance(onStoreChange: () => void): () => void {
  // Both feeds plus the re-arm, same shape and same reason as bindDialsToDocument: edits notify
  // only the panel feed, and unregisterPanel wipes that feed — the global feed (which every
  // register/unregister emits on) is the healing channel that re-adds it.
  const unsubscribeGlobal = DialStore.subscribeGlobal(() => {
    DialStore.subscribe(THEME_PANEL_ID, onStoreChange);
    onStoreChange();
  });
  const unsubscribeValues = DialStore.subscribe(THEME_PANEL_ID, onStoreChange);
  return () => {
    // one delete suffices even if the re-arm ran: it re-added this same function reference
    unsubscribeValues();
    unsubscribeGlobal();
  };
}

function getAppearanceSnapshot(): Appearance {
  const value = DialStore.getValues(THEME_PANEL_ID)["appearance"];
  return value === "light" || value === "dark" ? value : "system";
}

function getAppearanceServerSnapshot(): Appearance {
  return "system";
}

// Returns a string primitive, so consumers re-render only when the appearance actually flips —
// slider drags on the other dials never touch them.
function useAppearance(): Appearance {
  return useSyncExternalStore(
    subscribeAppearance,
    getAppearanceSnapshot,
    getAppearanceServerSnapshot,
  );
}

export {
  ConversationDials,
  DesignSystemDials,
  IconDials,
  ProseDials,
  ShellDials,
  TabsDials,
  TextDials,
  ThemeDials,
  ToastDials,
  useAppearance,
};
export type { Appearance };
