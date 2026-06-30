import * as stylex from "@stylexjs/stylex";

type SurfaceVarName =
  | "--honk-surface-root"
  | "--honk-surface-sidebar"
  | "--honk-surface-chat"
  | "--honk-surface-editor"
  | "--honk-surface-bubble"
  | "--honk-surface-bubble-opaque"
  | "--honk-surface-menu"
  | "--honk-surface-onboard"
  | "--honk-surface-inactive-tile-filter"
  | "--honk-surface-composer-blur"
  | "--honk-glass-surface-background"
  | "--honk-sidebar-surface-background"
  | "--honk-chat-surface-background"
  | "--honk-message-bubble-background"
  | "--honk-composer-surface-background"
  | "--honk-composer-surface-opaque-background"
  | "--honk-bubble-surface-background"
  | "--honk-bubble-surface-opaque-background"
  | "--honk-pane-surface-background"
  | "--honk-menu-surface-background"
  | "--honk-composer-popup-surface-background"
  | "--honk-command-palette-surface-background"
  | "--honk-workbench-editor-surface-background"
  | "--honk-workbench-surface-background"
  | "--honk-shell-sidebar-bg"
  | "--honk-shell-surface-bg"
  | "--honk-color-sidebar"
  | "--honk-color-chat"
  | "--honk-color-editor"
  | "--honk-color-surface"
  | "--honk-color-elevated"
  | "--honk-color-menubar"
  | "--honk-bg-elevated"
  | "--honk-composer-blur";

const surfaceDefaults: Record<SurfaceVarName, string> = {
  "--honk-surface-root": "var(--honk-base-editor)",
  "--honk-surface-sidebar": "var(--honk-base-sidebar)",
  "--honk-surface-chat": "var(--honk-base-chrome)",
  "--honk-surface-editor": "var(--honk-base-chrome)",
  "--honk-surface-bubble": "var(--honk-base-editor)",
  "--honk-surface-bubble-opaque": "var(--honk-base-editor)",
  "--honk-surface-menu": "var(--honk-base-editor)",
  "--honk-surface-onboard": "var(--honk-base-editor)",
  "--honk-surface-inactive-tile-filter": "brightness(0.965) saturate(0.9)",
  "--honk-surface-composer-blur": "10px",

  "--honk-glass-surface-background": "var(--honk-surface-root)",
  "--honk-sidebar-surface-background": "var(--honk-surface-sidebar)",
  "--honk-chat-surface-background": "var(--honk-surface-chat)",
  "--honk-message-bubble-background": "var(--honk-surface-bubble)",
  "--honk-composer-surface-background": "var(--honk-surface-bubble)",
  "--honk-composer-surface-opaque-background": "var(--honk-surface-bubble-opaque)",
  "--honk-bubble-surface-background": "var(--honk-surface-bubble)",
  "--honk-bubble-surface-opaque-background": "var(--honk-surface-bubble-opaque)",
  "--honk-pane-surface-background": "var(--honk-surface-menu)",
  "--honk-menu-surface-background": "var(--honk-surface-menu)",
  "--honk-composer-popup-surface-background": "var(--honk-surface-menu)",
  "--honk-command-palette-surface-background": "var(--honk-surface-menu)",
  "--honk-workbench-editor-surface-background": "var(--honk-surface-editor)",
  "--honk-workbench-surface-background": "var(--honk-surface-chat)",
  "--honk-shell-sidebar-bg": "var(--honk-surface-sidebar)",
  "--honk-shell-surface-bg": "var(--honk-surface-chat)",
  "--honk-color-sidebar": "var(--honk-surface-sidebar)",
  "--honk-color-chat": "var(--honk-surface-chat)",
  "--honk-color-editor": "var(--honk-surface-editor)",
  "--honk-color-surface": "var(--honk-surface-editor)",
  "--honk-color-elevated": "var(--honk-base-editor)",
  "--honk-color-menubar": "var(--honk-base-editor)",
  "--honk-bg-elevated": "var(--honk-base-editor)",
  "--honk-composer-blur": "var(--honk-surface-composer-blur)",
};

const surfaceVars = stylex.defineVars(surfaceDefaults);

const lightBubble = "var(--honk-base-editor)";
const darkBubble = "color-mix(in srgb, var(--honk-base-editor) 96%, #fff)";

const lightSolidSurfaceTheme = stylex.createTheme(surfaceVars, {
  "--honk-surface-root": "hsla(0, 0%, 100%, .16)",
  "--honk-surface-sidebar": "var(--honk-base-sidebar)",
  "--honk-surface-chat": "var(--honk-base-chrome)",
  "--honk-surface-editor": "var(--honk-base-chrome)",
  "--honk-surface-bubble": lightBubble,
  "--honk-surface-bubble-opaque": lightBubble,
  "--honk-surface-menu": lightBubble,
  "--honk-surface-onboard": "hsla(0, 0%, 100%, .36)",
  "--honk-surface-inactive-tile-filter": "brightness(0.965) saturate(0.9)",
  "--honk-surface-composer-blur": "10px",
});

