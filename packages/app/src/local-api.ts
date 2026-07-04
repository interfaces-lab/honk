import { ClientSettingsSchema } from "@honk/shared/client-settings";
import type { ClientSettings } from "@honk/shared/client-settings";
import type { ContextMenuItem } from "@honk/shared/desktop-api";

import type { LocalApi, LocalServerApi } from "./desktop-bridge";
import { showContextMenuFallback } from "./browser/context-menu-fallback";
import { getLocalStorageItem, setLocalStorageItem } from "./hooks/use-local-storage";
import { resetGitStatusStateForTests } from "./lib/git-status-state";
import { resetRequestLatencyStateForTests } from "./rpc/request-latency-state";
import { resetServerStateForTests } from "./rpc/server-state";
import { resetWsConnectionStateForTests } from "./rpc/ws-connection-state";

const CLIENT_SETTINGS_STORAGE_KEY = "honk:client-settings:v1";

interface LocalApiHost {
  readonly showContextMenuFallback: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  readonly readBrowserClientSettings: () => ClientSettings | null;
  readonly writeBrowserClientSettings: (settings: ClientSettings) => void;
}

let cachedApi: LocalApi | undefined;
let localApiHost: LocalApiHost | null = {
  showContextMenuFallback,
  readBrowserClientSettings: () =>
    getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, ClientSettingsSchema),
  writeBrowserClientSettings: (settings) =>
    setLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, settings, ClientSettingsSchema),
};
let localServerApiOverride: LocalServerApi | null = null;

function unavailableLocalMethod(label: string): Error {
  return new Error(`${label} is unavailable in this environment.`);
}

function unavailableServerApi(): LocalServerApi {
  return {
    getConfig: async () => {
      throw unavailableLocalMethod("Server config");
    },
    upsertKeybinding: async () => {
      throw unavailableLocalMethod("Server keybinding update");
    },
    getSettings: async () => {
      throw unavailableLocalMethod("Server settings");
    },
    updateSettings: async () => {
      throw unavailableLocalMethod("Server settings update");
    },
  };
}

function readBrowserClientSettings(): ClientSettings | null {
  return localApiHost?.readBrowserClientSettings() ?? null;
}

function writeBrowserClientSettings(settings: ClientSettings): void {
  localApiHost?.writeBrowserClientSettings(settings);
}

async function showContextMenu<T extends string>(
  items: readonly ContextMenuItem<T>[],
  position?: { x: number; y: number },
): Promise<T | null> {
  if (window.desktopBridge) {
    return window.desktopBridge.showContextMenu(items, position) as Promise<T | null>;
  }
  if (localApiHost) {
    return localApiHost.showContextMenuFallback<T>(items, position);
  }
  return null;
}

function currentServerApi(): LocalServerApi {
  return localServerApiOverride ?? unavailableServerApi();
}

function createLocalApiFromWindow(): LocalApi {
  return {
    dialogs: {
      pickFolder: async (options) => window.desktopBridge?.pickFolder(options) ?? null,
      confirm: async (message) => window.confirm(message),
    },
    shell: {
      openInEditor: async (cwd, editor) => {
        const opened = await window.desktopBridge?.openInEditor(cwd, editor);
        if (!opened) {
          throw unavailableLocalMethod("Open in editor");
        }
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
      showItemInFolder: async (path) => {
        const shown = await window.desktopBridge?.showItemInFolder(path);
        if (!shown) {
          throw unavailableLocalMethod("Show item in folder");
        }
      },
    },
    contextMenu: {
      show: (items, position) => showContextMenu(items, position),
    },
    persistence: {
      getClientSettings: async () =>
        window.desktopBridge?.getClientSettings() ?? readBrowserClientSettings(),
      setClientSettings: async (settings) => {
        if (window.desktopBridge) {
          await window.desktopBridge.setClientSettings(settings);
          return;
        }
        writeBrowserClientSettings(settings);
      },
    },
    server: currentServerApi(),
  };
}

function applyLocalServerApiOverride(api: LocalApi): LocalApi {
  const server = currentServerApi();
  return api.server === server ? api : { ...api, server };
}

export function setLocalServerApiOverride(server: LocalServerApi | null): () => void {
  localServerApiOverride = server;
  cachedApi = cachedApi ? { ...cachedApi, server: currentServerApi() } : cachedApi;
  return () => {
    if (localServerApiOverride === server) {
      localServerApiOverride = null;
      cachedApi = cachedApi ? { ...cachedApi, server: currentServerApi() } : cachedApi;
    }
  };
}

export function readLocalApi(): LocalApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  if (cachedApi) {
    return applyLocalServerApiOverride(cachedApi);
  }
  if (window.nativeApi) {
    cachedApi = window.nativeApi;
    return applyLocalServerApiOverride(cachedApi);
  }
  if (window.desktopBridge || localApiHost) {
    cachedApi = createLocalApiFromWindow();
    return applyLocalServerApiOverride(cachedApi);
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

export async function __resetLocalApiForTests(): Promise<void> {
  cachedApi = undefined;
  localServerApiOverride = null;
  resetGitStatusStateForTests();
  resetRequestLatencyStateForTests();
  resetServerStateForTests();
  resetWsConnectionStateForTests();
}
