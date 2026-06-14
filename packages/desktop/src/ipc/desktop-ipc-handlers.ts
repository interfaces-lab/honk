import * as Effect from "effect/Effect";

import * as DesktopIpc from "./desktop-ipc";
import { getClientSettings, setClientSettings } from "./methods/client-settings";
import {
  abortRuntimeThread,
  configureRuntimeCredential,
  getRuntimeHostSnapshot,
  getRuntimePreferences,
  getRuntimeThreadSessionFile,
  hydrateRuntimeThread,
  listRuntimeSkills,
  respondToRuntimeExtensionUiRequest,
  sendRuntimeTurn,
  setRuntimeThreadFocus,
  updateRuntimePreferences,
} from "./methods/runtime";
import { logRendererDiagnostic } from "./methods/renderer-diagnostics";
import { getServerExposureState, setServerExposureMode } from "./methods/server-exposure";
import { checkForUpdate, downloadUpdate, getUpdateState, installUpdate } from "./methods/updates";
import {
  clearBrowserPartitionStorage,
  detectLocalhostPorts,
  expandWindowWidth,
  getAppBranding,
  getBrowserWebviewPreloadPath,
  getLocalEnvironmentBootstrap,
  getWindowChromeState,
  openExternal,
  pickFolder,
  setActiveWorkState,
  setBackgroundColor,
  setDisplayZoom,
  setTheme,
  setVibrancy,
  showContextMenu,
  showItemInFolder,
} from "./methods/window";

export const installDesktopIpcHandlers = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;

  yield* ipc.handleSync(getAppBranding);
  yield* ipc.handleSync(getBrowserWebviewPreloadPath);
  yield* ipc.handleSync(getLocalEnvironmentBootstrap);
  yield* ipc.handleSync(getWindowChromeState);

  yield* ipc.handle(getClientSettings);
  yield* ipc.handle(setClientSettings);

  yield* ipc.handle(getRuntimeHostSnapshot);
  yield* ipc.handle(getRuntimePreferences);
  yield* ipc.handle(updateRuntimePreferences);
  yield* ipc.handle(configureRuntimeCredential);
  yield* ipc.handle(hydrateRuntimeThread);
  yield* ipc.handle(setRuntimeThreadFocus);
  yield* ipc.handle(sendRuntimeTurn);
  yield* ipc.handle(abortRuntimeThread);
  yield* ipc.handle(respondToRuntimeExtensionUiRequest);
  yield* ipc.handle(listRuntimeSkills);
  yield* ipc.handle(getRuntimeThreadSessionFile);

  yield* ipc.handle(getServerExposureState);
  yield* ipc.handle(setServerExposureMode);

  yield* ipc.handle(pickFolder);
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
  yield* ipc.handle(showItemInFolder);

  yield* ipc.handle(getUpdateState);
  yield* ipc.handle(downloadUpdate);
  yield* ipc.handle(installUpdate);
  yield* ipc.handle(checkForUpdate);
  yield* ipc.handle(logRendererDiagnostic);
}).pipe(Effect.withSpan("desktop.ipc.installHandlers"));
