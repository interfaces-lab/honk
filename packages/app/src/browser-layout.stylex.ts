import * as stylex from "@stylexjs/stylex";
import { borderVars, colorVars, spaceVars } from "@honk/ui/tokens.stylex";

const browserLayout = stylex.create({
  root: {
    width: "100%",
    height: "100%",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  toolbar: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-gutter"],
    borderBlockEndWidth: borderVars["--honk-border-hairline"],
    borderBlockEndStyle: "solid",
    borderBlockEndColor: colorVars["--honk-color-border-muted"],
  },
  location: {
    flexGrow: 1,
    minWidth: 0,
  },
  host: {
    position: "relative",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    overflow: "hidden",
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
  center: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
});

export { browserLayout };
