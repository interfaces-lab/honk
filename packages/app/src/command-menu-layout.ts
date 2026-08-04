import { borderVars, colorVars } from "@honk/ui/tokens.stylex";
import type { CSSProperties } from "react";

// Tokens do not name command-menu viewport geometry yet. Keep the popup contract in one module so
// the eager loading frame and deferred interactive menu cannot drift.
const MENU_MAX_WIDTH = "620px";
const MENU_VIEWPORT_WIDTH = "calc(100% - 24px)";
const MENU_TOP = "clamp(72px, 18dvh, 160px)";
const MENU_MAX_HEIGHT = "calc(100dvh - 96px)";
const HAIRLINE = "1px";

const MENU_DIALOG_STYLE: CSSProperties = {
  top: MENU_TOP,
  transform: "translateX(-50%)",
  maxWidth: MENU_MAX_WIDTH,
  width: MENU_VIEWPORT_WIDTH,
  maxHeight: MENU_MAX_HEIGHT,
  padding: 0,
  gap: 0,
  overflow: "hidden",
};

const MENU_DIALOG_TITLE_STYLE: CSSProperties = {
  position: "absolute",
  width: HAIRLINE,
  height: HAIRLINE,
  padding: 0,
  // Negative 1px margin removes the visually-hidden title from layout.
  // oxlint-disable-next-line honk/design-no-raw-values -- accessibility clipping intrinsic; no spacing token owns a one-pixel negative margin
  margin: `calc(${HAIRLINE} * -1)`,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  borderWidth: 0,
};

// Flush search header: quiet hairline only. Field's focus ring would frame only this strip.
const MENU_FIELD_STYLE: CSSProperties = {
  backgroundColor: "transparent",
  borderRadius: 0,
  borderBottomWidth: borderVars["--honk-border-hairline"],
  borderBottomStyle: "solid",
  borderBottomColor: colorVars["--honk-color-border-muted"],
  boxShadow: "none",
  outline: "none",
};

export { MENU_DIALOG_STYLE, MENU_DIALOG_TITLE_STYLE, MENU_FIELD_STYLE };
