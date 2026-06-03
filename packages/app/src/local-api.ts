import {
  ClientSettingsSchema,
  type ClientSettings,
  type ContextMenuItem,
  type LocalApi,
  type MultiRuntimeApi,
} from "@multi/contracts";

import { resetGitStatusStateForTests } from "./lib/git-status-state";
import { resetRequestLatencyStateForTests } from "./rpc/request-latency-state";
import { resetServerStateForTests } from "./rpc/server-state";
import { resetWsConnectionStateForTests } from "./rpc/ws-connection-state";
import { resetEnvironmentServiceForTests } from "./environments/runtime";
import { type WsRpcClient } from "./rpc/ws-rpc-client";
import { showContextMenuFallback } from "./browser/context-menu-fallback";
import { getLocalStorageItem, setLocalStorageItem } from "./hooks/use-local-storage";

let cachedApi: LocalApi | undefined;
const CLIENT_SETTINGS_STORAGE_KEY = "multi:client-settings:v1";

function readDesktopRuntimeApi(): MultiRuntimeApi | undefined {
  return window.desktopBridge?.runtime ?? window.multiRuntime;
}

function attachDesktopRuntimeApi(api: Omit<LocalApi, "runtime">): LocalApi {
  const runtime = readDesktopRuntimeApi();
  return runtime ? { ...api, runtime } : api;
}

function readBrowserClientSettings(): ClientSettings | null {
  if (typeof window === "undefined") {
    return null;
  }

  return getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, ClientSettingsSchema);
}

function writeBrowserClientSettings(settings: ClientSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  setLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, settings, ClientSettingsSchema);
}

export function createLocalApi(rpcClient: WsRpcClient): LocalApi {
  return attachDesktopRuntimeApi({
    dialogs: {
      pickFolder: async (options) => {
        if (!window.desktopBridge) return null;
        return window.desktopBridge.pickFolder(options);
      },
      confirm: async (message) => {
        if (window.desktopBridge) {
          return window.desktopBridge.confirm(message);
        }
        return window.confirm(message);
      },
    },
    shell: {
      openInEditor: (cwd, editor) => rpcClient.shell.openInEditor({ cwd, editor }),
      openExternal: async (url) => {
        if (window.desktopBridge) {
          const opened = await window.desktopBridge.openExternal(url);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        if (window.desktopBridge) {
          return window.desktopBridge.showContextMenu(items, position);
        }
        return showContextMenuFallback(items, position);
      },
    },
    persistence: {
      getClientSettings: async () => {
        if (window.desktopBridge) {
          return window.desktopBridge.getClientSettings();
        }
        return readBrowserClientSettings();
      },
      setClientSettings: async (settings) => {
        if (window.desktopBridge) {
          return window.desktopBridge.setClientSettings(settings);
        }
        writeBrowserClientSettings(settings);
      },
    },
    server: {
      getConfig: rpcClient.server.getConfig,
      upsertKeybinding: rpcClient.server.upsertKeybinding,
      getSettings: rpcClient.server.getSettings,
      updateSettings: rpcClient.server.updateSettings,
    },
  });
}

function unavailableDesktopRuntimeMethod(label: string): Error {
  return new Error(`${label} is unavailable through the desktop runtime IPC bridge.`);
}

function createDesktopLocalApi(): LocalApi {
  return attachDesktopRuntimeApi({
    dialogs: {
      pickFolder: async (options) => window.desktopBridge?.pickFolder(options) ?? null,
      confirm: async (message) => {
        if (window.desktopBridge) {
          return window.desktopBridge.confirm(message);
        }
        return window.confirm(message);
      },
    },
    shell: {
      openInEditor: async () => {
        throw unavailableDesktopRuntimeMethod("Open in editor");
      },
      openExternal: async (url) => {
        if (window.desktopBridge) {
          const opened = await window.desktopBridge.openExternal(url);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
    contextMenu: {
      show: async (items, position) => {
        if (window.desktopBridge) {
          return window.desktopBridge.showContextMenu(items, position);
        }
        return showContextMenuFallback(items, position);
      },
    },
    persistence: {
      getClientSettings: async () => {
        if (window.desktopBridge) {
          return window.desktopBridge.getClientSettings();
        }
        return readBrowserClientSettings();
      },
      setClientSettings: async (settings) => {
        if (window.desktopBridge) {
          return window.desktopBridge.setClientSettings(settings);
        }
        writeBrowserClientSettings(settings);
      },
    },
    server: {
      getConfig: async () => {
        throw unavailableDesktopRuntimeMethod("Server config");
      },
      upsertKeybinding: async () => {
        throw unavailableDesktopRuntimeMethod("Server keybinding update");
      },
      getSettings: async () => {
        throw unavailableDesktopRuntimeMethod("Server settings");
      },
      updateSettings: async () => {
        throw unavailableDesktopRuntimeMethod("Server settings update");
      },
    },
  });
}

export function readLocalApi(): LocalApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    const runtime = window.nativeApi.runtime ?? readDesktopRuntimeApi();
    cachedApi = runtime && window.nativeApi.runtime !== runtime
      ? { ...window.nativeApi, runtime }
      : window.nativeApi;
    return cachedApi;
  }

  if (window.desktopBridge) {
    cachedApi = createDesktopLocalApi();
    return cachedApi;
  }

  return undefined;
}

export function ensureLocalApi(): LocalApi {
  const api = readLocalApi();
  if (!api) {
    throw new Error("Local API not found");
  }
  return api;
}

export async function __resetLocalApiForTests() {
  cachedApi = undefined;
  await resetEnvironmentServiceForTests();
  resetGitStatusStateForTests();
  resetRequestLatencyStateForTests();
  resetServerStateForTests();
  resetWsConnectionStateForTests();
}
