const OPEN_SETTINGS_ACTION = "open-settings";

interface DesktopMenuRouter {
  readonly navigate: (options: { to: "/settings/general" }) => unknown;
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

    void router.navigate({ to: "/settings/general" });
  });
}

export function __resetDesktopMenuActionBridgeForTests(): void {
  uninstallMenuActionBridge?.();
  uninstallMenuActionBridge = null;
}