const lightVibrantSurfaceTheme = stylex.createTheme(surfaceVars, {
  "--honk-surface-root": "hsla(0, 0%, 100%, .16)",
  "--honk-surface-sidebar":
    "color-mix(in srgb, var(--honk-base-sidebar) var(--honk-vibrancy-sidebar-mix), transparent)",
  "--honk-surface-chat":
    "color-mix(in srgb, var(--honk-base-chrome) var(--honk-vibrancy-chat-mix), transparent)",
  "--honk-surface-editor":
    "color-mix(in srgb, var(--honk-base-chrome) var(--honk-vibrancy-editor-mix), transparent)",
  "--honk-surface-bubble": lightBubble,
  "--honk-surface-bubble-opaque": lightBubble,
  // Menu surface is opaque in vibrant mode (matches the solid theme). The live
  // portaled menu is governed by tokens.css body[data-honk-glass-mode]; this
  // keeps the StyleX source-of-truth consistent.
  "--honk-surface-menu": "var(--honk-base-editor)",
  "--honk-surface-onboard": "hsla(0, 0%, 100%, .36)",
  "--honk-surface-inactive-tile-filter": "brightness(0.965) saturate(0.9)",
  "--honk-surface-composer-blur": "10px",
});

const darkSolidSurfaceTheme = stylex.createTheme(surfaceVars, {
  "--honk-surface-root": "rgba(0, 0, 0, .42)",
  "--honk-surface-sidebar": "var(--honk-base-sidebar)",
  "--honk-surface-chat": "var(--honk-base-chrome)",
  "--honk-surface-editor": "var(--honk-base-chrome)",
  "--honk-surface-bubble": darkBubble,
  "--honk-surface-bubble-opaque": darkBubble,
  "--honk-surface-menu": "var(--honk-base-editor)",
  "--honk-surface-onboard": "rgb(0 0 0 / 1%)",
  "--honk-surface-inactive-tile-filter": "brightness(0.65) saturate(1.25)",
  "--honk-surface-composer-blur": "10px",
});

const darkVibrantSurfaceTheme = stylex.createTheme(surfaceVars, {
  "--honk-surface-root": "rgba(0, 0, 0, .16)",
  "--honk-surface-sidebar":
    "color-mix(in srgb, var(--honk-base-sidebar) var(--honk-vibrancy-sidebar-mix), transparent)",
  "--honk-surface-chat":
    "color-mix(in srgb, var(--honk-base-chrome) var(--honk-vibrancy-chat-mix), transparent)",
  "--honk-surface-editor":
    "color-mix(in srgb, var(--honk-base-chrome) var(--honk-vibrancy-editor-mix), transparent)",
  "--honk-surface-bubble": darkBubble,
  "--honk-surface-bubble-opaque": darkBubble,
  // Menu surface is opaque in vibrant mode (matches the solid theme). The live
  // portaled menu is governed by tokens.css body[data-honk-glass-mode]; this
  // keeps the StyleX source-of-truth consistent.
  "--honk-surface-menu": "var(--honk-base-editor)",
  "--honk-surface-onboard": "rgb(0 0 0 / 1%)",
  "--honk-surface-inactive-tile-filter": "brightness(0.65) saturate(1.25)",
  "--honk-surface-composer-blur": "10px",
});

const reducedTransparencySurfaceTheme = stylex.createTheme(surfaceVars, {
  "--honk-surface-root": "var(--honk-base-editor)",
  "--honk-surface-sidebar": "var(--honk-base-sidebar)",
  "--honk-surface-chat": "var(--honk-base-chrome)",
  "--honk-surface-editor": "var(--honk-base-chrome)",
  "--honk-surface-bubble": "var(--honk-base-editor)",
  "--honk-surface-bubble-opaque": "var(--honk-base-editor)",
  "--honk-surface-menu": "var(--honk-base-editor)",
  "--honk-surface-onboard": "var(--honk-base-editor)",
  "--honk-surface-inactive-tile-filter": "none",
  "--honk-surface-composer-blur": "0px",
});

const highContrastSurfaceTheme = stylex.createTheme(surfaceVars, {
  "--honk-surface-root": "var(--honk-base-editor)",
  "--honk-surface-sidebar": "var(--honk-base-sidebar)",
  "--honk-surface-chat": "var(--honk-base-chrome)",
  "--honk-surface-editor": "var(--honk-base-chrome)",
  "--honk-surface-bubble": "var(--honk-base-editor)",
  "--honk-surface-bubble-opaque": "var(--honk-base-editor)",
  "--honk-surface-menu": "var(--honk-base-editor)",
  "--honk-surface-onboard": "var(--honk-base-editor)",
  "--honk-surface-inactive-tile-filter": "none",
  "--honk-surface-composer-blur": "0px",
});

const surfaceThemes = {
  light: {
    solid: lightSolidSurfaceTheme,
    vibrant: lightVibrantSurfaceTheme,
  },
  dark: {
    solid: darkSolidSurfaceTheme,
    vibrant: darkVibrantSurfaceTheme,
  },
  reducedTransparency: reducedTransparencySurfaceTheme,
  highContrast: highContrastSurfaceTheme,
} as const;

export { surfaceDefaults, surfaceThemes, surfaceVars };
