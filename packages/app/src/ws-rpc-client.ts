import type { EnvironmentId } from "@multi/contracts";

import { getPrimaryEnvironmentConnection, readEnvironmentConnection } from "./environments/runtime";
import type { WsRpcClient } from "./rpc/ws-rpc-client";

export type { WsRpcClient } from "./rpc/ws-rpc-client";

export function getWsRpcClient(): WsRpcClient {
  return getPrimaryEnvironmentConnection().client;
}

export function getWsRpcClientForEnvironment(
  environmentId: EnvironmentId | null | undefined,
): WsRpcClient {
  if (!environmentId) {
    return getWsRpcClient();
  }

  const connection = readEnvironmentConnection(environmentId);
  if (!connection) {
    throw new Error(`Environment API not found for environment ${environmentId}`);
  }

  return connection.client;
}
