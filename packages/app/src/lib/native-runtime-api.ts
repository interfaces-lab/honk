import type { EnvironmentApi, EnvironmentId, LocalApi } from "@multi/contracts";

import { createEnvironmentApi, readEnvironmentApi } from "~/environment-api";
import { ensureLocalApi, readLocalApi } from "~/local-api";
import { getWsRpcClientForEnvironment } from "~/ws-rpc-client";

export { readLocalApi as readNativeApi, ensureLocalApi as ensureNativeApi };

export interface ReadNativeRuntimeApiOptions {
  allowPrimaryEnvironmentFallback?: boolean;
}

export type NativeRuntimeApi = LocalApi &
  Partial<Pick<EnvironmentApi, "terminal" | "projects" | "filesystem" | "git" | "orchestration">>;

function readEnvironmentApiWithFallback(
  environmentId: EnvironmentId | null | undefined,
  options?: ReadNativeRuntimeApiOptions,
): EnvironmentApi | undefined {
  if (environmentId) {
    return readEnvironmentApi(environmentId);
  }

  if (!options?.allowPrimaryEnvironmentFallback) {
    return undefined;
  }

  try {
    return createEnvironmentApi(getWsRpcClientForEnvironment(null));
  } catch {
    return undefined;
  }
}

export function readNativeEnvironmentApi(
  environmentId: EnvironmentId | null | undefined,
  options?: ReadNativeRuntimeApiOptions,
): EnvironmentApi | undefined {
  return readEnvironmentApiWithFallback(environmentId, options);
}

export function ensureNativeEnvironmentApi(
  environmentId: EnvironmentId | null | undefined,
  options?: ReadNativeRuntimeApiOptions,
): EnvironmentApi {
  const api = readNativeEnvironmentApi(environmentId, options);
  if (!api) {
    throw new Error(
      environmentId
        ? `Environment API not found for environment ${environmentId}`
        : "Environment API not found",
    );
  }
  return api;
}

const mergedRuntimeByLocalApi = new WeakMap<LocalApi, WeakMap<EnvironmentApi, NativeRuntimeApi>>();

function getMergedRuntimeApi(localApi: LocalApi, environmentApi: EnvironmentApi): NativeRuntimeApi {
  let byEnvironmentApi = mergedRuntimeByLocalApi.get(localApi);
  if (!byEnvironmentApi) {
    byEnvironmentApi = new WeakMap();
    mergedRuntimeByLocalApi.set(localApi, byEnvironmentApi);
  }

  const cached = byEnvironmentApi.get(environmentApi);
  if (cached) return cached;

  const merged: NativeRuntimeApi = {
    ...localApi,
    terminal: environmentApi.terminal,
    projects: environmentApi.projects,
    filesystem: environmentApi.filesystem,
    git: environmentApi.git,
    orchestration: environmentApi.orchestration,
  };
  byEnvironmentApi.set(environmentApi, merged);
  return merged;
}

export function readNativeRuntimeApi(
  environmentId: EnvironmentId | null | undefined,
  options?: ReadNativeRuntimeApiOptions,
): NativeRuntimeApi | undefined {
  const localApi = readLocalApi();
  if (!localApi) {
    return undefined;
  }

  const environmentApi = readEnvironmentApiWithFallback(environmentId, options);
  if (!environmentApi) {
    return localApi;
  }

  return getMergedRuntimeApi(localApi, environmentApi);
}
