// Anchored action menu.

import { ContextMenu as ContextBase } from "@base-ui/react/context-menu";
import { Menu as Base } from "@base-ui/react/menu";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { Switch } from "./switch";
import { Icon } from "./icon";
import { IconCheckmark1 } from "./icons";
import {
  borderVars,
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  iconVars,
  motionVars,
  radiusVars,
  zVars,
} from "./tokens.stylex";

const MENU_GUTTER_PX = 4;
const SUBMENU_GUTTER_PX = 0;
const SUBMENU_ALIGN_OFFSET_PX = -4;
const MENU_MIN_WIDTH = "160px";
const MENU_MAX_WIDTH = "280px";
// Separators span the full popup width (Cursor ui-menu section dividers are full-bleed).
const SEPARATOR_BLEED = `calc(-1 * ${controlVars["--honk-control-menu-pad"]})`;

const RING_MUTED = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;

const sx = stylex.create({
  positioner: {
    zIndex: zVars["--honk-z-menu"],
  },
  popup: {
    minWidth: MENU_MIN_WIDTH,
    maxWidth: MENU_MAX_WIDTH,
    // Equal inline + block gutter so each item's rounded highlight is inset from the
    // popup edge on both axes (not full-bleed horizontally).
    padding: controlVars["--honk-control-menu-pad"],
    borderRadius: radiusVars["--honk-radius-menu"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `${elevationVars["--honk-elevation-floating"]}, ${RING_MUTED}`,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    outline: "none",
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
    transitionTimingFunction: {
      default: motionVars["--honk-motion-ease-out"],
      "[data-ending-style]": motionVars["--honk-motion-ease-in"],
    },
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "[data-ending-style]": motionVars["--honk-motion-duration-instant"],
      "[data-instant]": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    boxSizing: "border-box",
    height: controlVars["--honk-control-h-sm"],
    paddingInline: controlVars["--honk-control-pad-sm"],
    borderRadius: radiusVars["--honk-radius-control"],
    color: colorVars["--honk-color-text-primary"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: 1,
    userSelect: "none",
    outline: "none",
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": colorVars["--honk-color-state-hover"],
    },
    opacity: { default: 1, "[data-disabled]": 0.4 },
    transitionProperty: "background-color, opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  submenuTrigger: {
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": colorVars["--honk-color-state-hover"],
      "[data-popup-open]": colorVars["--honk-color-state-hover"],
    },
  },
  groupLabel: {
    paddingInline: controlVars["--honk-control-pad-sm"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 3px is the compact menu group-label block inset; no spacing or control-padding token owns it
    paddingBlock: "3px",
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    userSelect: "none",
  },
  separator: {
    height: borderVars["--honk-border-hairline"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 3px is the compact menu divider's block margin; no spacing or menu token owns it
    marginBlock: "3px",
    marginInline: SEPARATOR_BLEED,
    backgroundColor: colorVars["--honk-color-border-muted"],
  },
  indicator: {
    marginInlineStart: "auto",
    display: "grid",
    placeItems: "center",
  },
  passiveIndicator: {
    pointerEvents: "none",
  },
  itemIcon: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: iconVars["--honk-icon-size-md"],
    height: iconVars["--honk-icon-size-md"],
    color: colorVars["--honk-color-text-muted"],
  },
  itemMeta: {
    marginInlineStart: "auto",
    flexShrink: 0,
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
    whiteSpace: "nowrap",
  },
});

interface MenuPopupProps extends Omit<Base.Popup.Props, "className" | "style"> {
  side?: Base.Positioner.Props["side"];
  align?: Base.Positioner.Props["align"];
  sideOffset?: number;
  alignOffset?: Base.Positioner.Props["alignOffset"];
  style?: StyleProp<HonkStyle>;
}

function MenuPopup({
  side = "bottom",
  align = "start",
  sideOffset = MENU_GUTTER_PX,
  alignOffset,
  style,
  children,
  ...rest
}: MenuPopupProps): React.ReactElement {
  return (
    <Base.Portal>
      <Base.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        {...stylex.props(sx.positioner)}
      >
        <Base.Popup {...rest} data-slot="menu" {...applyStyle(stylex.props(sx.popup), style)}>
          {children}
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}

interface MenuItemProps extends Omit<Base.Item.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function MenuItem({ style, ...rest }: MenuItemProps): React.ReactElement {
  return (
    <Base.Item {...rest} data-slot="menu-item" {...applyStyle(stylex.props(sx.item), style)} />
  );
}

interface MenuCheckboxItemProps extends Omit<Base.CheckboxItem.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function MenuCheckboxItem({ style, children, ...rest }: MenuCheckboxItemProps): React.ReactElement {
  return (
    <Base.CheckboxItem
      {...rest}
      data-slot="menu-checkbox-item"
      {...applyStyle(stylex.props(sx.item), style)}
    >
      {children}
      <MenuCheckboxItemIndicator />
    </Base.CheckboxItem>
  );
}

interface MenuSwitchItemProps extends Omit<MenuCheckboxItemProps, "checked" | "defaultChecked"> {
  checked: boolean;
}

function MenuSwitchItem({
  style,
  children,
  checked,
  ...rest
}: MenuSwitchItemProps): React.ReactElement {
  return (
    <Base.CheckboxItem
      {...rest}
      checked={checked}
      data-slot="menu-switch-item"
      {...applyStyle(stylex.props(sx.item), style)}
    >
      {children}
      <span {...stylex.props(sx.indicator, sx.passiveIndicator)}>
        <Switch size="sm" checked={checked} readOnly tabIndex={-1} aria-hidden="true" />
      </span>
    </Base.CheckboxItem>
  );
}

interface MenuCheckboxItemIndicatorProps extends Omit<
  Base.CheckboxItemIndicator.Props,
  "className" | "style"
> {
  style?: StyleProp<HonkStyle>;
}

function MenuCheckboxItemIndicator({
  style,
  children,
  ...rest
}: MenuCheckboxItemIndicatorProps): React.ReactElement {
  return (
    <Base.CheckboxItemIndicator
      {...rest}
      data-slot="menu-checkbox-item-indicator"
      {...applyStyle(stylex.props(sx.indicator), style)}
    >
      {children ?? <Icon icon={IconCheckmark1} size="xs" />}
    </Base.CheckboxItemIndicator>
  );
}

interface MenuRadioItemProps extends Omit<Base.RadioItem.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function MenuRadioItem({ style, children, ...rest }: MenuRadioItemProps): React.ReactElement {
  return (
    <Base.RadioItem
      {...rest}
      data-slot="menu-radio-item"
      {...applyStyle(stylex.props(sx.item), style)}
    >
      {children}
      <MenuRadioItemIndicator />
    </Base.RadioItem>
  );
}

interface MenuRadioItemIndicatorProps extends Omit<
  Base.RadioItemIndicator.Props,
  "className" | "style"
> {
  style?: StyleProp<HonkStyle>;
}

function MenuRadioItemIndicator({
  style,
  children,
  ...rest
}: MenuRadioItemIndicatorProps): React.ReactElement {
  return (
    <Base.RadioItemIndicator
      {...rest}
      data-slot="menu-radio-item-indicator"
      {...applyStyle(stylex.props(sx.indicator), style)}
    >
      {children ?? <Icon icon={IconCheckmark1} size="xs" />}
    </Base.RadioItemIndicator>
  );
}

interface MenuSubmenuTriggerProps extends Omit<Base.SubmenuTrigger.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function MenuSubmenuTrigger({ style, ...rest }: MenuSubmenuTriggerProps): React.ReactElement {
  return (
    <Base.SubmenuTrigger
      {...rest}
      data-slot="menu-submenu-trigger"
      {...applyStyle(stylex.props(sx.item, sx.submenuTrigger), style)}
    />
  );
}

type MenuSubmenuPopupProps = MenuPopupProps;

function MenuSubmenuPopup(props: MenuSubmenuPopupProps): React.ReactElement {
  return (
    <MenuPopup
      side="inline-end"
      align="start"
      sideOffset={SUBMENU_GUTTER_PX}
      alignOffset={SUBMENU_ALIGN_OFFSET_PX}
      {...props}
    />
  );
}

interface MenuSeparatorProps extends Omit<Base.Separator.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function MenuSeparator({ style, ...rest }: MenuSeparatorProps): React.ReactElement {
  return (
    <Base.Separator
      {...rest}
      data-slot="menu-separator"
      {...applyStyle(stylex.props(sx.separator), style)}
    />
  );
}

interface MenuGroupLabelProps extends Omit<Base.GroupLabel.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function MenuGroupLabel({ style, ...rest }: MenuGroupLabelProps): React.ReactElement {
  return (
    <Base.GroupLabel
      {...rest}
      data-slot="menu-group-label"
      {...applyStyle(stylex.props(sx.groupLabel), style)}
    />
  );
}

interface MenuItemIconProps {
  children?: React.ReactNode;
  style?: StyleProp<HonkStyle>;
}

// Fixed leading-icon slot so labels align whether or not a row supplies an icon.
function MenuItemIcon({ children, style }: MenuItemIconProps): React.ReactElement {
  return (
    <span data-slot="menu-item-icon" {...applyStyle(stylex.props(sx.itemIcon), style)}>
      {children}
    </span>
  );
}

interface MenuItemMetaProps {
  children?: React.ReactNode;
  style?: StyleProp<HonkStyle>;
}

// Trailing meta slot (shortcut chrome / badge); pushes to inline end, never shrinks.
function MenuItemMeta({ children, style }: MenuItemMetaProps): React.ReactElement {
  return (
    <span data-slot="menu-item-meta" {...applyStyle(stylex.props(sx.itemMeta), style)}>
      {children}
    </span>
  );
}

const Menu = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Popup: MenuPopup,
  Item: MenuItem,
  ItemIcon: MenuItemIcon,
  ItemMeta: MenuItemMeta,
  CheckboxItem: MenuCheckboxItem,
  CheckboxItemIndicator: MenuCheckboxItemIndicator,
  SwitchItem: MenuSwitchItem,
  RadioGroup: Base.RadioGroup,
  RadioItem: MenuRadioItem,
  RadioItemIndicator: MenuRadioItemIndicator,
  Separator: MenuSeparator,
  Group: Base.Group,
  GroupLabel: MenuGroupLabel,
  SubmenuRoot: Base.SubmenuRoot,
  SubmenuTrigger: MenuSubmenuTrigger,
  SubmenuPopup: MenuSubmenuPopup,
};

interface ContextMenuPopupProps extends Omit<ContextBase.Popup.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function ContextMenuPopup({ style, children, ...rest }: ContextMenuPopupProps): React.ReactElement {
  return (
    <ContextBase.Portal>
      <ContextBase.Positioner {...stylex.props(sx.positioner)}>
        <ContextBase.Popup
          {...rest}
          data-slot="context-menu"
          {...applyStyle(stylex.props(sx.popup), style)}
        >
          {children}
        </ContextBase.Popup>
      </ContextBase.Positioner>
    </ContextBase.Portal>
  );
}

interface ContextMenuItemProps extends Omit<ContextBase.Item.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function ContextMenuItem({ style, ...rest }: ContextMenuItemProps): React.ReactElement {
  return (
    <ContextBase.Item
      {...rest}
      data-slot="context-menu-item"
      {...applyStyle(stylex.props(sx.item), style)}
    />
  );
}

interface ContextMenuSeparatorProps extends Omit<
  ContextBase.Separator.Props,
  "className" | "style"
> {
  style?: StyleProp<HonkStyle>;
}

function ContextMenuSeparator({ style, ...rest }: ContextMenuSeparatorProps): React.ReactElement {
  return (
    <ContextBase.Separator
      {...rest}
      data-slot="context-menu-separator"
      {...applyStyle(stylex.props(sx.separator), style)}
    />
  );
}

const ContextMenu = {
  Root: ContextBase.Root,
  Trigger: ContextBase.Trigger,
  Popup: ContextMenuPopup,
  Item: ContextMenuItem,
  ItemIcon: MenuItemIcon,
  ItemMeta: MenuItemMeta,
  Separator: ContextMenuSeparator,
};

export { ContextMenu, Menu };
export type {
  ContextMenuItemProps,
  ContextMenuPopupProps,
  ContextMenuSeparatorProps,
  MenuCheckboxItemIndicatorProps,
  MenuCheckboxItemProps,
  MenuGroupLabelProps,
  MenuItemIconProps,
  MenuItemMetaProps,
  MenuItemProps,
  MenuPopupProps,
  MenuRadioItemIndicatorProps,
  MenuRadioItemProps,
  MenuSeparatorProps,
  MenuSubmenuPopupProps,
  MenuSubmenuTriggerProps,
  MenuSwitchItemProps,
};
