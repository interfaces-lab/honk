import { RouterProvider } from "@tanstack/react-router";
import * as React from "react";
import type { Root } from "react-dom/client";

// Importing the appearance store applies persisted --honk-* vars at module init
// (dials.ts bind-at-import), before the full application replaces the startup shell.
import { actions as appearanceActions } from "./appearance-store";
import { startHonkCore } from "./chat/client";
import { startConnection } from "./connection-store";
import { installDesktopBridge, subscribeDesktopMenuAction } from "./desktop-bridge";
import { installHonkDesktopExtensions } from "./desktop-extensions/runtime";
import { router } from "./router";
import { installRemoteServerRestore } from "./server-store";
import { actions as settingsActions } from "./settings-store";
import {
  bindRouter,
  installBrowserAutomationOpenBridge,
  installTerminalOpenBridge,
} from "./tab-store";
import { installTabSummarySync } from "./tab-summary-sync";
import { installThreadNotifications } from "./thread-notifications";
import { installUpdatePill } from "./update-pill";

function installDevelopmentTools(): void {
  if (!import.meta.env.DEV) {
    return;
  }

  const install = () => {
    void import("react-grab");
    const picker = document.createElement("script");
    picker.src = "https://ui.sh/ui-picker.js";
    picker.async = true;
    document.body.append(picker);
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(install, { timeout: 2_000 });
  } else {
    setTimeout(install, 0);
  }
}

function startApp(root: Root): void {
  // Bind before the full application paint so the initial pathname seeds
  // activeKey / opens unknown thread routes without a component effect.
  bindRouter(router);
  installBrowserAutomationOpenBridge();
  installTerminalOpenBridge();
  installHonkDesktopExtensions();
  subscribeDesktopMenuAction((action) => {
    if (action === "open-settings") settingsActions.open();
    if (action === "increase-font-sizes") appearanceActions.stepFontSizes(1);
    if (action === "decrease-font-sizes") appearanceActions.stepFontSizes(-1);
    if (action === "reset-font-sizes") appearanceActions.resetFontSizes();
  });

  installUpdatePill();
  installThreadNotifications();
  installTabSummarySync();

  // React can render the connection shell while the desktop bridge waits for
  // the sidecar endpoint. Dynamic application content remains gated as before.
  void installDesktopBridge().then(() => {
    installRemoteServerRestore();
    startConnection();
    // Honk Core connects beside opencode, not behind it: the chat surface
    // needs no opencode authentication.
    startHonkCore();
  });

  root.render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );
  installDevelopmentTools();
}

export { startApp };
