import type * as React from "react";

const SETTINGS_DIALOG_VIEWPORT_GUTTER = "48px";
const SETTINGS_DIALOG_MAX_WIDTH = "920px";
const SETTINGS_DIALOG_HEIGHT = `min(744px, calc(100dvh - ${SETTINGS_DIALOG_VIEWPORT_GUTTER}))`;
const VISUALLY_HIDDEN_TITLE_SIZE = "1px";

const SETTINGS_DIALOG_STYLE: React.CSSProperties = {
  width: `calc(100% - ${SETTINGS_DIALOG_VIEWPORT_GUTTER})`,
  maxWidth: SETTINGS_DIALOG_MAX_WIDTH,
  height: SETTINGS_DIALOG_HEIGHT,
  maxHeight: SETTINGS_DIALOG_HEIGHT,
  padding: 0,
  gap: 0,
  overflow: "hidden",
};

const SETTINGS_DIALOG_TITLE_STYLE: React.CSSProperties = {
  position: "absolute",
  width: VISUALLY_HIDDEN_TITLE_SIZE,
  height: VISUALLY_HIDDEN_TITLE_SIZE,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

export { SETTINGS_DIALOG_STYLE, SETTINGS_DIALOG_TITLE_STYLE };
