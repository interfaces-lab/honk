import * as stylex from "@stylexjs/stylex";
import { shellVars, sidebarVars } from "@honk/ui/tokens.stylex";

const verticalSidebarLayout = stylex.create({
  root: {
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: "transparent",
  },
  // Permanent traffic-light seat shared by the final view and its loading state.
  topBar: {
    height: shellVars["--honk-shell-titlebar-h"],
    flexShrink: 0,
    paddingTop: shellVars["--honk-shell-titlebar-seat"],
  },
  navigation: {
    position: "relative",
    minHeight: 0,
    flexGrow: 1,
    overflowY: "auto",
    paddingInline: sidebarVars["--honk-sidebar-gutter-inline"],
    paddingBlockStart: sidebarVars["--honk-sidebar-gutter-inline"],
    paddingBlockEnd: sidebarVars["--honk-sidebar-gutter-inline"],
  },
  navigationContent: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: sidebarVars["--honk-sidebar-section-gap"],
  },
  footer: {
    flexShrink: 0,
    paddingInline: sidebarVars["--honk-sidebar-gutter-inline"],
    paddingBlock: sidebarVars["--honk-sidebar-gutter-inline"],
  },
});

export { verticalSidebarLayout };
