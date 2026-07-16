// DialKit bindings for the ui package preview.

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

function cssVarName(reference: unknown): string {
  const match = /^var\((--[^),\s]+)/.exec(String(reference));
  if (match?.[1] === undefined) {
    throw new Error(`dials: not a StyleX var reference: ${String(reference)}`);
  }
  return match[1];
}

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

function fgMixPercent(value: number): string {
  return `color-mix(in srgb, ${String(colorVars["--honk-color-fg"])} ${value}%, transparent)`;
}

function milliseconds(value: number): string {
  return `${value}ms`;
}

function unitless(value: number): string {
  return String(value);
}

// Appearance dial sets color-scheme. Accent dial may pin one hex over the light-dark pair.
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

const prosePanel: PanelSpec = {
  id: "prose",
  name: "Prose",
  config: {
    measure: [576, 440, 760, 8],
    size: [14, 12, 18, 0.5],
    leading: [25, 16, 30, 1],
    flowGap: [20, 4, 28, 1],
    itemGap: [6, 2, 16, 1],
    sectionGap: [48, 12, 80, 4],
  },
  bindings: {
    measure: { cssVar: cssVarName(proseVars["--honk-prose-measure"]) },
    size: { cssVar: cssVarName(proseVars["--honk-prose-size"]) },
    leading: { cssVar: cssVarName(proseVars["--honk-prose-leading"]) },
    flowGap: { cssVar: cssVarName(proseVars["--honk-prose-flow-gap"]) },
    itemGap: { cssVar: cssVarName(proseVars["--honk-prose-item-gap"]) },
    sectionGap: { cssVar: cssVarName(proseVars["--honk-prose-section-gap"]) },
  },
};

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

// Matrix has no dial panel. Glyph geometry must not drift.

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

const dsZPanel: PanelSpec = {
  id: "ds-z",
  name: "Z-index",
  config: {
    threadStickyMessage: [40, 0, 200, 5],
    titlebar: [50, 0, 200, 5],
    popover: [60, 0, 200, 5],
    menu: [60, 0, 200, 5],
    tooltip: [65, 0, 200, 5],
    dialog: [80, 0, 200, 5],
    command: [90, 0, 200, 5],
    toast: [100, 0, 200, 5],
  },
  bindings: {
    threadStickyMessage: {
      cssVar: cssVarName(zVars["--honk-z-thread-sticky-message"]),
      format: unitless,
    },
    titlebar: { cssVar: cssVarName(zVars["--honk-z-titlebar"]), format: unitless },
    popover: { cssVar: cssVarName(zVars["--honk-z-popover"]), format: unitless },
    menu: { cssVar: cssVarName(zVars["--honk-z-menu"]), format: unitless },
    tooltip: { cssVar: cssVarName(zVars["--honk-z-tooltip"]), format: unitless },
    dialog: { cssVar: cssVarName(zVars["--honk-z-dialog"]), format: unitless },
    command: { cssVar: cssVarName(zVars["--honk-z-command"]), format: unitless },
    toast: { cssVar: cssVarName(zVars["--honk-z-toast"]), format: unitless },
  },
};

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

  // Appearance is a color-scheme keyword, not a --honk-* binding.
  if (spec.id === THEME_PANEL_ID) {
    const appearance = values["appearance"];
    rootStyle.colorScheme =
      appearance === "light" || appearance === "dark" ? appearance : "light dark";
  }

  for (const [key, binding] of Object.entries(spec.bindings)) {
    const value = values[key];
    // Config default clears the inline pin so stylesheet light-dark arms paint again.
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
      rootStyle.setProperty(binding.cssVar, value);
    }
  }
}

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

type Appearance = "system" | "light" | "dark";

function subscribeAppearance(onStoreChange: () => void): () => void {
  const unsubscribeGlobal = DialStore.subscribeGlobal(() => {
    DialStore.subscribe(THEME_PANEL_ID, onStoreChange);
    onStoreChange();
  });
  const unsubscribeValues = DialStore.subscribe(THEME_PANEL_ID, onStoreChange);
  return () => {
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
