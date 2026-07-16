/// <reference types="vite/client" />

import { RouterProvider } from "@tanstack/react-router";
import * as React from "react";
import { createRoot } from "react-dom/client";

// Side-effect import: appearance store applies persisted --honk-* vars at module
// init (dials.ts bind-at-import), before React paints.
import "./appearance-store";
import { startConnection } from "./connection-store";
import { installDesktopBridge } from "./desktop-bridge";
import { installHonkDesktopExtensions } from "./desktop-extensions/runtime";
import { router } from "./router";
import { installRemoteServerRestore } from "./server-store";
import { bindRouter, installBrowserAutomationOpenBridge } from "./tab-store";
import { installTabSummarySync } from "./tab-summary-sync";
import { installThreadNotifications } from "./thread-notifications";
import { installUpdatePill } from "./update-pill";

// Bind before first paint so the initial pathname seeds activeKey / opens unknown
// thread routes without a component effect (ADR 0025 §1).
bindRouter(router);
installBrowserAutomationOpenBridge();
installHonkDesktopExtensions();

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
