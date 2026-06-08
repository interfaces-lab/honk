import {
  configureLocalApiHost,
  createLocalApi as createLocalApiFromClient,
  ensureLocalApi,
  readLocalApi,
  resetLocalApiForTests,
} from "@multi/client-runtime";
import { ClientSettingsSchema, type LocalApi } from "@multi/contracts";

import { resetGitStatusStateForTests } from "./lib/git-status-state";
import { resetRequestLatencyStateForTests } from "./rpc/request-latency-state";
import { resetServerStateForTests } from "./rpc/server-state";
import { resetWsConnectionStateForTests } from "./rpc/ws-connection-state";
import { resetEnvironmentServiceForTests } from "./environments/runtime";
import { type WsRpcClient } from "./rpc/ws-rpc-client";
import { showContextMenuFallback } from "./browser/context-menu-fallback";
import { getLocalStorageItem, setLocalStorageItem } from "./hooks/use-local-storage";

const CLIENT_SETTINGS_STORAGE_KEY = "multi:client-settings:v1";

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

export { ensureLocalApi, readLocalApi };

export async function __resetLocalApiForTests() {
  resetLocalApiForTests();
  await resetEnvironmentServiceForTests();
  resetGitStatusStateForTests();
  resetRequestLatencyStateForTests();
  resetServerStateForTests();
  resetWsConnectionStateForTests();
}
