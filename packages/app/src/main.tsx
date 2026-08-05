/// <reference types="vite/client" />

import * as React from "react";
import { createRoot } from "react-dom/client";

import { StartupShell } from "./startup-shell";

const rootEl = document.getElementById("root");

if (rootEl === null) {
  throw new Error("index.html must provide #root");
}

const root = createRoot(rootEl);
const isDesktopWorkspace =
  document.documentElement.getAttribute("data-shell-platform") === "electron" &&
  window.location.pathname !== "/setup" &&
  // The core chat surface renders bare, without the opencode startup shell.
  window.location.pathname !== "/v2" &&
  !window.location.pathname.startsWith("/v2/");

const loadApplication = (): void => {
  void import("./start-app").then(({ startApp }) => {
    startApp(root);
  });
};

if (isDesktopWorkspace) {
  root.render(<StartupShell />);
  // Leave one compositor opportunity between the permanent shell and the
  // authenticated application graph. This affects cold interactivity by at
  // most one frame and does not add work to steady-state rendering.
  requestAnimationFrame(loadApplication);
} else {
  loadApplication();
}
