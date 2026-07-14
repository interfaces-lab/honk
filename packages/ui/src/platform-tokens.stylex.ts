/**
 * Generated StyleX binding for the renderer-neutral theme in theme.ts.
 * Run `honk-ui mobile sync`; do not edit marked blocks by hand.
 */

import * as stylex from "@stylexjs/stylex";

// @honk-ui-sync:start color
const colorDefaults = {
  "--honk-color-bg-deep": "light-dark(#EFF2F6, #151D28)",
  "--honk-color-bg-base": "light-dark(#ffffff, #1C2736)",
  "--honk-color-layer-01": "light-dark(#F9FAFB, #222E3F)",
  "--honk-color-layer-02": "light-dark(#DCE2EA, #2C3A4E)",
  "--honk-color-layer-03": "light-dark(#C0CAD8, #394960)",
  "--honk-color-tab-hover": "light-dark(#DCE2EA, #1C2736)",
  "--honk-color-layer-04": "light-dark(#A5B2C5, #485B75)",
  "--honk-color-bg-inverse": "light-dark(#19222E, #ffffff)",
  "--honk-color-bg-contrast": "light-dark(#232E3E, #586C89)",
  "--honk-color-text-inverse": "light-dark(#ffffff, #111822)",
  "--honk-color-text-contrast": "#ffffff",
  "--honk-color-text-primary": "light-dark(#000000, #ffffff)",
  "--honk-color-text-muted": "light-dark(#405168, #ABB8C9)",
  "--honk-color-text-faint": "light-dark(#8798B0, #586C89)",
  "--honk-color-border-muted": "light-dark(rgba(0,0,0,.08), rgba(255,255,255,.08))",
  "--honk-color-border-base": "light-dark(rgba(0,0,0,.10), rgba(255,255,255,.10))",
  "--honk-color-border-strong": "light-dark(rgba(0,0,0,.20), rgba(255,255,255,.20))",
  "--honk-color-accent": "light-dark(#006AFF, #4D97FF)",
  "--honk-color-accent-fill": "#006AFF",
  "--honk-color-on-accent": "#ffffff",
  "--honk-color-accent-subtle": "light-dark(#E5F0FF, #122949)",
  "--honk-color-control": "light-dark(#EFF2F6, #222E3F)",
  "--honk-color-control-hover": "light-dark(#DCE2EA, #2C3A4E)",
  "--honk-color-control-press": "light-dark(#C0CAD8, #394960)",
  "--honk-color-state-hover": "light-dark(rgba(0,0,0,.06), rgba(255,255,255,.08))",
  "--honk-color-state-press": "light-dark(rgba(0,0,0,.12), rgba(255,255,255,.14))",
  "--honk-color-scrim": "light-dark(rgba(0,0,0,.32), rgba(0,0,0,.55))",
  "--honk-color-toast-bg": "#1a1a1c",
  "--honk-color-toast-text": "#f5f5f7",
  "--honk-color-toast-muted": "#a6a6ad",
  "--honk-color-toast-border": "rgba(255,255,255,.08)",
  "--honk-color-toast-subtle": "rgba(255,255,255,.06)",
  "--honk-color-toast-action-text": "#0a0a0b",
  "--honk-color-ok-fg": "light-dark(#036D38, #0EDD75)",
  "--honk-color-warn-fg": "light-dark(#8e7231, #f2cf76)",
  "--honk-color-err-fg": "light-dark(#A71134, #F76486)",
  "--honk-color-info-fg": "light-dark(#2c47c8, #7698fd)",
  "--honk-color-ok-bg": "light-dark(#D3FDE8, #04522B)",
  "--honk-color-warn-bg": "light-dark(#fefaec, #4b4025)",
  "--honk-color-err-bg": "light-dark(#FEE7EC, #6F0B22)",
  "--honk-color-ok-border": "light-dark(#A3FACF, #056636)",
  "--honk-color-warn-border": "light-dark(#f7e5b5, #ac8833)",
  "--honk-color-info-bg": "light-dark(#ecf1fe, #1b2852)",
  "--honk-color-info-border": "light-dark(#c3d4fd, #263fa9)",
  "--honk-color-err-border": "light-dark(#FDD3DD, #910D2C)",
  "--honk-color-preset-low": "light-dark(#405168, #ABB8C9)",
  "--honk-color-preset-medium": "light-dark(#036D38, #0EDD75)",
  "--honk-color-preset-high": "light-dark(#2c47c8, #7698fd)",
  "--honk-color-preset-ultra": "light-dark(#6d45c8, #c0a7f5)",
  "--honk-color-fg": "light-dark(#000000, #ffffff)",
  "--honk-color-fg-secondary": "light-dark(rgba(0,0,0,.74), rgba(255,255,255,.74))",
  "--honk-color-fg-tertiary": "light-dark(rgba(0,0,0,.54), rgba(255,255,255,.54))",
  "--honk-color-fg-red": "light-dark(#A71134, #F76486)",
  "--honk-color-icon-tertiary": "light-dark(rgba(0,0,0,.46), rgba(255,255,255,.46))",
  "--honk-color-stroke-secondary": "light-dark(rgba(0,0,0,.12), rgba(255,255,255,.12))",
  "--honk-color-stroke-tertiary": "light-dark(rgba(0,0,0,.08), rgba(255,255,255,.08))",
  "--honk-color-message-bubble-bg": "light-dark(#F9FAFB, #222E3F)",
  "--honk-color-message-bubble-ring": "light-dark(rgba(0,0,0,.08), rgba(255,255,255,.12))",
  "--honk-color-diff-addition": "#00cab1",
  "--honk-color-diff-deletion": "#ff2e3f",
} as const;
// @honk-ui-sync:end color

