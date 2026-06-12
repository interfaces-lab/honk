import {
  ClientSettingsSchema,
  type ClientSettings,
  type ContextMenuItem,
  type LocalApi,
  type HonkRuntimeApi,
} from "@honk/contracts";

import { configureRuntimeClientBootstrap, registerRuntimeApiResolver } from "./runtime-client";

const CLIENT_SETTINGS_STORAGE_KEY = "honk:client-settings:v1";

export type LocalApiRpcClient = {
  readonly server: LocalApi["server"];
  readonly shell: Pick<LocalApi["shell"], "openInEditor">;
};

export type LocalApiHost = {
  readonly showContextMenuFallback: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  readonly readBrowserClientSettings: () => ClientSettings | null;
  readonly writeBrowserClientSettings: (settings: ClientSettings) => void;
};

let cachedApi: LocalApi | undefined;
let localApiHost: LocalApiHost | null = null;

export function configureLocalApiHost(host: LocalApiHost): void {
  localApiHost = host;
}

export function resetLocalApiHostForTests(): void {
  localApiHost = null;
}

function readBootstrapRuntimeApi(): HonkRuntimeApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.desktopBridge?.runtime ?? window.honkRuntime;
}

function attachDesktopRuntimeApi(api: Omit<LocalApi, "runtime">): LocalApi {
  const runtime = readBootstrapRuntimeApi();
  return runtime ? { ...api, runtime } : api;
}

function readBrowserClientSettings(): ClientSettings | null {
  if (!localApiHost) {
    return null;
  }
  return localApiHost.readBrowserClientSettings();
}

function writeBrowserClientSettings(settings: ClientSettings): void {
  localApiHost?.writeBrowserClientSettings(settings);
}

async function showContextMenu<T extends string>(
  items: readonly ContextMenuItem<T>[],
  position?: { x: number; y: number },
): Promise<T | null> {
  if (window.desktopBridge) {
    return window.desktopBridge.showContextMenu(items, position);
  }
  if (localApiHost) {
    return localApiHost.showContextMenuFallback(items, position);
  }
  return null;
}

function unavailableDesktopRuntimeMethod(label: string): Error {
  return new Error(`${label} is unavailable through the desktop runtime IPC bridge.`);
}

export function createLocalApi(rpcClient: LocalApiRpcClient): LocalApi {
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
      openInEditor: (cwd, editor) => rpcClient.shell.openInEditor(cwd, editor),
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
      show: showContextMenu,
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
    server: rpcClient.server,
  });
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
      show: showContextMenu,
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
    const runtime = window.nativeApi.runtime ?? readBootstrapRuntimeApi();
    cachedApi =
      runtime && window.nativeApi.runtime !== runtime
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

export function resetLocalApiForTests(): void {
  cachedApi = undefined;
}

registerRuntimeApiResolver(() => {
  if (typeof window === "undefined") {
    return undefined;
  }
  if (cachedApi?.runtime) {
    return cachedApi.runtime;
  }
  if (window.nativeApi?.runtime) {
    return window.nativeApi.runtime;
  }
  return readBootstrapRuntimeApi();
});

configureRuntimeClientBootstrap({ readLocalApi });
