import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  BrowserAutomationOpenRequest,
  BrowserAutomationRegisterInput,
  BrowserAutomationUnregisterInput,
  DesktopAppBranding,
  DesktopBridge,
  DesktopEnvironmentBootstrap,
  DesktopRendererDiagnosticInput,
  DesktopUpdateState,
  DesktopWindowChromeState,
  HonkRuntimeHostEvent,
  HonkRuntimeApi,
} from "@honk/contracts";

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const SET_THEME_CHANNEL = "desktop:set-theme";
const SET_BACKGROUND_COLOR_CHANNEL = "desktop:set-background-color";
const SET_VIBRANCY_CHANNEL = "desktop:set-vibrancy";
const SET_DISPLAY_ZOOM_CHANNEL = "desktop:set-display-zoom";
const EXPAND_WINDOW_WIDTH_CHANNEL = "desktop:expand-window-width";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const SHOW_ITEM_IN_FOLDER_CHANNEL = "desktop:show-item-in-folder";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const GET_APP_BRANDING_CHANNEL = "desktop:get-app-branding";
const GET_BROWSER_WEBVIEW_PRELOAD_PATH_CHANNEL = "desktop:get-browser-webview-preload-path";
const REGISTER_BROWSER_AUTOMATION_HOST_CHANNEL = "desktop:register-browser-automation-host";
const UNREGISTER_BROWSER_AUTOMATION_HOST_CHANNEL = "desktop:unregister-browser-automation-host";
const BROWSER_AUTOMATION_OPEN_CHANNEL = "desktop:browser-automation-open";
const DETECT_LOCALHOST_PORTS_CHANNEL = "desktop:detect-localhost-ports";
const CLEAR_BROWSER_PARTITION_STORAGE_CHANNEL = "desktop:clear-browser-partition-storage";
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
const RUNTIME_CLONE_THREAD_CHANNEL = "desktop:runtime-clone-thread";
const RUNTIME_SET_THREAD_FOCUS_CHANNEL = "desktop:runtime-set-thread-focus";
const RUNTIME_SEND_TURN_CHANNEL = "desktop:runtime-send-turn";
const RUNTIME_ENQUEUE_FOLLOW_UP_CHANNEL = "desktop:runtime-enqueue-follow-up";
const RUNTIME_UPDATE_QUEUED_FOLLOW_UP_CHANNEL = "desktop:runtime-update-queued-follow-up";
const RUNTIME_REMOVE_QUEUED_FOLLOW_UP_CHANNEL = "desktop:runtime-remove-queued-follow-up";
const RUNTIME_REORDER_QUEUED_FOLLOW_UP_CHANNEL = "desktop:runtime-reorder-queued-follow-up";
const RUNTIME_SEND_QUEUED_FOLLOW_UP_NOW_CHANNEL = "desktop:runtime-send-queued-follow-up-now";
const RUNTIME_COMPACT_THREAD_CHANNEL = "desktop:runtime-compact-thread";
const RUNTIME_ABORT_CHANNEL = "desktop:runtime-abort";
const RUNTIME_RESPOND_EXTENSION_UI_CHANNEL = "desktop:runtime-respond-extension-ui";
const RUNTIME_LIST_SKILLS_CHANNEL = "desktop:runtime-list-skills";
const RUNTIME_GET_THREAD_SESSION_FILE_CHANNEL = "desktop:runtime-get-thread-session-file";
const RUNTIME_HOST_EVENT_CHANNEL = "desktop:runtime-host-event";
const LOG_RENDERER_DIAGNOSTIC_CHANNEL = "desktop:log-renderer-diagnostic";

