import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, type createBrowserHistory } from "@tanstack/react-router";

import "./dev/react-grab";
import "./app/appearance-boot";
import "./local-api";
import "@xterm/xterm/css/xterm.css";
import "./index.css";
import "@honk/multikit/styles.css";
import "./styles/app.css";

import { installDesktopActiveWorkBridge } from "./desktop-active-work-bridge";
import { installDesktopMenuActionBridge } from "./desktop-menu-actions";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./app/branding";

type HonkHistory = ReturnType<typeof createBrowserHistory>;

interface WindowControlsOverlayLike {
  readonly visible: boolean;
  addEventListener(type: "geometrychange", listener: EventListener): void;
}

interface NavigatorWithWindowControlsOverlay extends Navigator {
  readonly windowControlsOverlay?: WindowControlsOverlayLike;
}

export interface MountHonkAppOptions {
  readonly history: HonkHistory;
  readonly isElectron: boolean;
}

function installWindowControlsOverlayMarker(): void {
  if (typeof navigator === "undefined") {
    return;
  }

  const overlay = (navigator as NavigatorWithWindowControlsOverlay).windowControlsOverlay ?? null;
  const updateWindowControlsOverlayClass = () => {
    document.documentElement.classList.toggle("wco", overlay !== null && overlay.visible);
  };

  updateWindowControlsOverlayClass();
  overlay?.addEventListener("geometrychange", updateWindowControlsOverlayClass);
}

export function mountHonkApp(options: MountHonkAppOptions): void {
  const router = getRouter(options.history);

  if (options.isElectron) {
    installWindowControlsOverlayMarker();
  }

  document.title = APP_DISPLAY_NAME;
  installDesktopActiveWorkBridge();
  installDesktopMenuActionBridge(router);

  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Root element #root not found.");
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );
}
