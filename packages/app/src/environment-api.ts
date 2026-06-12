import type { EnvironmentId, EnvironmentApi } from "@honk/contracts";
import { createEnvironmentClient, isDesktopRuntimeApiAvailable } from "@honk/client-runtime";

import { getPrimaryKnownEnvironment } from "./environments/primary";
import { readEnvironmentConnection } from "./environments/runtime";
import { DESKTOP_RUNTIME_ENVIRONMENT_ID } from "./lib/environment-scope";
import type { WsRpcClient } from "./rpc/ws-rpc-client";

export interface ReadEnvironmentApiOptions {
  readonly allowPrimaryEnvironmentFallback?: boolean;
}

const environmentApiOverridesForTests = new Map<EnvironmentId, EnvironmentApi>();

export function createEnvironmentApi(rpcClient: WsRpcClient): EnvironmentApi {
  return createEnvironmentClient({
    terminal: {
      open: (input) => rpcClient.terminal.open(input as never),
      write: (input) => rpcClient.terminal.write(input as never),
      resize: (input) => rpcClient.terminal.resize(input as never),
      clear: (input) => rpcClient.terminal.clear(input as never),
      restart: (input) => rpcClient.terminal.restart(input as never),
      close: (input) => rpcClient.terminal.close(input as never),
      onEvent: (callback) => rpcClient.terminal.onEvent(callback),
    },
    projects: {
      listDirectory: rpcClient.projects.listDirectory,
      readFile: rpcClient.projects.readFile,
      searchEntries: rpcClient.projects.searchEntries,
      writeFile: rpcClient.projects.writeFile,
    },
    filesystem: {
      browse: rpcClient.filesystem.browse,
    },
    git: {
      pull: rpcClient.git.pull,
      refreshStatus: rpcClient.git.refreshStatus,
      onStatus: (input, callback, options) => rpcClient.git.onStatus(input, callback, options),
      listBranches: rpcClient.git.listBranches,
      createWorktree: rpcClient.git.createWorktree,
      removeWorktree: rpcClient.git.removeWorktree,
      createBranch: rpcClient.git.createBranch,
      checkout: rpcClient.git.checkout,
      init: rpcClient.git.init,
      resolvePullRequest: rpcClient.git.resolvePullRequest,
      preparePullRequestThread: rpcClient.git.preparePullRequestThread,
      discardPaths: rpcClient.git.discardPaths,
      getFilePatch: rpcClient.git.getFilePatch,
      getFileImage: rpcClient.git.getFileImage,
    },
    orchestration: {
      dispatchCommand: rpcClient.orchestration.dispatchCommand,
      subscribeShell: (callback, options) =>
        rpcClient.orchestration.subscribeShell(callback, options),
      subscribeThread: (input, callback, options) =>
        rpcClient.orchestration.subscribeThread(input, callback, options),
    },
  });
}

export function readEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!environmentId) {
    return undefined;
  }

  const overriddenApi = environmentApiOverridesForTests.get(environmentId);
  if (overriddenApi) {
    return overriddenApi;
  }

  const connection = readEnvironmentConnection(environmentId);
  return connection ? createEnvironmentApi(connection.client) : undefined;
}

export function readEnvironmentApiWithFallback(
  environmentId: EnvironmentId | null | undefined,
  options?: ReadEnvironmentApiOptions,
): EnvironmentApi | undefined {
  if (environmentId === DESKTOP_RUNTIME_ENVIRONMENT_ID) {
    return undefined;
  }

  if (environmentId) {
    return readEnvironmentApi(environmentId);
  }

  if (!options?.allowPrimaryEnvironmentFallback) {
    return undefined;
  }

  if (isDesktopRuntimeApiAvailable()) {
    return undefined;
  }

  const primaryEnvironment = getPrimaryKnownEnvironment();
  const primaryEnvironmentId = primaryEnvironment?.environmentId;
  if (!primaryEnvironmentId) {
    return undefined;
  }

  const connection = readEnvironmentConnection(primaryEnvironmentId);
  if (!connection) {
    return undefined;
  }

  return createEnvironmentApi(connection.client);
}

export function ensureEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi {
  const api = readEnvironmentApi(environmentId);
  if (!api) {
    throw new Error(`Environment API not found for environment ${environmentId}`);
  }
  return api;
}

export function __setEnvironmentApiOverrideForTests(
  environmentId: EnvironmentId,
  api: EnvironmentApi,
): void {
  environmentApiOverridesForTests.set(environmentId, api);
}

export function __resetEnvironmentApiOverridesForTests(): void {
  environmentApiOverridesForTests.clear();
}
