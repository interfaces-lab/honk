import type { EnvironmentId } from "@honk/shared/environment";

import type { EnvironmentApi } from "./desktop-bridge";
import { readCoreEnvironmentConnection } from "./environments/core";
import { getPrimaryKnownEnvironment } from "./environments/primary";

export interface ReadEnvironmentApiOptions {
  readonly allowPrimaryEnvironmentFallback?: boolean;
}

const environmentApiOverridesForTests = new Map<EnvironmentId, EnvironmentApi>();

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

  const coreConnection = readCoreEnvironmentConnection(environmentId);
  if (coreConnection) {
    return coreConnection.client;
  }
  return undefined;
}

export function readEnvironmentApiWithFallback(
  environmentId: EnvironmentId | null | undefined,
  options?: ReadEnvironmentApiOptions,
): EnvironmentApi | undefined {
  if (environmentId) {
    return readEnvironmentApi(environmentId);
  }
  if (!options?.allowPrimaryEnvironmentFallback) {
    return undefined;
  }

  const primaryEnvironmentId = getPrimaryKnownEnvironment()?.environmentId;
  return primaryEnvironmentId ? readEnvironmentApi(primaryEnvironmentId) : undefined;
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
