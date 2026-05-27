if (import.meta.env.DEV) {
  void import("./dev/react-grab");
}

import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "./app/appearance-boot";
import "@xterm/xterm/css/xterm.css";
import "./index.css";
import "./styles/tokens.css";
import "./styles/app.css";

import { isElectron } from "./env";
import { installDesktopActiveWorkBridge } from "./desktop-active-work";
import { installDesktopMenuActionBridge } from "./desktop-menu-actions";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./app/branding";

interface WindowControlsOverlayLike {
  readonly visible: boolean;
  addEventListener(type: "geometrychange", listener: EventListener): void;
}

interface NavigatorWithWindowControlsOverlay extends Navigator {
  readonly windowControlsOverlay?: WindowControlsOverlayLike;
}

const history = isElectron ? createHashHistory() : createBrowserHistory();
const router = getRouter(history);

if (isElectron && typeof navigator !== "undefined") {
  const overlay = (navigator as NavigatorWithWindowControlsOverlay).windowControlsOverlay ?? null;
  const updateWindowControlsOverlayClass = () => {
    document.documentElement.classList.toggle("wco", overlay !== null && overlay.visible);
  };

  updateWindowControlsOverlayClass();
  overlay?.addEventListener("geometrychange", updateWindowControlsOverlayClass);
}

document.title = APP_DISPLAY_NAME;
installDesktopActiveWorkBridge();
installDesktopMenuActionBridge(router);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