const desktopRuntimeApi = {
  getHostSnapshot: () => ipcRenderer.invoke(RUNTIME_GET_HOST_SNAPSHOT_CHANNEL),
  getPreferences: () => ipcRenderer.invoke(RUNTIME_GET_PREFERENCES_CHANNEL),
  updatePreferences: (patch) => ipcRenderer.invoke(RUNTIME_UPDATE_PREFERENCES_CHANNEL, patch),
  configureCredential: (input) => ipcRenderer.invoke(RUNTIME_CONFIGURE_CREDENTIAL_CHANNEL, input),
  hydrateThread: (input) => ipcRenderer.invoke(RUNTIME_HYDRATE_THREAD_CHANNEL, input),
  cloneThread: (input) => ipcRenderer.invoke(RUNTIME_CLONE_THREAD_CHANNEL, input),
  setThreadFocus: (input) => ipcRenderer.invoke(RUNTIME_SET_THREAD_FOCUS_CHANNEL, input),
  sendTurn: (input) => ipcRenderer.invoke(RUNTIME_SEND_TURN_CHANNEL, input),
  enqueueFollowUp: (input) => ipcRenderer.invoke(RUNTIME_ENQUEUE_FOLLOW_UP_CHANNEL, input),
  updateQueuedFollowUp: (input) =>
    ipcRenderer.invoke(RUNTIME_UPDATE_QUEUED_FOLLOW_UP_CHANNEL, input),
  removeQueuedFollowUp: (input) =>
    ipcRenderer.invoke(RUNTIME_REMOVE_QUEUED_FOLLOW_UP_CHANNEL, input),
  reorderQueuedFollowUp: (input) =>
    ipcRenderer.invoke(RUNTIME_REORDER_QUEUED_FOLLOW_UP_CHANNEL, input),
  sendQueuedFollowUpNow: (input) =>
    ipcRenderer.invoke(RUNTIME_SEND_QUEUED_FOLLOW_UP_NOW_CHANNEL, input),
  compactThread: (input) => ipcRenderer.invoke(RUNTIME_COMPACT_THREAD_CHANNEL, input),
  abort: (input) => ipcRenderer.invoke(RUNTIME_ABORT_CHANNEL, input),
  respondToExtensionUiRequest: (input) =>
    ipcRenderer.invoke(RUNTIME_RESPOND_EXTENSION_UI_CHANNEL, input),
  listSkills: (input) => ipcRenderer.invoke(RUNTIME_LIST_SKILLS_CHANNEL, input),
  getThreadSessionFile: (input) =>
    ipcRenderer.invoke(RUNTIME_GET_THREAD_SESSION_FILE_CHANNEL, input),
  onHostEvent: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, hostEvent: HonkRuntimeHostEvent) => {
      listener(hostEvent);
    };

    ipcRenderer.on(RUNTIME_HOST_EVENT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(RUNTIME_HOST_EVENT_CHANNEL, wrappedListener);
    };
  },
} satisfies HonkRuntimeApi;

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
  getBrowserWebviewPreloadPath: () => {
    const result: unknown = ipcRenderer.sendSync(GET_BROWSER_WEBVIEW_PRELOAD_PATH_CHANNEL);
    return typeof result === "string" && result.length > 0 ? result : null;
  },
  registerBrowserAutomationHost: (input: BrowserAutomationRegisterInput) =>
    ipcRenderer.invoke(REGISTER_BROWSER_AUTOMATION_HOST_CHANNEL, input),
  unregisterBrowserAutomationHost: (input: BrowserAutomationUnregisterInput) =>
    ipcRenderer.invoke(UNREGISTER_BROWSER_AUTOMATION_HOST_CHANNEL, input),
  onBrowserAutomationOpen: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, input: BrowserAutomationOpenRequest) => {
      listener(input);
    };

    ipcRenderer.on(BROWSER_AUTOMATION_OPEN_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(BROWSER_AUTOMATION_OPEN_CHANNEL, wrappedListener);
    };
  },
  detectLocalhostPorts: (ports) => ipcRenderer.invoke(DETECT_LOCALHOST_PORTS_CHANNEL, ports),
  clearBrowserPartitionStorage: (input) =>
    ipcRenderer.invoke(CLEAR_BROWSER_PARTITION_STORAGE_CHANNEL, input),
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
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  setBackgroundColor: (color) => ipcRenderer.invoke(SET_BACKGROUND_COLOR_CHANNEL, color),
  setVibrancy: (enabled) => ipcRenderer.invoke(SET_VIBRANCY_CHANNEL, enabled),
  setDisplayZoom: (factor) => ipcRenderer.invoke(SET_DISPLAY_ZOOM_CHANNEL, factor),
  expandWindowWidth: (additionalWidth) =>
    ipcRenderer.invoke(EXPAND_WINDOW_WIDTH_CHANNEL, additionalWidth),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  showItemInFolder: (path: string) => ipcRenderer.invoke(SHOW_ITEM_IN_FOLDER_CHANNEL, path),
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
  logRendererDiagnostic: (input: DesktopRendererDiagnosticInput) =>
    ipcRenderer.invoke(LOG_RENDERER_DIAGNOSTIC_CHANNEL, input),
  runtime: desktopRuntimeApi,
} satisfies DesktopBridge);

contextBridge.exposeInMainWorld("honkRuntime", desktopRuntimeApi);
