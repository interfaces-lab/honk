import { describe, expect, it } from "vitest";

import {
  BASE_UI_FONT_PX,
  TARGET_UI_TEXT_LINE_HEIGHT_PX,
  uiFontSizeToElectronZoomLevel,
  uiFontSizeToNormalizedLineHeight,
  uiFontSizeToZoomFactor,
} from "./display-zoom";

describe("uiFontSizeToZoomFactor", () => {
  it("returns 1 at the base font size", () => {
    expect(uiFontSizeToZoomFactor(BASE_UI_FONT_PX)).toBe(1);
  });

  it("scales down at the minimum setting", () => {
    expect(uiFontSizeToZoomFactor(11)).toBeCloseTo(0.84, 5);
  });

  it("scales up at the maximum setting", () => {
    expect(uiFontSizeToZoomFactor(16)).toBeCloseTo(1.24, 5);
  });

  it("clamps out-of-range values", () => {
    expect(uiFontSizeToZoomFactor(8)).toBeCloseTo(0.84, 5);
    expect(uiFontSizeToZoomFactor(20)).toBeCloseTo(1.24, 5);
  });
});

describe("uiFontSizeToElectronZoomLevel", () => {
  it("returns 0 at the base font size", () => {
    expect(uiFontSizeToElectronZoomLevel(BASE_UI_FONT_PX)).toBeCloseTo(0, 5);
  });

  it("returns positive levels above base", () => {
    expect(uiFontSizeToElectronZoomLevel(16)).toBeGreaterThan(0);
  });

  it("returns negative levels below base", () => {
    expect(uiFontSizeToElectronZoomLevel(11)).toBeLessThan(0);
  });
});

describe("uiFontSizeToNormalizedLineHeight", () => {
  it("keeps the base font near the target visual line height", () => {
    expect(uiFontSizeToNormalizedLineHeight(BASE_UI_FONT_PX) * BASE_UI_FONT_PX).toBeCloseTo(
      TARGET_UI_TEXT_LINE_HEIGHT_PX,
      5,
    );
  });

  it("accounts for display zoom from the font-size preference", () => {
    const zoomFactor = uiFontSizeToZoomFactor(16);

    expect(
      uiFontSizeToNormalizedLineHeight(16) * BASE_UI_FONT_PX * zoomFactor,
    ).toBeCloseTo(TARGET_UI_TEXT_LINE_HEIGHT_PX, 5);
  });
});
