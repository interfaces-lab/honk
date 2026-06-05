import type { EnvironmentApi, EnvironmentId, LocalApi } from "@multi/contracts";

import { readEnvironmentConnection } from "~/environments/runtime";
import { getPrimaryKnownEnvironment } from "~/environments/primary";
import { DESKTOP_RUNTIME_ENVIRONMENT_ID } from "~/lib/environment-scope";
import { createEnvironmentApi, readEnvironmentApi } from "~/environment-api";
import { ensureLocalApi, readLocalApi } from "~/local-api";
import { isDesktopRuntimeApiAvailable } from "~/lib/multi-runtime-api";

export { readLocalApi as readNativeApi, ensureLocalApi as ensureNativeApi };

export interface ReadNativeRuntimeApiOptions {
  allowPrimaryEnvironmentFallback?: boolean;
}

export type NativeRuntimeApi = LocalApi &
  Partial<Pick<EnvironmentApi, "terminal" | "projects" | "filesystem" | "orchestration">>;

function readEnvironmentApiWithFallback(
  environmentId: EnvironmentId | null | undefined,
  options?: ReadNativeRuntimeApiOptions,
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
