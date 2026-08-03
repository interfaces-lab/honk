import { describe, expect, it } from "vitest";

import { trayScrollEdges } from "./tray-scroll";

describe("tray scroll edges", () => {
  it("keeps both edges clear without an overflowing range", () => {
    expect(trayScrollEdges(0, 1)).toEqual({ startOpacity: 0, endOpacity: 0 });
  });

  it("starts with only the bottom edge visible", () => {
    expect(trayScrollEdges(0, 100)).toEqual({ startOpacity: 0, endOpacity: 1 });
  });

  it("ramps each edge over 24 pixels", () => {
    expect(trayScrollEdges(12, 24)).toEqual({ startOpacity: 0.5, endOpacity: 0.5 });
  });

  it("ends with only the top edge visible", () => {
    expect(trayScrollEdges(100, 100)).toEqual({ startOpacity: 1, endOpacity: 0 });
  });
});
