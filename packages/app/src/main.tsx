/// <reference types="vite/client" />

if (import.meta.env.DEV) {
  void import("react-grab");
}

import { RouterProvider } from "@tanstack/react-router";
import * as React from "react";
import { createRoot } from "react-dom/client";

// Importing the appearance store applies persisted --honk-* vars at module init
// (dials.ts bind-at-import), before React paints.
import { actions as appearanceActions } from "./appearance-store";
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
import { preloadV2Page } from "./v2-route";

// Bind before first paint so the initial pathname seeds activeKey / opens unknown
// thread routes without a component effect (ADR 0025 §1).
bindRouter(router);
preloadV2Page(window.location.pathname);
installBrowserAutomationOpenBridge();
installTerminalOpenBridge();
installHonkDesktopExtensions();
subscribeDesktopMenuAction((action) => {
  if (action === "open-settings") settingsActions.open();
  if (action === "increase-font-sizes") appearanceActions.stepFontSizes(1);
  if (action === "decrease-font-sizes") appearanceActions.stepFontSizes(-1);
  if (action === "reset-font-sizes") appearanceActions.resetFontSizes();
});

// Desktop update IPC → titlebar pill store. No-op when the bridge is absent.
installUpdatePill();

// Workspace watch → attention/completion toasts + OS notifications.
// Subscribes at module altitude (ADR 0025); safe before the client binds.
installThreadNotifications();

// Workspace summaries keep titles/status glyphs current, including Home's
// worst-status rollup. Installed before connect; the registry opens it when the
// authenticated client binds.
installTabSummarySync();

// Electron-only: platform attribute and sidecar endpoint handoff. The supervisor's
// {url, password} arrive once OpenCode reports healthy. Web resolves immediately.
// startConnection runs after; React mounts in parallel and shows connecting until ready.
void installDesktopBridge().then(() => {
  installRemoteServerRestore();
  startConnection();
});

const rootEl = document.getElementById("root");

if (rootEl === null) {
  throw new Error("index.html must provide #root");
}

createRoot(rootEl).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
