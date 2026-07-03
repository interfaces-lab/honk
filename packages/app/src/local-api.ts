import {
  configureLocalApiHost,
  createLocalApi as createLocalApiFromClient,
  ensureLocalApi as ensureLocalApiFromClientRuntime,
  readLocalApi as readLocalApiFromClientRuntime,
  resetLocalApiForTests,
} from "@honk/client-runtime";
import { ClientSettingsSchema } from "@honk/shared/client-settings";
import type { LocalApi } from "@honk/contracts";

import { resetGitStatusStateForTests } from "./lib/git-status-state";
import { resetRequestLatencyStateForTests } from "./rpc/request-latency-state";
import { resetServerStateForTests } from "./rpc/server-state";
import { resetWsConnectionStateForTests } from "./rpc/ws-connection-state";
import { resetEnvironmentServiceForTests } from "./environments/runtime";
import { type WsRpcClient } from "./rpc/ws-rpc-client";
import { showContextMenuFallback } from "./browser/context-menu-fallback";
import { getLocalStorageItem, setLocalStorageItem } from "./hooks/use-local-storage";

const CLIENT_SETTINGS_STORAGE_KEY = "honk:client-settings:v1";
let localServerApiOverride: LocalApi["server"] | null = null;

configureLocalApiHost({
  showContextMenuFallback,
  readBrowserClientSettings: () =>
    getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, ClientSettingsSchema),
  writeBrowserClientSettings: (settings) =>
    setLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, settings, ClientSettingsSchema),
});

export function createLocalApi(rpcClient: WsRpcClient): LocalApi {
  return createLocalApiFromClient({
    server: rpcClient.server,
    shell: {
      openInEditor: (cwd, editor) => rpcClient.shell.openInEditor({ cwd, editor }),
    },
  });
}

function applyLocalServerApiOverride(api: LocalApi): LocalApi {
  if (!localServerApiOverride || api.server === localServerApiOverride) {
    return api;
  }
  return {
    ...api,
    server: localServerApiOverride,
  };
}

export function setLocalServerApiOverride(server: LocalApi["server"] | null): () => void {
  localServerApiOverride = server;
  return () => {
    if (localServerApiOverride === server) {
      localServerApiOverride = null;
    }
  };
}

export function readLocalApi(): LocalApi | undefined {
  const api = readLocalApiFromClientRuntime();
  return api ? applyLocalServerApiOverride(api) : undefined;
}

export function ensureLocalApi(): LocalApi {
  const api = readLocalApi();
  if (!api) {
    return applyLocalServerApiOverride(ensureLocalApiFromClientRuntime());
  }
  return api;
}

export async function __resetLocalApiForTests() {
  localServerApiOverride = null;
  resetLocalApiForTests();
  await resetEnvironmentServiceForTests();
  resetGitStatusStateForTests();
  resetRequestLatencyStateForTests();
  resetServerStateForTests();
  resetWsConnectionStateForTests();
}
