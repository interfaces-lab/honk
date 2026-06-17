import {
  DEFAULT_SETTINGS_ROUTE,
  DEFAULT_SETTINGS_SEARCH,
  type SettingsRoutePath,
} from "~/components/settings/settings-sections";

const OPEN_SETTINGS_ACTION = "open-settings";

interface DesktopMenuRouter {
  readonly navigate: (options: {
    to: SettingsRoutePath;
    search: typeof DEFAULT_SETTINGS_SEARCH;
  }) => unknown;
}

let uninstallMenuActionBridge: (() => void) | null = null;

export function installDesktopMenuActionBridge(router: DesktopMenuRouter): void {
  if (uninstallMenuActionBridge !== null || typeof window === "undefined") {
    return;
  }

  const bridge = window.desktopBridge;
  if (!bridge) {
    return;
  }

  uninstallMenuActionBridge = bridge.onMenuAction((action) => {
    if (action !== OPEN_SETTINGS_ACTION) {
      return;
    }

    void router.navigate({ to: DEFAULT_SETTINGS_ROUTE, search: DEFAULT_SETTINGS_SEARCH });
  });
}

export function __resetDesktopMenuActionBridgeForTests(): void {
  uninstallMenuActionBridge?.();
  uninstallMenuActionBridge = null;
}
