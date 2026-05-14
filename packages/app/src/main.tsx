import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";
import { Agentation } from "agentation";

import "./appearance-boot";
import "@xterm/xterm/css/xterm.css";
import "./index.css";
import "./styles/tokens.css";
import "./styles/app.css";

import { isElectron } from "./env";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";
import { syncDocumentWindowControlsOverlayClass } from "./lib/window-controls-overlay";
import { installBrowserDebugTracing, traceBrowserEvent } from "./observability/browserDebug";

const history = isElectron ? createHashHistory() : createBrowserHistory();

installBrowserDebugTracing();
traceBrowserEvent("app.main.start", {
  mode: isElectron ? "electron" : "browser",
});

const router = getRouter(history);

if (isElectron) {
  syncDocumentWindowControlsOverlayClass();
}

document.title = APP_DISPLAY_NAME;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
    {import.meta.env.DEV ? <Agentation /> : null}
  </React.StrictMode>,
);
traceBrowserEvent("app.main.render-mounted");
