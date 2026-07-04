import type { EnvironmentId } from "@honk/shared/environment";

import type { EnvironmentApi } from "~/desktop-bridge";
import { readEnvironmentApi } from "~/environment-api";
import { readCoreEnvironmentConnection } from "~/environments/core";
import { getPrimaryKnownEnvironment } from "~/environments/primary";

export type EnvironmentGitApi = EnvironmentApi["git"];

export interface ResolvedEnvironmentGitApi {
  readonly environmentId: EnvironmentId;
  readonly clientIdentity: string;
  readonly git: EnvironmentGitApi;
}

function readPrimaryEnvironmentGitApi(
  environmentId: EnvironmentId,
): ResolvedEnvironmentGitApi | null {
  const primaryEnvironment = getPrimaryKnownEnvironment();
  if (primaryEnvironment?.environmentId !== environmentId) {
    return null;
  }

  const connection = readCoreEnvironmentConnection(environmentId);
  if (!connection) {
    return null;
  }
  return {
    environmentId: connection.environmentId,
    clientIdentity: connection.environmentId,
    git: connection.client.git,
  };
}

export function readResolvedEnvironmentGitApi(
  environmentId: EnvironmentId | null | undefined,
): ResolvedEnvironmentGitApi | null {
  if (!environmentId || typeof window === "undefined") {
    return null;
  }

  const api = readEnvironmentApi(environmentId);
  if (api) {
    return {
      environmentId,
      clientIdentity: environmentId,
      git: api.git,
    };
  }

  const coreConnection = readCoreEnvironmentConnection(environmentId);
  if (coreConnection) {
    return {
      environmentId: coreConnection.environmentId,
      clientIdentity: coreConnection.environmentId,
      git: coreConnection.client.git,
    };
  }

  return readPrimaryEnvironmentGitApi(environmentId);
}

export function readEnvironmentGitApi(
  environmentId: EnvironmentId | null | undefined,
): EnvironmentGitApi | null {
  return readResolvedEnvironmentGitApi(environmentId)?.git ?? null;
}

export function ensureEnvironmentGitApi(environmentId: EnvironmentId): EnvironmentGitApi {
  const api = readEnvironmentGitApi(environmentId);
  if (!api) {
    throw new Error(`Git API not found for environment ${environmentId}`);
  }
  return api;
}
