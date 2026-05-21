import { describe, expect, it } from "vitest";

import { resolveDesktopAppBranding, resolveDesktopAppStageLabel } from "../../src/app-branding";

describe("resolveDesktopAppStageLabel", () => {
  it("uses Dev in desktop development", () => {
    expect(
      resolveDesktopAppStageLabel({
        isDevelopment: true,
      }),
    ).toBe("Dev");
  });

  it("uses no stage label for packaged builds", () => {
    expect(
      resolveDesktopAppStageLabel({
        isDevelopment: false,
      }),
    ).toBe(null);
  });

  it("uses no stage label for packaged stable builds", () => {
    expect(
      resolveDesktopAppStageLabel({
        isDevelopment: false,
      }),
    ).toBe(null);
  });
});

describe("resolveDesktopAppBranding", () => {
  it("returns a complete desktop branding payload", () => {
    expect(
      resolveDesktopAppBranding({
        isDevelopment: false,
      }),
    ).toEqual({
      baseName: "Multi",
      stageLabel: null,
      displayName: "Multi",
    });
  });
});
