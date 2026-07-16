import { afterEach, describe, expect, it, vi } from "vitest";

import { readDesktopBrowserAvailability } from "./desktop-bridge";

afterEach(() => vi.unstubAllGlobals());

describe("desktop browser bridge", () => {
  it("distinguishes web from a desktop preload that needs restarting", () => {
    vi.stubGlobal("window", {});
    expect(readDesktopBrowserAvailability().status).toBe("web");

    vi.stubGlobal("window", { desktopBridge: { getWindowID: () => "main" } });
    expect(readDesktopBrowserAvailability().status).toBe("restart-required");
  });

  it("accepts the canonical WebContentsView bridge as one capability", () => {
    const bridge = {
      syncBrowserView: vi.fn(),
      detachBrowserView: vi.fn(),
      commandBrowserView: vi.fn(),
      destroyBrowserView: vi.fn(),
      onBrowserViewState: vi.fn(),
      onBrowserAutomationOpen: vi.fn(),
    };
    vi.stubGlobal("window", { desktopBridge: bridge });

    expect(readDesktopBrowserAvailability()).toEqual({ status: "ready", bridge });
  });
});
