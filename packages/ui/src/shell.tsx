// The window anatomy — REBUILT to the opencode v2 desktop shell's INSET FLOATING SHEET
// composition (2026-07-12, replacing the earlier rail+hairline stage port): the titlebar sits
// on the deep well, and the body is a padded stage whose content rides ONE floating sheet —
// 8px gutter on every side, 10px radius on all corners, the raised elevation. There is no
// persistent rail/sidebar column in this anatomy: opencode v2's project nav lives INSIDE the
// home sheet (a 280px grid column), and every route paints within the same sheet. Colors stay
// honk's identity vocabulary; only the geometry and elevation recipe are opencode's. One file
// per concept (ADR 0011).
//
//   Shell               the deep root; owns color-scheme, so this is where every light-dark()
//                       token in the vocabulary resolves
//   ├ Shell.TitleBar    36px chrome strip on the deep well: traffic-light inset, 8px seat
//   │                   (bottom-seats the 28px tabs, opencode's pt-2), drag region
//   └ Shell.Stage       the body: a flex canvas carrying the 8px sheet gutter (opencode's
//     │                 m-2 on the home sheet / p-2 on the session route frame)
//     └ Shell.Sheet     the floating content sheet: bg-base, 10px radius, elevation-raised
//
// Pieces are props → DOM with an optional caller xstyle merged last (StyleX charter).

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import {
  colorVars,
  elevationVars,
  fontVars,
  radiusVars,
  shellVars,
  spaceVars,
} from "./tokens.stylex";

// The v2 sheet gutter — opencode's m-2/p-2 (8px) between the deep well and the sheet on
// every side. Structural to this anatomy, not identity vocabulary.
const SHEET_GUTTER = "8px";
// The titlebar's compact item rhythm from the opencode shell port; private chrome anatomy.
const TITLEBAR_ITEM_GAP = "6px";

const styles = stylex.create({
  frame: {
    height: "100dvh",
    display: "flex",
    flexDirection: "column",
    // THE theme root: 'light dark' lets the OS pick which arm of every light-dark() token
    // wins. A manual theme toggle overrides by passing an xstyle that pins colorScheme to
    // 'light' or 'dark' — never a duplicate token set (tokens.stylex.ts THEMING MECHANISM).
    colorScheme: "light dark",
    backgroundColor: colorVars["--honk-color-bg-deep"],
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    // Native-chrome text rendering, ported from the shipped app's body rule
    // (packages/app/src/index.css): antialiased smoothing is what makes 13px chrome type read
    // like a mac app instead of heavy browser text; font-synthesis off keeps the face from
    // faking weights the family already has. Keyword values, not design vocabulary.
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    fontSynthesis: "none",
  },
  titleBar: {
    height: shellVars["--honk-shell-titlebar-h"],
    flexShrink: 0,
    display: "flex",
    // items-center within the space UNDER the seat pad: at seat 8 the 28px tabs bottom-seat
    // in the 36px bar — opencode's own arrangement (header h-9, inner bar pt-2 items-center).
    alignItems: "center",
    paddingTop: shellVars["--honk-shell-titlebar-seat"],
    paddingLeft: shellVars["--honk-shell-inset-left"], // room for the macOS traffic lights
    // opencode's md:pr-3 — the bar's right inset so the trailing cluster clears the corner.
    paddingRight: spaceVars["--honk-space-panel-pad"],
    // the 6px rhythm between titlebar items (home button · tab strip · new-tab · trailing).
    columnGap: TITLEBAR_ITEM_GAP,
  },
  // The trailing slot (update pill, channel chip): pushed to the far edge.
  titleBarTrailing: {
    marginInlineStart: "auto",
    alignSelf: "center",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  stage: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    minWidth: 0,
    position: "relative",
    display: "flex",
    flexDirection: "column",
    overflowX: "hidden",
    // The sheet gutter: the deep well shows 8px around every sheet edge (opencode home.tsx
    // sheet m-2 / session.tsx SessionRouteFrame p-2 — same geometry, hoisted to the stage).
    padding: SHEET_GUTTER,
  },
  sheet: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    backgroundColor: colorVars["--honk-color-bg-base"],
    // opencode's rounded-[10px] — the sheet radius is the card tier (radius-panel), NOT the
    // 12px window shoulder of the previous anatomy.
    borderRadius: radiusVars["--honk-radius-panel"],
    // Depth is drawn by edges: the raised recipe's 0.5px ring is the sheet's only "border".
    boxShadow: elevationVars["--honk-elevation-raised"],
    overflow: "hidden",
    // perf isolation, ported as-is (opencode contain-strict on the session main frame).
    contain: "strict",
  },
});

// ── Pieces ─────────────────────────────────────────────────────────────────────────────────

interface ShellSlotProps {
  children?: React.ReactNode;
  // Caller override, merged last (charter merge order).
  xstyle?: stylex.StyleXStyles;
}

// The deep root. Mount exactly one; everything honk draws lives inside it.
function ShellRoot({ children, xstyle }: ShellSlotProps): React.ReactElement {
  return <div {...stylex.props(styles.frame, xstyle)}>{children}</div>;
}

interface TitleBarProps extends ShellSlotProps {
  // Far-edge slot (update pill, DEV channel chip).
  trailing?: React.ReactNode;
}

function TitleBar({ children, trailing, xstyle }: TitleBarProps): React.ReactElement {
  return (
    <div
      // Window-drag contract: attribute only. The -webkit-app-region CSS lives in the app
      // consumer's plain-CSS escape (ADR 0025 §5); interactive children opt out with
      // data-shell-no-drag.
      data-shell-drag-region=""
      {...stylex.props(styles.titleBar, xstyle)}
    >
      {children}
      {trailing != null && <div {...stylex.props(styles.titleBarTrailing)}>{trailing}</div>}
    </div>
  );
}

// The body canvas under the titlebar: owns the 8px sheet gutter. Mount route content inside
// a Shell.Sheet; overlays (toasts, command menu) portal above it.
function Stage({ children, xstyle }: ShellSlotProps): React.ReactElement {
  return <div {...stylex.props(styles.stage, xstyle)}>{children}</div>;
}

// The floating content sheet: base card paint, 10px radius, raised elevation.
function Sheet({ children, xstyle }: ShellSlotProps): React.ReactElement {
  return <main {...stylex.props(styles.sheet, xstyle)}>{children}</main>;
}

// The compound: the frame carries its pieces. Object.assign (not `Shell.TitleBar = …`) keeps
// TypeScript happy about the properties while preserving the function component's identity.
const Shell = Object.assign(ShellRoot, {
  TitleBar,
  Stage,
  Sheet,
});

export { Shell };
export type { ShellSlotProps, TitleBarProps };
