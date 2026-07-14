// The compact content row — one selectable line in any list of things (threads, projects,
// command-menu results). Snapped to the shared control scale exactly like menu.tsx's item:
// fixed h-md height, control inline pad, control radius — so a list row, a menu row, and a
// small button all read as the same size across the system. Structure is slots, not props:
//
//   ListRow            the row itself (a <button>): fixed height, hover wash, active fill
//   ├ ListRow.Slot     leading glyph box (status dot / matrix / icon), icon-md square
//   ├ ListRow.Title    the primary label — truncates, medium weight
//   ├ ListRow.Subtitle the inline secondary label — truncates after the title, faint detail
//   └ ListRow.Meta     right-aligned trailing cluster (time, counts, chips), faint detail
//
// Zero logic, zero effects. Selection/highlight state comes in as `isActive` — the caller
// (keyboard nav, filters) owns it; the row only draws it.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { colorVars, controlVars, fontVars, iconVars, motionVars, radiusVars } from "./tokens.stylex";

// Focus ring intrinsics — the shared 1px accent hairline (button.tsx recipe). Drawn INSIDE
// the row (negative offset) because rows live in clipped scroll columns where an outside
// ring would be cut off; control anatomy, not a token.
const FOCUS_RING_WIDTH = "1px";
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
    height: controlVars["--honk-control-h-md"],
    paddingInline: controlVars["--honk-control-pad-md"],
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    // The hover wash (state-hover), not a layer step — a row highlight is a transient
    // pointer state, same reasoning as menu.tsx's item.
    backgroundColor: {
      default: "transparent",
      ":hover": {
        "@media (hover: hover)": colorVars["--honk-color-state-hover"],
      },
    },
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: 1, // tight box; the fixed height centers the line, not leading
    textAlign: "start",
    whiteSpace: "nowrap",
    userSelect: "none",
    cursor: "pointer",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: FOCUS_RING_WIDTH,
    outlineOffset: FOCUS_RING_OFFSET_INSET,
    transitionProperty: "background-color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  // The selected/highlighted fill — ALF primary_50, because active is a standing state while
  // the neutral state-hover wash above is transient.
  active: {
    backgroundColor: colorVars["--honk-color-accent-subtle"],
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
  subtitle: {
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
});

interface ListRowProps
  extends Omit<React.ComponentPropsWithoutRef<"button">, "className" | "style"> {
  // Standing selection/keyboard-highlight state, owned by the caller.
  isActive?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
  xstyle?: stylex.StyleXStyles;
}

function ListRowRoot({
  isActive = false,
  xstyle,
  children,
  ...rest
}: ListRowProps): React.ReactElement {
  return (
    <button type="button" {...rest} {...stylex.props(sx.root, isActive && sx.active, xstyle)}>
      {children}
    </button>
  );
}

interface ListRowPieceProps {
  children?: React.ReactNode;
  xstyle?: stylex.StyleXStyles;
}

function Slot({ children, xstyle }: ListRowPieceProps): React.ReactElement {
  return <span {...stylex.props(sx.slot, xstyle)}>{children}</span>;
}

function Title({ children, xstyle }: ListRowPieceProps): React.ReactElement {
  return <span {...stylex.props(sx.title, xstyle)}>{children}</span>;
}

function Subtitle({ children, xstyle }: ListRowPieceProps): React.ReactElement {
  return <span {...stylex.props(sx.subtitle, xstyle)}>{children}</span>;
}

function Meta({ children, xstyle }: ListRowPieceProps): React.ReactElement {
  return <span {...stylex.props(sx.meta, xstyle)}>{children}</span>;
}

const ListRow = Object.assign(ListRowRoot, { Slot, Title, Subtitle, Meta });

export { ListRow };
export type { ListRowPieceProps, ListRowProps };
