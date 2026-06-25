export const BASE_UI_FONT_PX = 13;
export const UI_FONT_SIZE_MIN = 11;
export const UI_FONT_SIZE_MAX = 16;
export const TARGET_UI_TEXT_LINE_HEIGHT_PX = 20;
/** Cursor display-font zoom step: _q_=8 with baseline wq_=100. */
export const ZOOM_STEP_PER_PX = 8;
/** Cursor Electron zoom level base: Sq_=1.2. */
export const ELECTRON_ZOOM_LEVEL_BASE = 1.2;

function clampUiFontSize(px: number): number {
  if (!Number.isFinite(px)) return BASE_UI_FONT_PX;
  return Math.min(UI_FONT_SIZE_MAX, Math.max(UI_FONT_SIZE_MIN, Math.round(px)));
}

/** Maps stored UI font size to a window zoom factor (1.0 at 13px). */
export function uiFontSizeToZoomFactor(px: number): number {
  const clamped = clampUiFontSize(px);
  return (100 + (clamped - BASE_UI_FONT_PX) * ZOOM_STEP_PER_PX) / 100;
}

/** Cursor applies zoom via log-scaled Electron zoom levels. */
export function uiFontSizeToElectronZoomLevel(px: number): number {
  const factor = uiFontSizeToZoomFactor(px);
  if (factor <= 0) return 0;
  return Math.log(factor) / Math.log(ELECTRON_ZOOM_LEVEL_BASE);
}

/** Keeps unitless conversation leading near a 20px visual line height after display zoom. */
export function uiFontSizeToNormalizedLineHeight(px: number): number {
  const visualFontSize = BASE_UI_FONT_PX * uiFontSizeToZoomFactor(px);
  return TARGET_UI_TEXT_LINE_HEIGHT_PX / visualFontSize;
}
