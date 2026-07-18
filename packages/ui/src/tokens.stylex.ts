// Stable web token facade. Shared values are authored in theme.ts and generated into
// platform-tokens.stylex.ts; this file owns web-only border, elevation, motion, z-index,
// shell, toast, and prose concerns.

import * as stylex from "@stylexjs/stylex";

import { colorVars } from "./platform-tokens.stylex";

export {
  colorDefaults,
  colorVars,
  controlDefaults,
  controlVars,
  conversationDefaults,
  conversationVars,
  fontDefaults,
  fontVars,
  iconDefaults,
  iconVars,
  radiusDefaults,
  radiusVars,
  sidebarDefaults,
  sidebarVars,
  spaceDefaults,
  spaceVars,
} from "./platform-tokens.stylex";
export type {
  ColorVarName,
  ControlVarName,
  ConversationVarName,
  FontVarName,
  IconVarName,
  RadiusVarName,
  SidebarVarName,
  SpaceVarName,
} from "./platform-tokens.stylex";

const borderDefaults = {
  // The app's one divider weight: region hairlines, separators, drop indicators' cousins.
  "--honk-border-hairline": "1px",
} as const;

const elevationDefaults = {
  // Cursor keeps this for non-inset workbench surfaces; `.has-insets` explicitly disables it.
  "--honk-elevation-workbench":
    "0 0 8px 2px light-dark(rgba(0,0,0,.024), transparent)," +
    " 0 2px 4px light-dark(transparent, rgba(0,0,0,.30))," +
    " 0 1px 2px light-dark(transparent, rgba(0,0,0,.30))," +
    " 0 0 0 .5px light-dark(transparent, rgba(255,255,255,.16))," +
    " 0 -.5px 0 light-dark(transparent, rgba(255,255,255,.06))",
  // OpenCode v2 tightens the light second shadow with -1px spread, while dark keeps 0.
  // Separate color-switched layers preserve both geometries under Honk's light-dark() theming.
  "--honk-elevation-raised":
    "0 2px 4px light-dark(rgba(0,0,0,.04), rgba(0,0,0,.30))," +
    " 0 1px 2px -1px light-dark(rgba(0,0,0,.08), transparent)," +
    " 0 1px 2px light-dark(transparent, rgba(0,0,0,.30))," +
    " 0 0 0 .5px light-dark(rgba(0,0,0,.12), rgba(255,255,255,.16))," +
    " 0 -.5px 0 light-dark(transparent, rgba(255,255,255,.06))",
  // Floating follows OpenCode v2's floating tier (8/16 + 4/8); ring and bevel stay shared.
  "--honk-elevation-floating":
    "0 8px 16px light-dark(rgba(0,0,0,.04), rgba(0,0,0,.30))," +
    " 0 4px 8px light-dark(rgba(0,0,0,.08), rgba(0,0,0,.30))," +
    " 0 0 0 .5px light-dark(rgba(0,0,0,.12), rgba(255,255,255,.16))," +
    " 0 -.5px 0 light-dark(transparent, rgba(255,255,255,.06))",
  // Overlay is OpenCode v2's heaviest tier (16/32 + 8/16), reserved for modal dialogs.
  "--honk-elevation-overlay":
    "0 16px 32px light-dark(rgba(0,0,0,.04), rgba(0,0,0,.30))," +
    " 0 8px 16px light-dark(rgba(0,0,0,.08), rgba(0,0,0,.30))," +
    " 0 0 0 .5px light-dark(rgba(0,0,0,.12), rgba(255,255,255,.16))," +
    " 0 -.5px 0 light-dark(transparent, rgba(255,255,255,.06))",
  "--honk-elevation-toast": "0 10px 20px rgba(0,0,0,.45)",
  "--honk-elevation-button-neutral":
    "0 1px 2px light-dark(rgba(0,0,0,.06), rgba(0,0,0,.24))," +
    " 0 0 0 .5px light-dark(rgba(0,0,0,.12), rgba(255,255,255,.16))," +
    " 0 -.5px 0 light-dark(transparent, rgba(255,255,255,.06))",
  "--honk-elevation-elements": "0 .5px .5px rgba(0,0,0,.40)",
} as const;

const motionDefaults = {
  "--honk-motion-duration-instant": "80ms",
  "--honk-motion-duration-hover": "100ms",
  "--honk-motion-duration-fast": "120ms",
  "--honk-motion-duration-base": "150ms",
  "--honk-motion-duration-expand": "200ms",
  "--honk-motion-duration-collapsible": "100ms",
  "--honk-motion-duration-shimmer": "2000ms",
  "--honk-motion-duration-spinner": "900ms",
  "--honk-motion-ease-out": "cubic-bezier(0.215, 0.61, 0.355, 1)",
  "--honk-motion-ease-in": "ease-in",
  "--honk-motion-ease-float": "cubic-bezier(0.16, 1, 0.3, 1)",
  "--honk-motion-ease-slide": "cubic-bezier(0.22, 1, 0.36, 1)",
  "--honk-motion-scale-overlay": "0.98",
} as const;

const zDefaults = {
  "--honk-z-stage-side": "10",
  "--honk-z-stage-main": "20",
  "--honk-z-stage-float": "30",
  // The latest user turn stays below titlebar chrome and every floating composer tray.
  "--honk-z-thread-sticky-message": "25",
  "--honk-z-titlebar": "50",
  "--honk-z-popover": "60",
  "--honk-z-menu": "60",
  "--honk-z-tooltip": "65",
  "--honk-z-dialog": "80",
  "--honk-z-command": "90",
  "--honk-z-toast": "100",
} as const;

