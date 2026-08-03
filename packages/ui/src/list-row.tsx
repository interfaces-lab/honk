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
  spaceVars,
} from "./tokens.stylex";

// Focus ring is inset. Rows sit in clipped scroll columns where an outside ring would clip.
const FOCUS_RING_OFFSET_INSET = "-1px";

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
    lineHeight: fontVars["--honk-leading-title"],
    textAlign: "start",
    whiteSpace: "nowrap",
    userSelect: "none",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: FOCUS_RING_OFFSET_INSET,
    opacity: {
      default: 1,
      ":disabled": controlVars["--honk-control-disabled-opacity"],
    },
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
    fontWeight: fontVars["--honk-font-weight-regular"],
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
    width: iconVars["--honk-icon-size-xl"],
    height: iconVars["--honk-icon-size-xl"],
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
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: FOCUS_RING_OFFSET_INSET,
  },
  // Trailing value affordance (Cursor's parameter-row right section): the row's
  // current value as muted detail text plus a glyph, sized by content instead of
  // the fixed icon box.
  actionMeta: {
    width: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-menu-pad"],
    paddingInline: controlVars["--honk-control-menu-pad"],
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  actionActive: {
    backgroundColor: colorVars["--honk-color-control-selected"],
    color: colorVars["--honk-color-text-primary"],
  },
});

// Cursor gives the two transcript task disclosures distinct fractional heights.
const PLAN_SUMMARY_HEIGHT = "33.3px";
const TODO_SUMMARY_HEIGHT = "31.5px";

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
  // Compact dropdown density shared with the menu/combobox row recipe: 24px single-line
  // rows, two-line rows grow from the same block pad.
  menu: {
    minHeight: controlVars["--honk-control-h-sm"],
    paddingInline: controlVars["--honk-control-pad-sm"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 3px block padding is the compact menu row's intrinsic vertical inset; no spacing token owns it
    paddingBlock: "3px",
    lineHeight: fontVars["--honk-leading-body"],
  },
  summary: {
    height: "100%",
    paddingInline: spaceVars["--honk-space-gutter"],
    paddingBlock: 0,
    borderRadius: "inherit",
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": "transparent" },
      ":active": "transparent",
    },
    opacity: {
      default: 1,
      ":hover": { "@media (hover: hover)": 0.9 },
      ":active": 0.9,
    },
    lineHeight: fontVars["--honk-leading-body"],
  },
  planSummary: {
    height: PLAN_SUMMARY_HEIGHT,
  },
  todoSummary: {
    height: TODO_SUMMARY_HEIGHT,
  },
});

const sizeContentStyles = stylex.create({
  menu: {
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px separates the compact menu row title and description; no spacing token owns this sub-gutter gap
    gap: "2px",
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
  summary: {
    fontSize: fontVars["--honk-font-size-body"],
  },
});

type ListRowSize = "sm" | "md" | "menu" | "planSummary" | "todoSummary";

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
            size === "menu" && sizeStyles.menu,
            (size === "planSummary" || size === "todoSummary") && sizeStyles.summary,
            size === "planSummary" && sizeStyles.planSummary,
            size === "todoSummary" && sizeStyles.todoSummary,
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
  variant?: "icon" | "meta";
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
  const size = React.use(ListRowSizeContext);
  return (
    <span
      data-slot="list-row-content"
      {...applyStyle(stylex.props(sx.content, size === "menu" && sizeContentStyles.menu), style)}
    >
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
      {...applyStyle(
        stylex.props(
          sx.meta,
          size === "sm" && sizeMetaStyles.sm,
          (size === "planSummary" || size === "todoSummary") && sizeMetaStyles.summary,
        ),
        style,
      )}
    >
      {children}
    </span>
  );
}

function Action({
  isActive = false,
  variant = "icon",
  type,
  ...rest
}: ListRowActionProps): React.ReactElement {
  return (
    <button
      type={type ?? "button"}
      {...rest}
      data-slot="list-row-action"
      {...stylex.props(sx.action, variant === "meta" && sx.actionMeta, isActive && sx.actionActive)}
    />
  );
}

const ListRow = Object.assign(ListRowRoot, { Slot, Content, Title, Description, Meta, Action });

export { ListRow };
export type { ListRowActionProps, ListRowPieceProps, ListRowProps, ListRowSize };
