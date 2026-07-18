import * as Effect from "effect/Effect";

import * as DesktopIpc from "./desktop-ipc";
import {
  commandBrowserView,
  destroyBrowserView,
  detachBrowserView,
  syncBrowserView,
} from "./methods/browser-view";
import { getAuxEndpoint } from "./methods/aux-endpoint";
import { getOpencodeSidecar } from "./methods/opencode-sidecar";
import { setKeepAwake } from "./methods/power";
import {
  completeOnboarding,
  dismissOnboarding,
  finishOnboarding,
  replayOnboarding,
} from "./methods/onboarding";
import { closePty, openPty, resizePty, writePty } from "./methods/pty";
import { getClientSettings, setClientSettings } from "./methods/client-settings";
import { protectRemoteCredential, revealRemoteCredential } from "./methods/remote-credentials";
import { logRendererDiagnostic } from "./methods/renderer-diagnostics";
import { getRemoteHostState, issueRemotePairing, revokeRemoteDevice } from "./methods/remote-host";
import {
  getServerExposureState,
  setServerExposureMode,
  setServerExposurePublicUrl,
} from "./methods/server-exposure";
import { checkForUpdate, downloadUpdate, getUpdateState, installUpdate } from "./methods/updates";
import {
  expandWindowWidth,
  getAppBranding,
  getWindowChromeState,
  openInEditor,
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
  yield* ipc.handleSync(getWindowChromeState);

  yield* ipc.handle(getClientSettings);
  yield* ipc.handle(setClientSettings);
  yield* ipc.handle(protectRemoteCredential);
  yield* ipc.handle(revealRemoteCredential);
  yield* ipc.handle(getAuxEndpoint);
  yield* ipc.handle(getOpencodeSidecar);
  yield* ipc.handle(completeOnboarding);
  yield* ipc.handle(finishOnboarding);
  yield* ipc.handle(dismissOnboarding);
  yield* ipc.handle(replayOnboarding);

  yield* ipc.handle(openPty);
  yield* ipc.handle(writePty);
  yield* ipc.handle(resizePty);
  yield* ipc.handle(closePty);

  yield* ipc.handle(getServerExposureState);
  yield* ipc.handle(setServerExposureMode);
  yield* ipc.handle(setServerExposurePublicUrl);
  yield* ipc.handle(getRemoteHostState);
  yield* ipc.handle(issueRemotePairing);
  yield* ipc.handle(revokeRemoteDevice);

  yield* ipc.handle(pickFolder);
  yield* ipc.handle(syncBrowserView);
  yield* ipc.handle(detachBrowserView);
  yield* ipc.handle(commandBrowserView);
  yield* ipc.handle(destroyBrowserView);
  yield* ipc.handle(setActiveWorkState);
  yield* ipc.handle(setTheme);
  yield* ipc.handle(setBackgroundColor);
  yield* ipc.handle(setDisplayZoom);
  yield* ipc.handle(setKeepAwake);
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
