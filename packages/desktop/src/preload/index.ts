import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent,
} from "electron";
import type {
  DesktopAppBranding,
  DesktopBridge,
  DesktopEnvironmentBootstrap,
  DesktopUpdateState,
  DesktopWindowChromeState,
  MultiRuntimeHostEvent,
  MultiRuntimeApi,
} from "@multi/contracts";

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const SET_BACKGROUND_COLOR_CHANNEL = "desktop:set-background-color";
const SET_VIBRANCY_CHANNEL = "desktop:set-vibrancy";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const GET_APP_BRANDING_CHANNEL = "desktop:get-app-branding";
const GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL = "desktop:get-local-environment-bootstrap";
const GET_WINDOW_CHROME_STATE_CHANNEL = "desktop:get-window-chrome-state";
const WINDOW_CHROME_STATE_CHANNEL = "desktop:window-chrome-state";
const SET_ACTIVE_WORK_STATE_CHANNEL = "desktop:set-active-work-state";
const GET_CLIENT_SETTINGS_CHANNEL = "desktop:get-client-settings";
const SET_CLIENT_SETTINGS_CHANNEL = "desktop:set-client-settings";
const GET_SERVER_EXPOSURE_STATE_CHANNEL = "desktop:get-server-exposure-state";
const SET_SERVER_EXPOSURE_MODE_CHANNEL = "desktop:set-server-exposure-mode";
const RUNTIME_GET_HOST_SNAPSHOT_CHANNEL = "desktop:runtime-get-host-snapshot";
const RUNTIME_GET_PREFERENCES_CHANNEL = "desktop:runtime-get-preferences";
const RUNTIME_UPDATE_PREFERENCES_CHANNEL = "desktop:runtime-update-preferences";
const RUNTIME_CONFIGURE_CREDENTIAL_CHANNEL = "desktop:runtime-configure-credential";
const RUNTIME_HYDRATE_THREAD_CHANNEL = "desktop:runtime-hydrate-thread";
const RUNTIME_SEND_TURN_CHANNEL = "desktop:runtime-send-turn";
const RUNTIME_ABORT_CHANNEL = "desktop:runtime-abort";
const RUNTIME_RESPOND_EXTENSION_UI_CHANNEL = "desktop:runtime-respond-extension-ui";
const RUNTIME_HOST_EVENT_CHANNEL = "desktop:runtime-host-event";

const desktopRuntimeApi = {
  getHostSnapshot: () => ipcRenderer.invoke(RUNTIME_GET_HOST_SNAPSHOT_CHANNEL),
  getPreferences: () => ipcRenderer.invoke(RUNTIME_GET_PREFERENCES_CHANNEL),
  updatePreferences: (patch) => ipcRenderer.invoke(RUNTIME_UPDATE_PREFERENCES_CHANNEL, patch),
  configureCredential: (input) => ipcRenderer.invoke(RUNTIME_CONFIGURE_CREDENTIAL_CHANNEL, input),
  hydrateThread: (input) => ipcRenderer.invoke(RUNTIME_HYDRATE_THREAD_CHANNEL, input),
  sendTurn: (input) => ipcRenderer.invoke(RUNTIME_SEND_TURN_CHANNEL, input),
  abort: (input) => ipcRenderer.invoke(RUNTIME_ABORT_CHANNEL, input),
  respondToExtensionUiRequest: (input) =>
    ipcRenderer.invoke(RUNTIME_RESPOND_EXTENSION_UI_CHANNEL, input),
  onHostEvent: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, hostEvent: MultiRuntimeHostEvent) => {
      listener(hostEvent);
    };

    ipcRenderer.on(RUNTIME_HOST_EVENT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(RUNTIME_HOST_EVENT_CHANNEL, wrappedListener);
    };
  },
} satisfies MultiRuntimeApi;

function readWindowChromeState(): DesktopWindowChromeState {
  const state: unknown = ipcRenderer.sendSync(GET_WINDOW_CHROME_STATE_CHANNEL);
  if (
    typeof state === "object" &&
    state !== null &&
    typeof Reflect.get(state, "fullscreen") === "boolean"
  ) {
    return state as DesktopWindowChromeState;
  }
  return { fullscreen: false };
}

contextBridge.exposeInMainWorld("desktopBridge", {
  getAppBranding: () => {
    const result: unknown = ipcRenderer.sendSync(GET_APP_BRANDING_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as DesktopAppBranding;
  },
  getLocalEnvironmentBootstrap: () => {
    const result: unknown = ipcRenderer.sendSync(GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as DesktopEnvironmentBootstrap;
  },
  getWindowChromeState: readWindowChromeState,
  onWindowChromeState: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, state: DesktopWindowChromeState) => {
      listener(state);
    };

    ipcRenderer.on(WINDOW_CHROME_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(WINDOW_CHROME_STATE_CHANNEL, wrappedListener);
    };
  },
  setActiveWorkState: (state) => ipcRenderer.invoke(SET_ACTIVE_WORK_STATE_CHANNEL, state),
  getClientSettings: () => ipcRenderer.invoke(GET_CLIENT_SETTINGS_CHANNEL),
  setClientSettings: (settings) => ipcRenderer.invoke(SET_CLIENT_SETTINGS_CHANNEL, settings),
  getServerExposureState: () => ipcRenderer.invoke(GET_SERVER_EXPOSURE_STATE_CHANNEL),
  setServerExposureMode: (mode) => ipcRenderer.invoke(SET_SERVER_EXPOSURE_MODE_CHANNEL, mode),
  pickFolder: (options) => ipcRenderer.invoke(PICK_FOLDER_CHANNEL, options),
  confirm: (message) => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  setBackgroundColor: (color) => ipcRenderer.invoke(SET_BACKGROUND_COLOR_CHANNEL, color),
  setVibrancy: (enabled) => ipcRenderer.invoke(SET_VIBRANCY_CHANNEL, enabled),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  checkForUpdate: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, state: DesktopUpdateState) => {
      listener(state);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  runtime: desktopRuntimeApi,
} satisfies DesktopBridge);

contextBridge.exposeInMainWorld("multiRuntime", desktopRuntimeApi);
