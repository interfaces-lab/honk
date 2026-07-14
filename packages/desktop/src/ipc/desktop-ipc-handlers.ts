import * as Effect from "effect/Effect";

import * as DesktopIpc from "./desktop-ipc";
import { getAuxEndpoint } from "./methods/aux-endpoint";
import { getOpencodeSidecar } from "./methods/opencode-sidecar";
import { closePty, openPty, resizePty, writePty } from "./methods/pty";
import { getClientSettings, setClientSettings } from "./methods/client-settings";
import { logRendererDiagnostic } from "./methods/renderer-diagnostics";
import { getServerExposureState, setServerExposureMode } from "./methods/server-exposure";
import { checkForUpdate, downloadUpdate, getUpdateState, installUpdate } from "./methods/updates";
import {
  clearBrowserPartitionStorage,
  detectLocalhostPorts,
  expandWindowWidth,
  getAppBranding,
  getBrowserWebviewPreloadPath,
  getWindowChromeState,
  openInEditor,
  openExternal,
  pickFolder,
  registerBrowserAutomationHost,
  setActiveWorkState,
  setBackgroundColor,
  setDisplayZoom,
  setTheme,
  setVibrancy,
  showContextMenu,
  showItemInFolder,
  unregisterBrowserAutomationHost,
} from "./methods/window";

export const installDesktopIpcHandlers = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;

  yield* ipc.handleSync(getAppBranding);
  yield* ipc.handleSync(getBrowserWebviewPreloadPath);
  yield* ipc.handleSync(getWindowChromeState);

  yield* ipc.handle(getClientSettings);
  yield* ipc.handle(setClientSettings);
  yield* ipc.handle(getAuxEndpoint);
  yield* ipc.handle(getOpencodeSidecar);

  yield* ipc.handle(openPty);
  yield* ipc.handle(writePty);
  yield* ipc.handle(resizePty);
  yield* ipc.handle(closePty);

  yield* ipc.handle(getServerExposureState);
  yield* ipc.handle(setServerExposureMode);

  yield* ipc.handle(pickFolder);
  yield* ipc.handle(registerBrowserAutomationHost);
  yield* ipc.handle(unregisterBrowserAutomationHost);
  yield* ipc.handle(detectLocalhostPorts);
  yield* ipc.handle(clearBrowserPartitionStorage);
  yield* ipc.handle(setActiveWorkState);
  yield* ipc.handle(setTheme);
  yield* ipc.handle(setBackgroundColor);
  yield* ipc.handle(setDisplayZoom);
  yield* ipc.handle(expandWindowWidth);
  yield* ipc.handle(setVibrancy);
  yield* ipc.handle(showContextMenu);
  yield* ipc.handle(openExternal);
  yield* ipc.handle(openInEditor);
  yield* ipc.handle(showItemInFolder);

  yield* ipc.handle(getUpdateState);
  yield* ipc.handle(downloadUpdate);
  yield* ipc.handle(installUpdate);
  yield* ipc.handle(checkForUpdate);
  yield* ipc.handle(logRendererDiagnostic);
}).pipe(Effect.withSpan("desktop.ipc.installHandlers"));
