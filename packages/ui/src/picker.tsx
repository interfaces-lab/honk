import { Select as Base } from "@base-ui/react/select";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Icon } from "./icon";
import { IconCheckmark1, IconChevronDownMedium } from "./icons";
import type {
  PickerCompound,
  PickerGroupLabelProps,
  PickerGroupProps,
  PickerOptionProps,
  PickerPopupProps,
  PickerRootProps,
  PickerSize,
  PickerTriggerProps,
} from "./picker.types";
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

const PICKER_GUTTER = 4;
const HAIRLINE = "1px";
// The popup ceiling preserves enough viewport context around an anchored picker.
const PICKER_POPUP_MAX_HEIGHT = "min(360px, var(--available-height))";
const POPUP_RING = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;

const sx = stylex.create({
  trigger: {
    appearance: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "space-between",
    maxWidth: controlVars["--honk-control-picker-max-w"],
    gap: controlVars["--honk-control-gap"],
    boxSizing: "border-box",
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    paddingInline: controlVars["--honk-control-pad-md"],
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    lineHeight: 1,
    whiteSpace: "nowrap",
    cursor: { default: "pointer", ":disabled": "default" },
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
    opacity: { default: 1, ":disabled": controlVars["--honk-control-disabled-opacity"] },
    transitionProperty: "background-color, color, opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  triggerNeutral: {
    backgroundColor: {
      default: colorVars["--honk-color-control"],
      ":hover": {
        "@media (hover: hover)": colorVars["--honk-color-control-hover"],
      },
      ":active": colorVars["--honk-color-control-press"],
      "[data-popup-open]": colorVars["--honk-color-control-open"],
    },
  },
  triggerQuiet: {
    backgroundColor: {
      default: "transparent",
      ":hover": {
        "@media (hover: hover)": colorVars["--honk-color-state-hover"],
      },
      ":active": colorVars["--honk-color-state-press"],
      "[data-popup-open]": colorVars["--honk-color-state-hover"],
    },
  },
  triggerSm: { height: controlVars["--honk-control-h-sm"] },
  triggerMd: { height: controlVars["--honk-control-h-md"] },
  triggerContent: {
    display: "inline-flex",
    alignItems: "center",
    minWidth: 0,
    gap: controlVars["--honk-control-gap"],
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  triggerChevron: {
    display: "inline-flex",
    flexShrink: 0,
    color: colorVars["--honk-color-text-muted"],
    transitionProperty: "transform",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    "[data-popup-open] &": { transform: "rotate(180deg)" },
  },
  positioner: {
    zIndex: zVars["--honk-z-menu"],
    minWidth: "var(--anchor-width)",
    maxWidth: "var(--available-width)",
  },
  positionerDialog: {
    zIndex: zVars["--honk-z-dialog"],
  },
  popup: {
    boxSizing: "border-box",
    minWidth: controlVars["--honk-control-picker-min-w"],
    maxWidth: controlVars["--honk-control-picker-max-w"],
    maxHeight: PICKER_POPUP_MAX_HEIGHT,
    paddingBlock: spaceVars["--honk-space-gutter"],
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `${elevationVars["--honk-elevation-floating"]}, ${POPUP_RING}`,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    outline: "none",
    overflowY: "auto",
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
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "[data-ending-style]": motionVars["--honk-motion-duration-instant"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  popupTriggerWidth: { width: "var(--anchor-width)" },
  popupWide: { width: controlVars["--honk-control-picker-max-w"] },
  list: { outline: "none" },
  option: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    boxSizing: "border-box",
    minHeight: controlVars["--honk-control-h-md"],
    paddingInline: controlVars["--honk-control-pad-md"],
    borderRadius: radiusVars["--honk-radius-control"],
    color: colorVars["--honk-color-text-primary"],
    lineHeight: 1,
    userSelect: "none",
    outline: "none",
    cursor: { default: "pointer", "[data-disabled]": "default" },
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": colorVars["--honk-color-state-hover"],
      "[data-selected]": colorVars["--honk-color-control-selected"],
    },
    opacity: {
      default: 1,
      "[data-disabled]": controlVars["--honk-control-disabled-opacity"],
    },
  },
  optionRich: { minHeight: controlVars["--honk-control-picker-rich-min-h"] },
  optionLeading: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  optionContent: {
    display: "flex",
    minWidth: 0,
    flexGrow: 1,
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  optionLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
  optionDescription: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  optionMetadata: {
    flexShrink: 0,
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  indicator: {
    display: "inline-flex",
    flexShrink: 0,
    color: colorVars["--honk-color-accent"],
  },
  groupLabel: {
    paddingInline: controlVars["--honk-control-pad-md"],
    paddingBlock: controlVars["--honk-control-gap"],
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    userSelect: "none",
  },
  separator: {
    height: HAIRLINE,
    backgroundColor: colorVars["--honk-color-border-muted"],
  },
});

const triggerSizeStyles: Record<PickerSize, stylex.StyleXStyles> = {
  sm: sx.triggerSm,
  md: sx.triggerMd,
};

function PickerRoot({
  children,
  value,
  onValueChange,
  disabled,
  name,
}: PickerRootProps): React.ReactElement {
  return (
    <Base.Root
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      disabled={disabled}
      name={name}
    >
      {children}
    </Base.Root>
  );
}

function PickerTrigger({
  children,
  accessibilityLabel,
  size = "md",
  tone = "neutral",
  title,
}: PickerTriggerProps): React.ReactElement {
  return (
    <Base.Trigger
      aria-label={accessibilityLabel}
      title={title}
      data-slot="picker-trigger"
      {...stylex.props(
        sx.trigger,
        triggerSizeStyles[size],
        tone === "neutral" ? sx.triggerNeutral : sx.triggerQuiet,
      )}
    >
      <span {...stylex.props(sx.triggerContent)}>{children}</span>
      <span {...stylex.props(sx.triggerChevron)}>
        <Icon icon={IconChevronDownMedium} size="sm" />
      </span>
    </Base.Trigger>
  );
}

function PickerPopup({
  children,
  label,
  width = "trigger",
  layer = "menu",
  side = "bottom",
  align = "start",
}: PickerPopupProps): React.ReactElement {
  return (
    <Base.Portal>
      <Base.Positioner
        side={side}
        align={align}
        sideOffset={PICKER_GUTTER}
        alignItemWithTrigger={false}
        {...stylex.props(sx.positioner, layer === "dialog" && sx.positionerDialog)}
      >
        <Base.Popup
          aria-label={label}
          data-slot="picker-popup"
          {...stylex.props(sx.popup, width === "wide" ? sx.popupWide : sx.popupTriggerWidth)}
        >
          <Base.List {...stylex.props(sx.list)}>{children}</Base.List>
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}

function PickerOption({
  value,
  label,
  description,
  leading,
  metadata,
  disabled,
}: PickerOptionProps): React.ReactElement {
  return (
    <Base.Item
      value={value}
      label={label}
      disabled={disabled}
      data-slot="picker-option"
      {...stylex.props(sx.option, description !== undefined && sx.optionRich)}
    >
      {leading === undefined ? null : <span {...stylex.props(sx.optionLeading)}>{leading}</span>}
      <span {...stylex.props(sx.optionContent)}>
        <Base.ItemText {...stylex.props(sx.optionLabel)}>{label}</Base.ItemText>
        {description === undefined ? null : (
          <span {...stylex.props(sx.optionDescription)}>{description}</span>
        )}
      </span>
      {metadata === undefined ? null : <span {...stylex.props(sx.optionMetadata)}>{metadata}</span>}
      <Base.ItemIndicator {...stylex.props(sx.indicator)}>
        <Icon icon={IconCheckmark1} size="xs" />
      </Base.ItemIndicator>
    </Base.Item>
  );
}

function PickerGroup({ children }: PickerGroupProps): React.ReactElement {
  return <Base.Group>{children}</Base.Group>;
}

function PickerGroupLabel({ children }: PickerGroupLabelProps): React.ReactElement {
  return <Base.GroupLabel {...stylex.props(sx.groupLabel)}>{children}</Base.GroupLabel>;
}

const Picker: PickerCompound = {
  Root: PickerRoot,
  Trigger: PickerTrigger,
  Popup: PickerPopup,
  Option: PickerOption,
  Group: PickerGroup,
  GroupLabel: PickerGroupLabel,
};

export { Picker };
export type {
  PickerGroupLabelProps,
  PickerGroupProps,
  PickerOptionProps,
  PickerPopupLayer,
  PickerPopupProps,
  PickerPopupWidth,
  PickerRootProps,
  PickerSize,
  PickerTone,
  PickerTriggerProps,
} from "./picker.types";
