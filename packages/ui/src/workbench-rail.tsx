import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { type WorkbenchRailLabelProps, type WorkbenchRailRowProps } from "./workbench-rail.types";
import { colorVars, controlVars, fontVars, motionVars, radiusVars } from "./tokens.stylex";

// Recovered from Cursor's collapsed-apps rail. These are component intrinsics, not theme choices.
const LABEL_DESCENDER = "3px";
const FOCUS_RING_OFFSET_INSET = "-1px";

const styles = stylex.create({
  row: {
    appearance: "none",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    flexShrink: 0,
    width: "100%",
    height: controlVars["--honk-control-h-md"],
    gap: controlVars["--honk-control-gap"],
    paddingInline: controlVars["--honk-control-pad-sm"],
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
      ":active": colorVars["--honk-color-state-press"],
    },
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    lineHeight: "20px",
    letterSpacing: "-0.08px",
    WebkitFontSmoothing: fontVars["--honk-font-smoothing"],
    MozOsxFontSmoothing: fontVars["--honk-font-smoothing-moz"],
    textAlign: "start",
    whiteSpace: "nowrap",
    userSelect: "none",
    cursor: { default: "pointer", ":disabled": "default" },
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: FOCUS_RING_OFFSET_INSET,
    opacity: { default: 1, ":disabled": controlVars["--honk-control-disabled-opacity"] },
    transitionProperty: "background-color, color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  label: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    marginBlockEnd: `-${LABEL_DESCENDER}`,
    paddingBlockEnd: LABEL_DESCENDER,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

function WorkbenchRailRow({
  children,
  disabled = false,
  accessibilityLabel,
  onClick,
}: WorkbenchRailRowProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={accessibilityLabel}
      disabled={disabled}
      data-slot="workbench-rail-row"
      {...stylex.props(styles.row)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Label({ children }: WorkbenchRailLabelProps): React.ReactElement {
  return (
    <span data-slot="workbench-rail-label" {...stylex.props(styles.label)}>
      {children}
    </span>
  );
}

const WorkbenchRailRowWithLabel = Object.assign(WorkbenchRailRow, { Label });

export { WorkbenchRailRowWithLabel as WorkbenchRailRow };
export type { WorkbenchRailLabelProps, WorkbenchRailRowProps } from "./workbench-rail.types";
