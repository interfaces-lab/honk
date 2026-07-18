// Anchored action menu.

import { ContextMenu as ContextBase } from "@base-ui/react/context-menu";
import { Menu as Base } from "@base-ui/react/menu";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { Icon } from "./icon";
import { IconCheckmark1 } from "./icons";
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

const MENU_GUTTER_PX = 4;
const SUBMENU_GUTTER_PX = 0;
const SUBMENU_ALIGN_OFFSET_PX = -4;

const RING_MUTED = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;

const sx = stylex.create({
  positioner: {
    zIndex: zVars["--honk-z-menu"],
  },
  popup: {
    minWidth: "200px",
    maxWidth: "320px",
    // Equal inline + block gutter so each item's rounded highlight is inset from the
    // popup edge on both axes (not full-bleed horizontally).
    padding: spaceVars["--honk-space-gutter"],
    borderRadius: radiusVars["--honk-radius-window"],
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
    height: controlVars["--honk-control-h-md"],
    paddingInline: controlVars["--honk-control-pad-md"],
    borderRadius: radiusVars["--honk-radius-control"],
    color: colorVars["--honk-color-text-primary"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: 1,
    userSelect: "none",
    outline: "none",
    cursor: { default: "pointer", "[data-disabled]": "default" },
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
    paddingInline: controlVars["--honk-control-pad-md"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px group-label vertical padding is a fixed menu intrinsic; no menu spacing token owns 4px
    paddingBlock: "4px",
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    userSelect: "none",
  },
  separator: {
    height: "1px",
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px separator vertical margin is a fixed menu intrinsic; no menu spacing token owns 4px
    marginBlock: "4px",
    backgroundColor: colorVars["--honk-color-border-muted"],
  },
  indicator: {
    marginInlineStart: "auto",
    display: "grid",
    placeItems: "center",
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

const Menu = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Popup: MenuPopup,
  Item: MenuItem,
  CheckboxItem: MenuCheckboxItem,
  CheckboxItemIndicator: MenuCheckboxItemIndicator,
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
  MenuItemProps,
  MenuPopupProps,
  MenuSeparatorProps,
  MenuSubmenuPopupProps,
  MenuSubmenuTriggerProps,
};
