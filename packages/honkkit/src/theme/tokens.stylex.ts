import * as stylex from "@stylexjs/stylex";

const colorDefaults = {
  "--honk-kit-color-background": "var(--background)",
  "--honk-kit-color-bg-quinary": "var(--honk-bg-quinary)",
  "--honk-kit-color-bg-quaternary": "var(--honk-bg-quaternary)",
  "--honk-kit-color-bg-tertiary": "var(--honk-bg-tertiary)",
  "--honk-kit-color-border": "var(--border)",
  "--honk-kit-color-destructive": "var(--destructive)",
  "--honk-kit-color-destructive-foreground": "var(--destructive-foreground)",
  "--honk-kit-color-fg-primary": "var(--honk-fg-primary)",
  "--honk-kit-color-fg-secondary": "var(--honk-fg-secondary)",
  "--honk-kit-color-hover": "var(--honk-hover, var(--honk-color-hover))",
  "--honk-kit-color-icon-accent-primary": "var(--honk-icon-accent-primary)",
  "--honk-kit-color-icon-primary": "var(--honk-icon-primary)",
  "--honk-kit-color-icon-quaternary": "var(--honk-icon-quaternary)",
  "--honk-kit-color-icon-secondary": "var(--honk-icon-secondary)",
  "--honk-kit-color-icon-tertiary": "var(--honk-icon-tertiary)",
  "--honk-kit-color-icon-warning": "var(--honk-icon-warning)",
  "--honk-kit-color-input": "var(--input)",
  "--honk-kit-color-popover": "var(--popover)",
  "--honk-kit-color-primary": "var(--primary)",
  "--honk-kit-color-primary-foreground": "var(--primary-foreground)",
  "--honk-kit-color-ring": "var(--ring)",
  "--honk-kit-color-secondary": "var(--secondary)",
  "--honk-kit-color-secondary-foreground": "var(--secondary-foreground)",
  "--honk-kit-color-stroke-secondary": "var(--honk-stroke-secondary)",
  "--honk-kit-color-stroke-tertiary": "var(--honk-stroke-tertiary)",
  "--honk-kit-color-success": "var(--success)",
  "--honk-kit-color-white": "white",
  "--honk-kit-color-warning": "var(--warning)",
  "--honk-kit-color-warning-strong": "var(--honk-tone-yellow, var(--warning))",
} as const;

const spacingDefaults = {
  "--honk-kit-spacing-1": "var(--honk-spacing-1)",
  "--honk-kit-spacing-1-5": "var(--honk-spacing-1-5)",
  "--honk-kit-spacing-2": "var(--honk-spacing-2)",
  "--honk-kit-spacing-2-5": "var(--honk-spacing-2-5)",
  "--honk-kit-spacing-3": "var(--honk-spacing-3)",
  "--honk-kit-spacing-3-5": "14px",
} as const;

const radiusDefaults = {
  "--honk-kit-radius-control": "var(--honk-radius-control)",
  "--honk-kit-radius-full": "9999px",
  "--honk-kit-radius-sm": "var(--honk-radius-sm)",
} as const;

const sizeDefaults = {
  "--honk-kit-size-button": "24px",
  "--honk-kit-size-button-lg": "28px",
  "--honk-kit-size-button-sm": "20px",
  "--honk-kit-size-button-xl": "32px",
  "--honk-kit-size-button-xs": "16px",
  "--honk-kit-size-icon-default": "16px",
  "--honk-kit-size-icon-lg": "18px",
  "--honk-kit-size-icon-sm": "14px",
  "--honk-kit-size-icon-xl": "20px",
  "--honk-kit-size-icon-xs": "12px",
  "--honk-kit-size-kbd": "20px",
  "--honk-kit-size-status-dot": "var(--honk-status-dot-size, 5.5px)",
} as const;

const typographyDefaults = {
  "--honk-kit-font-ui": "var(--honk-font-ui)",
  "--honk-kit-leading-body": "var(--honk-leading-body)",
  "--honk-kit-leading-caption": "var(--honk-leading-caption)",
  "--honk-kit-leading-detail": "var(--honk-leading-detail)",
  "--honk-kit-leading-sidebar-label": "var(--honk-sidebar-label-leading)",
  "--honk-kit-leading-title": "var(--honk-leading-title)",
  "--honk-kit-text-body": "var(--honk-text-body)",
  "--honk-kit-text-caption": "var(--honk-text-caption)",
  "--honk-kit-text-detail": "var(--honk-text-detail)",
  "--honk-kit-text-sidebar-label": "var(--honk-sidebar-label-size)",
  "--honk-kit-text-title": "var(--honk-text-title)",
} as const;

const motionDefaults = {
  "--honk-kit-motion-duration-ui": "var(--motion-duration-ui)",
  "--honk-kit-motion-ease-shell": "var(--ease-shell)",
  "--honk-kit-spinner-duration": "1s",
} as const;

const colorVars = stylex.defineVars(colorDefaults);
const spacingVars = stylex.defineVars(spacingDefaults);
const radiusVars = stylex.defineVars(radiusDefaults);
const sizeVars = stylex.defineVars(sizeDefaults);
const typographyVars = stylex.defineVars(typographyDefaults);
const motionVars = stylex.defineVars(motionDefaults);

export {
  colorDefaults,
  colorVars,
  motionDefaults,
  motionVars,
  radiusDefaults,
  radiusVars,
  sizeDefaults,
  sizeVars,
  spacingDefaults,
  spacingVars,
  typographyDefaults,
  typographyVars,
};
