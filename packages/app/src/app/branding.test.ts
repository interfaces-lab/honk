import { afterEach, describe, expect, it, vi } from "vitest";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  globalThis.window = originalWindow;
});

describe("branding", () => {
  it("uses injected desktop branding when available", async () => {
    vi.resetModules();

    vi.stubGlobal("window", {
      desktopBridge: {
        getAppBranding: () => ({
          baseName: "Multi",
          stageLabel: null,
          displayName: "Multi",
        }),
      },
    });

    const branding = await import("./branding");

    expect(branding.APP_BASE_NAME).toBe("Multi");
    expect(branding.APP_STAGE_LABEL).toBe(null);
    expect(branding.APP_DISPLAY_NAME).toBe("Multi");
  });
});
