import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import {
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
} from "./tokens.stylex";

type SegmentedControlSize = "sm" | "md";

interface SegmentedControlOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly disabled?: boolean;
}

interface SegmentedControlProps<Value extends string> {
  readonly value: Value;
  readonly options: readonly SegmentedControlOption<Value>[];
  readonly onValueChange: (value: Value) => void;
  readonly accessibilityLabel: string;
  readonly size?: SegmentedControlSize;
  readonly disabled?: boolean;
  readonly style?: StyleProp<HonkStyle>;
}

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px is the fixed inset between a segmented track and its selected surface
    padding: "2px",
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px inset ring is fixed segmented-track geometry; its color remains token-owned
    boxShadow: `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`,
  },
  item: {
    appearance: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    minWidth: 0,
    paddingInline: controlVars["--honk-control-pad-md"],
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
      "[data-pressed]": colorVars["--honk-color-bg-base"],
    },
    boxShadow: {
      default: "none",
      "[data-pressed]": elevationVars["--honk-elevation-button-neutral"],
    },
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
      "[data-pressed]": colorVars["--honk-color-text-primary"],
    },
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    lineHeight: 1,
    whiteSpace: "nowrap",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
    opacity: { default: 1, "[data-disabled]": controlVars["--honk-control-disabled-opacity"] },
    transitionProperty: "background-color, box-shadow, color, opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  itemSm: {
    height: controlVars["--honk-control-h-sm"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  itemMd: {
    height: controlVars["--honk-control-h-md"],
  },
});

function SegmentedControl<Value extends string>({
  value,
  options,
  onValueChange,
  accessibilityLabel,
  size = "md",
  disabled = false,
  style,
}: SegmentedControlProps<Value>): React.ReactElement {
  return (
    <ToggleGroup
      value={[value]}
      disabled={disabled}
      aria-label={accessibilityLabel}
      onValueChange={(next) => {
        const selected = next[0] as Value | undefined;
        if (selected !== undefined) onValueChange(selected);
      }}
      {...applyStyle(stylex.props(styles.root), style)}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          aria-label={option.label}
          {...stylex.props(styles.item, size === "sm" ? styles.itemSm : styles.itemMd)}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

export { SegmentedControl };
export type { SegmentedControlOption, SegmentedControlProps, SegmentedControlSize };
