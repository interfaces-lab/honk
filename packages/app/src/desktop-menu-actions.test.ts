import type { DesktopBridge } from "@multi/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetDesktopMenuActionBridgeForTests,
  installDesktopMenuActionBridge,
} from "./desktop-menu-actions";
import {
  DEFAULT_SETTINGS_ROUTE,
  type SettingsRoutePath,
} from "./components/settings/settings-sections";

const originalWindow = globalThis.window;

function getWindowForTest(): Window & typeof globalThis {
  if (!globalThis.window) {
    globalThis.window = {} as Window & typeof globalThis;
  }
  return globalThis.window;
}

function makeDesktopBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    getAppBranding: () => null,
    getLocalEnvironmentBootstrap: () => null,
    getWindowChromeState: () => ({ fullscreen: false }),
    onWindowChromeState: () => () => undefined,
    setActiveWorkState: async () => undefined,
    getClientSettings: async () => null,
    setClientSettings: async () => undefined,
    getServerExposureState: async () => ({
      mode: "local-only",
      endpointUrl: null,
      advertisedHost: null,
    }),
    setServerExposureMode: async () => ({
      mode: "local-only",
      endpointUrl: null,
      advertisedHost: null,
    }),
    pickFolder: async () => null,
    confirm: async () => true,
    setTheme: async () => undefined,
    setBackgroundColor: async () => undefined,
    setVibrancy: async () => undefined,
    showContextMenu: async () => null,
    openExternal: async () => true,
    onMenuAction: () => () => undefined,
    getUpdateState: async () => {
      throw new Error("getUpdateState not implemented in test");
    },
    checkForUpdate: async () => {
      throw new Error("checkForUpdate not implemented in test");
    },
    downloadUpdate: async () => {
      throw new Error("downloadUpdate not implemented in test");
    },
    installUpdate: async () => {
      throw new Error("installUpdate not implemented in test");
    },
    onUpdateState: () => () => undefined,
    ...overrides,
  };
}

function installBridge(
  navigate: (options: { to: SettingsRoutePath }) => unknown,
): (action: string) => void {
  let menuListener: (action: string) => void = () => undefined;
  getWindowForTest().desktopBridge = makeDesktopBridge({
    onMenuAction: (listener) => {
      menuListener = listener;
      return () => {
        menuListener = () => undefined;
      };
    },
  });

  installDesktopMenuActionBridge({ navigate });
  return (action) => {
    menuListener(action);
  };
}

afterEach(() => {
  __resetDesktopMenuActionBridgeForTests();
  globalThis.window = originalWindow;
});

describe("installDesktopMenuActionBridge", () => {
  it("navigates to settings for the native open-settings menu action", () => {
    const navigate = vi.fn<(options: { to: SettingsRoutePath }) => void>();
    const emitMenuAction = installBridge(navigate);

    emitMenuAction("open-settings");

    expect(navigate).toHaveBeenCalledWith({ to: DEFAULT_SETTINGS_ROUTE });
  });

  it("ignores unrelated native menu actions", () => {
    const navigate = vi.fn<(options: { to: SettingsRoutePath }) => void>();
    const emitMenuAction = installBridge(navigate);

    emitMenuAction("unknown-action");

    expect(navigate).not.toHaveBeenCalled();
  });
});