// @honk-ui-sync:start radius
const radiusDefaults = {
  "--honk-radius-panel": "10px",
  "--honk-radius-window": "12px",
  "--honk-radius-control": "6px",
  "--honk-radius-field": "8px",
  "--honk-radius-avatar": "4px",
  "--honk-radius-pill": "999px",
  "--honk-radius-bubble": "12px",
} as const;
// @honk-ui-sync:end radius

// @honk-ui-sync:start space
const spaceDefaults = {
  "--honk-space-gutter": "8px",
  "--honk-space-panel-pad": "12px",
  "--honk-space-control-pad-x": "10px",
} as const;
// @honk-ui-sync:end space

// @honk-ui-sync:start control
const controlDefaults = {
  "--honk-control-h-sm": "24px",
  "--honk-control-h-md": "28px",
  "--honk-control-h-lg": "32px",
  "--honk-control-pad-sm": "8px",
  "--honk-control-pad-md": "10px",
  "--honk-control-pad-lg": "12px",
  "--honk-control-gap": "6px",
  "--honk-control-field-multiline-min-h": "80px",
  "--honk-control-border-width": "1px",
  "--honk-control-focus-ring-width": "1px",
  "--honk-control-focus-ring-offset": "2px",
} as const;
// @honk-ui-sync:end control

// @honk-ui-sync:start font
const fontDefaults = {
  "--honk-font-family-ui": "\"Inter\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  "--honk-font-family-mono": "ui-monospace, \"SF Mono\", Menlo, Monaco, Consolas, monospace",
  "--honk-font-family-rounded": "ui-rounded, \"SF Pro Rounded\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  "--honk-font-size-body": "13px",
  "--honk-font-size-detail": "12px",
  "--honk-font-size-caption": "11px",
  "--honk-font-size-micro": "10px",
  "--honk-font-size-body-lg": "14px",
  "--honk-text-caption": "10px",
  "--honk-text-detail": "11px",
  "--honk-text-body": "12px",
  "--honk-text-title": "13px",
  "--honk-text-heading": "16px",
  "--honk-leading-caption": "12px",
  "--honk-leading-detail": "14px",
  "--honk-leading-body": "16px",
  "--honk-leading-title": "18px",
  "--honk-leading-heading": "21px",
  "--honk-font-weight-regular": "400",
  "--honk-font-weight-book": "440",
  "--honk-font-weight-medium": "500",
  "--honk-font-weight-semibold": "600",
} as const;
// @honk-ui-sync:end font

// @honk-ui-sync:start icon
const iconDefaults = {
  "--honk-icon-size-xs": "12px",
  "--honk-icon-size-sm": "14px",
  "--honk-icon-size-md": "16px",
  "--honk-icon-size-lg": "18px",
  "--honk-icon-size-xl": "20px",
} as const;
// @honk-ui-sync:end icon

// @honk-ui-sync:start conversation
const conversationDefaults = {
  "--honk-conversation-inset": "11px",
  "--honk-conversation-row-min-h": "24px",
  "--honk-conversation-row-gap": "4px",
  "--honk-conversation-step-gap": "6px",
} as const;
// @honk-ui-sync:end conversation

const colorVars = stylex.defineVars(colorDefaults);
const radiusVars = stylex.defineVars(radiusDefaults);
const spaceVars = stylex.defineVars(spaceDefaults);
const controlVars = stylex.defineVars(controlDefaults);
const fontVars = stylex.defineVars(fontDefaults);
const iconVars = stylex.defineVars(iconDefaults);
const conversationVars = stylex.defineVars(conversationDefaults);

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
  spaceDefaults,
  spaceVars,
};
