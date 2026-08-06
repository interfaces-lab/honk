import * as stylex from "@stylexjs/stylex";
import { colorVars } from "@honk/ui/tokens.stylex";

// The panel divider is a fixed one-pixel inset seam, matching the existing workbench column.
const PANEL_SEPARATOR_SHADOW = `inset 1px 0 0 ${colorVars["--honk-color-border-base"]}`;

const workbenchPanelLayout = stylex.create({
  panel: {
    position: "relative",
    flexShrink: 0,
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    boxShadow: PANEL_SEPARATOR_SHADOW,
  },
  panelMaximized: {
    width: "100%",
    flexGrow: 1,
    minWidth: 0,
  },
  body: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
});

const workbenchPanelSize = stylex.create({
  width: (px: number) => ({ width: `${px}px` }),
});

export { workbenchPanelLayout, workbenchPanelSize };
