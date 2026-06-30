import * as stylex from "@stylexjs/stylex";

import { colorVars, motionVars, radiusVars } from "./theme/tokens.stylex";

const switchStyles = stylex.create({
  root: {
    "--honk-switch-thumb-size": "20px",
    alignItems: "center",
    backgroundColor: {
      default: colorVars["--honk-kit-color-bg-quinary"],
      "[data-checked]": colorVars["--honk-kit-color-primary"],
    },
    borderColor: {
      default: colorVars["--honk-kit-color-stroke-tertiary"],
      "[data-checked]": colorVars["--honk-kit-color-primary"],
    },
    borderRadius: radiusVars["--honk-kit-radius-full"],
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: "inset 0 1px color-mix(in srgb, black 4%, transparent)",
    boxSizing: "border-box",
    cursor: "var(--honk-button-cursor, pointer)",
    display: "inline-flex",
    flexShrink: 0,
    height: "calc(var(--honk-switch-thumb-size) + 2px)",
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${colorVars["--honk-kit-color-ring"]}`,
    },
    outlineOffset: {
      default: 0,
      ":focus-visible": 2,
    },
    padding: 1,
    transitionDuration: {
      default: motionVars["--honk-kit-motion-duration-ui"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionProperty: "background-color, border-color, box-shadow, opacity",
    transitionTimingFunction: motionVars["--honk-kit-motion-ease-shell"],
    width: "calc(var(--honk-switch-thumb-size) * 2 - 2px)",
    ":active:not([data-disabled]) [data-slot=switch-thumb]": {
      borderRadius: "calc(var(--honk-switch-thumb-size) / 1.1)",
      scale: "1.1 1",
    },
    "@media (min-width: 40rem)": {
      "--honk-switch-thumb-size": "16px",
    },
    "[data-disabled]": {
      cursor: "not-allowed",
      opacity: 0.64,
    },
  },
  menuRoot: {
    "--honk-switch-thumb-size": "16px",
    "@media (min-width: 40rem)": {
      "--honk-switch-thumb-size": "12px",
    },
  },
  thumb: {
    aspectRatio: "1 / 1",
    backgroundColor: colorVars["--honk-kit-color-background"],
    borderRadius: radiusVars["--honk-kit-radius-full"],
    boxShadow: "0 1px 2px color-mix(in srgb, black 10%, transparent)",
    display: "block",
    height: "100%",
    pointerEvents: "none",
    transformOrigin: {
      default: "left center",
      "[data-checked]": "var(--honk-switch-thumb-size) center",
    },
    transitionDuration: {
      default: motionVars["--honk-kit-motion-duration-ui"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionProperty: "translate, border-radius, scale, transform-origin",
    transitionTimingFunction: motionVars["--honk-kit-motion-ease-shell"],
    translate: {
      default: "0",
      "[data-checked]": "calc(var(--honk-switch-thumb-size) - 4px)",
    },
    willChange: "transform",
  },
});

export { switchStyles };