const toastDefaults = {
  "--honk-toast-offset": "18px",
  "--honk-toast-radius": "18px",
  "--honk-toast-padding-block": "12px",
  "--honk-toast-padding-inline": "16px",
  "--honk-toast-content-gap": "3px",
  "--honk-toast-item-gap": "12px",
  "--honk-toast-icon-size": "32px",
  "--honk-toast-border-width": "1px",
  "--honk-toast-title-size": "14px",
  "--honk-toast-title-leading": "18px",
  "--honk-toast-description-size": "13px",
  "--honk-toast-description-leading": "17px",
  "--honk-toast-close-size": "22px",
} as const;

const proseDefaults = {
  "--honk-prose-measure": "576px",
  "--honk-prose-size": "14px",
  "--honk-prose-leading": "21px",
  "--honk-prose-flow-gap": "20px",
  "--honk-prose-item-gap": "6px",
  "--honk-prose-section-gap": "48px",
} as const;

const shellDefaults = {
  "--honk-shell-titlebar-h": "36px",
  "--honk-shell-titlebar-seat": "8px",
  "--honk-shell-tab-h": "28px",
  "--honk-shell-tab-max-w": "224px",
  "--honk-shell-tab-min-w": "28px",
  "--honk-shell-inset-left": "84px",
  "--honk-shell-tab-gap": "13.5px",
  "--honk-shell-rail-w": "64px",
  "--honk-shell-side-w": "344px",
  "--honk-shell-side-min-w": "244px",
} as const;

// Cursor Glass changes the workbench material stack without mutating the palette.
// These inherited roles keep the browser/native defaults solid while Electron opts in.
const workbenchSurfaceDefaults: Readonly<
  Record<
    | "--honk-workbench-root-background"
    | "--honk-workbench-pane-background"
    | "--honk-workbench-glass-tint"
    | "--honk-workbench-input-background"
    | "--honk-workbench-input-border"
    | "--honk-workbench-input-border-active",
    string
  >
> = {
  "--honk-workbench-root-background": colorVars["--honk-color-bg-deep"],
  "--honk-workbench-pane-background": colorVars["--honk-color-bg-base"],
  // Opaque base the glass (backdrop + card) is a translucent slice of. Untinted it is the
  // deep surface; appearance-store pins it to an eased hue tint at high tint intensity.
  "--honk-workbench-glass-tint": colorVars["--honk-color-bg-deep"],
  "--honk-workbench-input-background": colorVars["--honk-color-layer-01"],
  "--honk-workbench-input-border": colorVars["--honk-color-border-muted"],
  "--honk-workbench-input-border-active": colorVars["--honk-color-border-base"],
};

const workbenchSurfaceVars = stylex.defineVars(workbenchSurfaceDefaults);
const electronGlassWorkbenchTheme = stylex.createTheme(workbenchSurfaceVars, {
  "--honk-workbench-root-background": `light-dark(${colorVars["--honk-color-bg-deep"]}, color-mix(in srgb, ${workbenchSurfaceVars["--honk-workbench-glass-tint"]} 42%, transparent))`,
  "--honk-workbench-pane-background": `light-dark(${colorVars["--honk-color-bg-base"]}, color-mix(in srgb, ${workbenchSurfaceVars["--honk-workbench-glass-tint"]} 72%, transparent))`,
  "--honk-workbench-input-background": `light-dark(${colorVars["--honk-color-layer-01"]}, color-mix(in srgb, ${colorVars["--honk-color-bg-base"]} 96%, ${colorVars["--honk-color-text-contrast"]}))`,
  "--honk-workbench-input-border": `light-dark(${colorVars["--honk-color-border-muted"]}, color-mix(in srgb, ${colorVars["--honk-color-text-contrast"]} 8%, transparent))`,
  "--honk-workbench-input-border-active": `light-dark(${colorVars["--honk-color-border-base"]}, color-mix(in srgb, ${colorVars["--honk-color-text-contrast"]} 12%, transparent))`,
});

const borderVars = stylex.defineVars(borderDefaults);
const elevationVars = stylex.defineVars(elevationDefaults);
const motionVars = stylex.defineVars(motionDefaults);
const zVars = stylex.defineVars(zDefaults);
const toastVars = stylex.defineVars(toastDefaults);
const proseVars = stylex.defineVars(proseDefaults);
const shellVars = stylex.defineVars(shellDefaults);

type BorderVarName = keyof typeof borderDefaults;
type ElevationVarName = keyof typeof elevationDefaults;
type MotionVarName = keyof typeof motionDefaults;
type ZVarName = keyof typeof zDefaults;
type ToastVarName = keyof typeof toastDefaults;
type ProseVarName = keyof typeof proseDefaults;
type ShellVarName = keyof typeof shellDefaults;
type WorkbenchSurfaceVarName = keyof typeof workbenchSurfaceDefaults;

export {
  borderDefaults,
  borderVars,
  elevationDefaults,
  elevationVars,
  electronGlassWorkbenchTheme,
  motionDefaults,
  motionVars,
  proseDefaults,
  proseVars,
  shellDefaults,
  shellVars,
  toastDefaults,
  toastVars,
  workbenchSurfaceDefaults,
  workbenchSurfaceVars,
  zDefaults,
  zVars,
};

export type {
  BorderVarName,
  ElevationVarName,
  MotionVarName,
  ProseVarName,
  ShellVarName,
  ToastVarName,
  WorkbenchSurfaceVarName,
  ZVarName,
};
