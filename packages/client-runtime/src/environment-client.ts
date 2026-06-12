import type { EnvironmentApi } from "@honk/contracts";

export type EnvironmentRpcClient = EnvironmentApi;

const environmentApiByClient = new WeakMap<EnvironmentRpcClient, EnvironmentApi>();

export function createEnvironmentClient(rpcClient: EnvironmentRpcClient): EnvironmentApi {
  const cached = environmentApiByClient.get(rpcClient);
  if (cached) {
    return cached;
  }

  const api: EnvironmentApi = {
    terminal: rpcClient.terminal,
    projects: rpcClient.projects,
    filesystem: rpcClient.filesystem,
    git: rpcClient.git,
    orchestration: rpcClient.orchestration,
  };

  environmentApiByClient.set(rpcClient, api);
  return api;
}
