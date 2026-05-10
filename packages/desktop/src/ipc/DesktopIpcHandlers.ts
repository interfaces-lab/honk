import * as Effect from "effect/Effect";

import * as DesktopIpc from "./DesktopIpc";
import { getClientSettings, setClientSettings } from "./methods/clientSettings";
import {
  getSavedEnvironmentRegistry,
  getSavedEnvironmentSecret,
  removeSavedEnvironmentSecret,
  setSavedEnvironmentRegistry,
  setSavedEnvironmentSecret,
} from "./methods/savedEnvironments";
import {
  getServerExposureState,
  setServerExposureMode,
} from "./methods/serverExposure";
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  setUpdateChannel,
} from "./methods/updates";
import {
  confirm,
  getAppBranding,
  getLocalEnvironmentBootstrap,
  getWindowChromeState,
  openExternal,
  pickFolder,
  setTheme,
  showContextMenu,
} from "./methods/window";

export const installDesktopIpcHandlers = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;

  yield* ipc.handleSync(getAppBranding);
  yield* ipc.handleSync(getLocalEnvironmentBootstrap);
  yield* ipc.handleSync(getWindowChromeState);

  yield* ipc.handle(getClientSettings);
  yield* ipc.handle(setClientSettings);
  yield* ipc.handle(getSavedEnvironmentRegistry);
  yield* ipc.handle(setSavedEnvironmentRegistry);
  yield* ipc.handle(getSavedEnvironmentSecret);
  yield* ipc.handle(setSavedEnvironmentSecret);
  yield* ipc.handle(removeSavedEnvironmentSecret);

  yield* ipc.handle(getServerExposureState);
  yield* ipc.handle(setServerExposureMode);

  yield* ipc.handle(pickFolder);
  yield* ipc.handle(confirm);
  yield* ipc.handle(setTheme);
  yield* ipc.handle(showContextMenu);
  yield* ipc.handle(openExternal);

  yield* ipc.handle(getUpdateState);
  yield* ipc.handle(setUpdateChannel);
  yield* ipc.handle(downloadUpdate);
  yield* ipc.handle(installUpdate);
  yield* ipc.handle(checkForUpdate);
}).pipe(Effect.withSpan("desktop.ipc.installHandlers"));
