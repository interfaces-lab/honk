import * as stylex from "@stylexjs/stylex";
import { colorVars, controlVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";

const workbenchTerminalLayout = stylex.create({
  root: {
    position: "relative",
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    padding: spaceVars["--honk-space-gutter"],
    color: colorVars["--honk-color-text-primary"],
    backgroundColor: colorVars["--honk-color-bg-deep"],
    fontFamily: fontVars["--honk-font-family-mono"],
  },
  terminalArea: {
    position: "relative",
    flexGrow: 1,
    minHeight: 0,
  },
  center: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: controlVars["--honk-control-gap"],
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
});

export { workbenchTerminalLayout };
