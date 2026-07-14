import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  BrowserAutomationOpenRequest,
  BrowserAutomationRegisterInput,
  BrowserAutomationUnregisterInput,
} from "@honk/shared/browser-automation";
import type {
  DesktopAppBranding,
  DesktopBridge,
  DesktopRendererDiagnosticInput,
  DesktopUpdateState,
  DesktopWindowChromeState,
} from "@honk/shared/desktop-api";

interface DesktopAuxEndpoint {
  readonly baseUrl: string;
  readonly bearer: string;
}

interface DesktopOpencodeSidecarEndpoint {
  readonly status: "idle" | "starting" | "ready" | "restarting" | "stopped" | "error";
  readonly url: string | null;
  readonly password: string | null;
}

interface DesktopPtyBridge {
  readonly open: (options: {
    readonly cwd: string;
    readonly cols: number;
    readonly rows: number;
  }) => Promise<{ readonly id: string }>;
  readonly write: (id: string, data: string) => void;
  readonly resize: (id: string, cols: number, rows: number) => void;
  readonly close: (id: string) => void;
  readonly onData: (id: string, listener: (data: string) => void) => () => void;
  readonly onExit: (id: string, listener: (code: number) => void) => () => void;
}

type DesktopBridgeWithAux = DesktopBridge<never> & {
  readonly getAuxEndpoint: () => Promise<DesktopAuxEndpoint | null>;
  readonly getOpencodeSidecar: () => Promise<DesktopOpencodeSidecarEndpoint>;
  readonly pty: DesktopPtyBridge;
};

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const COMPLETE_ONBOARDING_CHANNEL = "desktop:complete-onboarding";
const FINISH_ONBOARDING_CHANNEL = "desktop:finish-onboarding";
const DISMISS_ONBOARDING_CHANNEL = "desktop:dismiss-onboarding";
const REPLAY_ONBOARDING_CHANNEL = "desktop:replay-onboarding";
const ONBOARDING_WINDOW_SHOWN_CHANNEL = "desktop:onboarding-window-shown";
const SET_THEME_CHANNEL = "desktop:set-theme";
const SET_BACKGROUND_COLOR_CHANNEL = "desktop:set-background-color";
const SET_VIBRANCY_CHANNEL = "desktop:set-vibrancy";
const SET_DISPLAY_ZOOM_CHANNEL = "desktop:set-display-zoom";
const EXPAND_WINDOW_WIDTH_CHANNEL = "desktop:expand-window-width";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const OPEN_IN_EDITOR_CHANNEL = "desktop:open-in-editor";
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
const GET_AUX_ENDPOINT_CHANNEL = "desktop:get-aux-endpoint";
const GET_OPENCODE_SIDECAR_CHANNEL = "desktop:get-opencode-sidecar";
const GET_WINDOW_CHROME_STATE_CHANNEL = "desktop:get-window-chrome-state";
const WINDOW_CHROME_STATE_CHANNEL = "desktop:window-chrome-state";
const SET_ACTIVE_WORK_STATE_CHANNEL = "desktop:set-active-work-state";
const GET_CLIENT_SETTINGS_CHANNEL = "desktop:get-client-settings";
const SET_CLIENT_SETTINGS_CHANNEL = "desktop:set-client-settings";
const GET_SERVER_EXPOSURE_STATE_CHANNEL = "desktop:get-server-exposure-state";
const SET_SERVER_EXPOSURE_MODE_CHANNEL = "desktop:set-server-exposure-mode";
const LOG_RENDERER_DIAGNOSTIC_CHANNEL = "desktop:log-renderer-diagnostic";
const PTY_OPEN_CHANNEL = "desktop:pty-open";
const PTY_WRITE_CHANNEL = "desktop:pty-write";
const PTY_RESIZE_CHANNEL = "desktop:pty-resize";
const PTY_CLOSE_CHANNEL = "desktop:pty-close";
const PTY_DATA_CHANNEL = "desktop:pty-data";
const PTY_EXIT_CHANNEL = "desktop:pty-exit";

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
  getAuxEndpoint: () => ipcRenderer.invoke(GET_AUX_ENDPOINT_CHANNEL),
  getOpencodeSidecar: () => ipcRenderer.invoke(GET_OPENCODE_SIDECAR_CHANNEL),
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
  completeOnboarding: () => ipcRenderer.invoke(COMPLETE_ONBOARDING_CHANNEL),
  finishOnboarding: () => ipcRenderer.invoke(FINISH_ONBOARDING_CHANNEL),
  dismissOnboarding: () => ipcRenderer.invoke(DISMISS_ONBOARDING_CHANNEL),
  replayOnboarding: () => ipcRenderer.invoke(REPLAY_ONBOARDING_CHANNEL),
  onOnboardingWindowShown: (listener) => {
    const wrappedListener = () => {
      listener();
    };
    ipcRenderer.on(ONBOARDING_WINDOW_SHOWN_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(ONBOARDING_WINDOW_SHOWN_CHANNEL, wrappedListener);
    };
  },
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  setBackgroundColor: (color) => ipcRenderer.invoke(SET_BACKGROUND_COLOR_CHANNEL, color),
  setVibrancy: (enabled) => ipcRenderer.invoke(SET_VIBRANCY_CHANNEL, enabled),
  setDisplayZoom: (factor) => ipcRenderer.invoke(SET_DISPLAY_ZOOM_CHANNEL, factor),
  expandWindowWidth: (additionalWidth) =>
    ipcRenderer.invoke(EXPAND_WINDOW_WIDTH_CHANNEL, additionalWidth),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  openInEditor: (cwd, editor) => ipcRenderer.invoke(OPEN_IN_EDITOR_CHANNEL, { cwd, editor }),
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
  pty: {
    open: (options) => ipcRenderer.invoke(PTY_OPEN_CHANNEL, options),
    // Fire-and-forget: the contract types these as `=> void`, so discard the
    // invoke promise rather than exposing it to the renderer.
    write: (id, data) => {
      void ipcRenderer.invoke(PTY_WRITE_CHANNEL, { id, data });
    },
    resize: (id, cols, rows) => {
      void ipcRenderer.invoke(PTY_RESIZE_CHANNEL, { id, cols, rows });
    },
    close: (id) => {
      void ipcRenderer.invoke(PTY_CLOSE_CHANNEL, { id });
    },
    onData: (id, listener) => {
      const wrappedListener = (_event: IpcRendererEvent, payload: { id: string; data: string }) => {
        if (payload.id === id) {
          listener(payload.data);
        }
      };
      ipcRenderer.on(PTY_DATA_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(PTY_DATA_CHANNEL, wrappedListener);
      };
    },
    onExit: (id, listener) => {
      const wrappedListener = (_event: IpcRendererEvent, payload: { id: string; code: number }) => {
        if (payload.id === id) {
          listener(payload.code);
        }
      };
      ipcRenderer.on(PTY_EXIT_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(PTY_EXIT_CHANNEL, wrappedListener);
      };
    },
  },
} satisfies DesktopBridgeWithAux);
