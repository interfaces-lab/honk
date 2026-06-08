import * as Effect from "effect/Effect";

import * as DesktopIpc from "./desktop-ipc";
import { getClientSettings, setClientSettings } from "./methods/client-settings";
import {
  abortRuntimeThread,
  configureRuntimeCredential,
  getRuntimeHostSnapshot,
  getRuntimePreferences,
  hydrateRuntimeThread,
  installRuntimeHostEventBridge,
  installRuntimeIngestion,
  respondToRuntimeExtensionUiRequest,
  sendRuntimeTurn,
  updateRuntimePreferences,
} from "./methods/runtime";
import { logRendererDiagnostic } from "./methods/renderer-diagnostics";
import { getServerExposureState, setServerExposureMode } from "./methods/server-exposure";
import { checkForUpdate, downloadUpdate, getUpdateState, installUpdate } from "./methods/updates";
import {
  confirm,
  getAppBranding,
  getLocalEnvironmentBootstrap,
  getWindowChromeState,
  openExternal,
  pickFolder,
  setActiveWorkState,
  setBackgroundColor,
  setTheme,
  setVibrancy,
  showContextMenu,
} from "./methods/window";

export const installDesktopIpcHandlers = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;

  yield* ipc.handleSync(getAppBranding);
  yield* ipc.handleSync(getLocalEnvironmentBootstrap);
  yield* ipc.handleSync(getWindowChromeState);
  yield* installRuntimeIngestion;
  yield* installRuntimeHostEventBridge;

  yield* ipc.handle(getClientSettings);
  yield* ipc.handle(setClientSettings);

  yield* ipc.handle(getRuntimeHostSnapshot);
  yield* ipc.handle(getRuntimePreferences);
  yield* ipc.handle(updateRuntimePreferences);
  yield* ipc.handle(configureRuntimeCredential);
  yield* ipc.handle(hydrateRuntimeThread);
  yield* ipc.handle(sendRuntimeTurn);
  yield* ipc.handle(abortRuntimeThread);
  yield* ipc.handle(respondToRuntimeExtensionUiRequest);

  yield* ipc.handle(getServerExposureState);
  yield* ipc.handle(setServerExposureMode);

  yield* ipc.handle(pickFolder);
  yield* ipc.handle(confirm);
  yield* ipc.handle(setActiveWorkState);
  yield* ipc.handle(setTheme);
  yield* ipc.handle(setBackgroundColor);
  yield* ipc.handle(setVibrancy);
  yield* ipc.handle(showContextMenu);
  yield* ipc.handle(openExternal);

  yield* ipc.handle(getUpdateState);
  yield* ipc.handle(downloadUpdate);
  yield* ipc.handle(installUpdate);
  yield* ipc.handle(checkForUpdate);
  yield* ipc.handle(logRendererDiagnostic);
}).pipe(Effect.withSpan("desktop.ipc.installHandlers"));
