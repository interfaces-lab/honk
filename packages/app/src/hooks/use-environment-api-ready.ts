import type { EnvironmentId } from "@honk/shared/environment";
import { useSyncExternalStore } from "react";

import { readEnvironmentApi } from "~/environment-api";
import { readEnvironmentConnection, subscribeEnvironmentConnections } from "~/environments/runtime";

const NOOP = () => undefined;

function readEnvironmentApiReady(environmentId: EnvironmentId | null | undefined): boolean {
  if (!environmentId) {
    return false;
  }

  const api = readEnvironmentApi(environmentId);
  if (!api) {
    return false;
  }

  const connection = readEnvironmentConnection(environmentId);
  return connection ? connection.isBootstrapped() : true;
}

function subscribeEnvironmentApiReady(
  environmentId: EnvironmentId | null | undefined,
  listener: () => void,
): () => void {
  const unsubscribeConnections = subscribeEnvironmentConnections(listener);
  const unsubscribeBootstrap = environmentId
    ? (readEnvironmentConnection(environmentId)?.subscribeBootstrap(listener) ?? NOOP)
    : NOOP;

  return () => {
    unsubscribeBootstrap();
    unsubscribeConnections();
  };
}

export function useEnvironmentApiReady(environmentId: EnvironmentId | null | undefined): boolean {
  return useSyncExternalStore(
    (listener) => subscribeEnvironmentApiReady(environmentId, listener),
    () => readEnvironmentApiReady(environmentId),
    () => false,
  );
}
