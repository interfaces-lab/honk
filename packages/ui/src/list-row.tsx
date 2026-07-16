import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import {
  colorVars,
  controlVars,
  fontVars,
  iconVars,
  motionVars,
  radiusVars,
  sidebarVars,
} from "./tokens.stylex";

// Focus ring is inset. Rows sit in clipped scroll columns where an outside ring would clip.
const FOCUS_RING_OFFSET_INSET = "-1px";
// ListRow aligns text to its 20px leading slot, independent of the title's font size.
const CONTENT_LINE_HEIGHT = "20px";
// Old-main sidebar actions use a fixed 20px visual box inside a 28px row.
const SIDEBAR_ACTION_SIZE = "20px";

const sx = stylex.create({
  root: {
    appearance: "none",
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    width: "100%",
    flexShrink: 0,
    boxSizing: "border-box",
    minHeight: controlVars["--honk-control-h-md"],
    paddingInline: controlVars["--honk-control-pad-md"],
    paddingBlock: controlVars["--honk-control-gap"],
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": {
        "@media (hover: hover)": colorVars["--honk-color-state-hover"],
      },
      ":active": colorVars["--honk-color-state-press"],
    },
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    // Titles ellipsize in an overflow-hidden wrapper, so this must include descenders.
    lineHeight: CONTENT_LINE_HEIGHT,
    textAlign: "start",
    whiteSpace: "nowrap",
    userSelect: "none",
    cursor: { default: "pointer", ":disabled": "default" },
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: FOCUS_RING_OFFSET_INSET,
    opacity: { default: 1, ":disabled": controlVars["--honk-control-disabled-opacity"] },
    transitionProperty: "background-color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  selected: {
    backgroundColor: {
      default: colorVars["--honk-color-control-selected"],
      ":hover": {
        "@media (hover: hover)": colorVars["--honk-color-control-selected"],
      },
      ":active": colorVars["--honk-color-control-selected"],
    },
  },
  highlighted: {
    backgroundColor: colorVars["--honk-color-state-hover"],
  },
  content: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    minWidth: 0,
    flexGrow: 1,
    gap: controlVars["--honk-control-gap"],
  },
  slot: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: iconVars["--honk-icon-size-md"],
    height: iconVars["--honk-icon-size-md"],
  },
  title: {
    minWidth: 0,
    flexShrink: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: fontVars["--honk-font-weight-medium"],
  },
  description: {
    minWidth: 0,
    flexShrink: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
  meta: {
    marginInlineStart: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  action: {
    appearance: "none",
    width: SIDEBAR_ACTION_SIZE,
    height: SIDEBAR_ACTION_SIZE,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    padding: 0,
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": {
        "@media (hover: hover)": colorVars["--honk-color-state-hover"],
      },
      ":active": colorVars["--honk-color-state-press"],
    },
    color: colorVars["--honk-color-text-faint"],
    cursor: "pointer",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: FOCUS_RING_OFFSET_INSET,
  },
  actionActive: {
    backgroundColor: colorVars["--honk-color-control-selected"],
    color: colorVars["--honk-color-text-primary"],
  },
});

// Exact old-main sidebar row geometry from shell.css / honkkit SidebarItem.
const sizeStyles = stylex.create({
  sm: {
    gap: sidebarVars["--honk-sidebar-item-gap"],
    minHeight: sidebarVars["--honk-sidebar-item-height"],
    paddingInline: sidebarVars["--honk-sidebar-row-padding-inline"],
    paddingBlock: sidebarVars["--honk-sidebar-row-padding-block"],
    fontSize: sidebarVars["--honk-sidebar-label-size"],
    lineHeight: sidebarVars["--honk-sidebar-label-leading"],
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
});

const sizeSlotStyles = stylex.create({
  sm: {
    width: sidebarVars["--honk-sidebar-icon-slot"],
    height: sidebarVars["--honk-sidebar-icon-slot"],
  },
});

const sizeTitleStyles = stylex.create({
  sm: {
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
});

const sizeMetaStyles = stylex.create({
  sm: {
    gap: sidebarVars["--honk-sidebar-item-gap"],
    fontSize: sidebarVars["--honk-sidebar-subtitle-size"],
    lineHeight: sidebarVars["--honk-sidebar-subtitle-leading"],
  },
});

type ListRowSize = "sm" | "md";

const ListRowSizeContext = React.createContext<ListRowSize>("md");

interface ListRowProps extends Omit<
  React.ComponentPropsWithoutRef<"button">,
  "className" | "style"
> {
  isSelected?: boolean;
  isHighlighted?: boolean;
  size?: ListRowSize;
  ref?: React.Ref<HTMLButtonElement>;
  style?: StyleProp<HonkStyle>;
}

function ListRowRoot({
  isSelected = false,
  isHighlighted = false,
  size = "md",
  style,
  children,
  ...rest
}: ListRowProps): React.ReactElement {
  return (
    <ListRowSizeContext.Provider value={size}>
      <button
        type="button"
        {...rest}
        data-slot="list-row"
        data-size={size}
        {...applyStyle(
          stylex.props(
            sx.root,
            size === "sm" && sizeStyles.sm,
            isHighlighted && sx.highlighted,
            isSelected && sx.selected,
          ),
          style,
        )}
      >
        {children}
      </button>
    </ListRowSizeContext.Provider>
  );
}

interface ListRowPieceProps {
  children?: React.ReactNode;
  style?: StyleProp<HonkStyle>;
}

interface ListRowActionProps extends Omit<
  React.ComponentPropsWithoutRef<"button">,
  "className" | "style"
> {
  isActive?: boolean;
}

function Slot({ children, style }: ListRowPieceProps): React.ReactElement {
  const size = React.use(ListRowSizeContext);
  return (
    <span
      data-slot="list-row-leading"
      {...applyStyle(stylex.props(sx.slot, size === "sm" && sizeSlotStyles.sm), style)}
    >
      {children}
    </span>
  );
}

function Content({ children, style }: ListRowPieceProps): React.ReactElement {
  return (
    <span data-slot="list-row-content" {...applyStyle(stylex.props(sx.content), style)}>
      {children}
    </span>
  );
}

function Title({ children, style }: ListRowPieceProps): React.ReactElement {
  const size = React.use(ListRowSizeContext);
  return (
    <span
      data-slot="list-row-title"
      {...applyStyle(stylex.props(sx.title, size === "sm" && sizeTitleStyles.sm), style)}
    >
      {children}
    </span>
  );
}

function Description({ children, style }: ListRowPieceProps): React.ReactElement {
  return (
    <span data-slot="list-row-description" {...applyStyle(stylex.props(sx.description), style)}>
      {children}
    </span>
  );
}

function Meta({ children, style }: ListRowPieceProps): React.ReactElement {
  const size = React.use(ListRowSizeContext);
  return (
    <span
      data-slot="list-row-meta"
      {...applyStyle(stylex.props(sx.meta, size === "sm" && sizeMetaStyles.sm), style)}
    >
      {children}
    </span>
  );
}

function Action({ isActive = false, type, ...rest }: ListRowActionProps): React.ReactElement {
  return (
    <button
      type={type ?? "button"}
      {...rest}
      data-slot="list-row-action"
      {...stylex.props(sx.action, isActive && sx.actionActive)}
    />
  );
}

const ListRow = Object.assign(ListRowRoot, { Slot, Content, Title, Description, Meta, Action });

export { ListRow };
export type { ListRowActionProps, ListRowPieceProps, ListRowProps, ListRowSize };
