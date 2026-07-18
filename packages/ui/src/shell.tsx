// App chrome frame. colorScheme on the scope drives light-dark token arms.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import {
  colorVars,
  controlVars,
  electronGlassWorkbenchTheme,
  elevationVars,
  fontVars,
  radiusVars,
  shellVars,
  spaceVars,
  workbenchSurfaceVars,
} from "./tokens.stylex";

const styles = stylex.create({
  frame: {
    height: "100dvh",
    display: "flex",
    flexDirection: "column",
    // Default colorScheme is light dark so the OS picks the token arm. Pin light or dark to override.
    colorScheme: "light dark",
    backgroundColor: workbenchSurfaceVars["--honk-workbench-root-background"],
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
  },
  textRasterization: {
    WebkitFontSmoothing: fontVars["--honk-font-smoothing"],
    MozOsxFontSmoothing: fontVars["--honk-font-smoothing-moz"],
  },
  titleBar: {
    height: shellVars["--honk-shell-titlebar-h"],
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    paddingTop: shellVars["--honk-shell-titlebar-seat"],
    paddingLeft: shellVars["--honk-shell-inset-left"],
    paddingRight: spaceVars["--honk-space-panel-pad"],
    columnGap: controlVars["--honk-control-gap"],
    // No own background: the titlebar is part of the single backdrop the frame paints
    // (root-background), so the titlebar / stage-gutter boundary can never seam.
  },
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
    padding: spaceVars["--honk-space-gutter"],
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
    backgroundColor: workbenchSurfaceVars["--honk-workbench-pane-background"],
    borderRadius: radiusVars["--honk-radius-panel"],
    boxShadow: elevationVars["--honk-elevation-raised"],
    overflow: "hidden",
    contain: "strict",
  },
});

interface ShellSlotProps {
  children?: React.ReactNode;
  style?: StyleProp<HonkStyle>;
}

interface ShellRootProps extends ShellSlotProps {
  material?: "solid" | "glass";
}

function ShellRoot({ children, material = "solid", style }: ShellRootProps): React.ReactElement {
  return (
    <div
      {...applyStyle(
        stylex.props(
          styles.frame,
          styles.textRasterization,
          material === "glass" && electronGlassWorkbenchTheme,
        ),
        style,
      )}
    >
      {children}
    </div>
  );
}

interface TitleBarProps extends ShellSlotProps {
  trailing?: React.ReactNode;
}

function TitleBar({ children, trailing, style }: TitleBarProps): React.ReactElement {
  return (
    <div data-shell-drag-region="" {...applyStyle(stylex.props(styles.titleBar), style)}>
      {children}
      {trailing != null && <div {...stylex.props(styles.titleBarTrailing)}>{trailing}</div>}
    </div>
  );
}

function Stage({ children, style }: ShellSlotProps): React.ReactElement {
  return <div {...applyStyle(stylex.props(styles.stage), style)}>{children}</div>;
}

function Sheet({ children, style }: ShellSlotProps): React.ReactElement {
  return <main {...applyStyle(stylex.props(styles.sheet), style)}>{children}</main>;
}

const Shell = Object.assign(ShellRoot, {
  TitleBar,
  Stage,
  Sheet,
});

export { Shell };
export type { ShellRootProps, ShellSlotProps, TitleBarProps };
