import {
  canonicalManagedRemoteEndpoint,
  type ManagedEnvironmentSummary,
} from "@honk/shared/managed-remote-access";

import {
  createManagedEnvironmentDiscovery,
  type ManagedEnvironmentDiscovery,
} from "./managed-environment-discovery";
import {
  decodeManagedEnvironmentDirectory,
  ManagedEnvironmentDirectoryError,
} from "./managed-environment-directory";
import type { ManagedRelayClient } from "./managed-relay-client";

export function createManagedRelayDiscovery<Account>(input: {
  readonly client: Pick<ManagedRelayClient<Account>, "getEnvironmentStatus" | "listEnvironments">;
  readonly relayZone: string;
}): ManagedEnvironmentDiscovery<Account> {
  return createManagedEnvironmentDiscovery<Account>({
    list: async ({ account, signal }) =>
      decodeManagedEnvironmentDirectory(
        (await input.client.listEnvironments({ session: account, signal })).environments,
        input.relayZone,
      ),
    resolveStatus: async ({ account, environment, signal }) => {
      const status = await input.client.getEnvironmentStatus({
        session: account,
        environmentId: environment.environmentId,
        signal,
      });
      const endpoint = canonicalManagedRemoteEndpoint(status.endpoint, input.relayZone);
      if (
        status.environmentId !== environment.environmentId ||
        endpoint === null ||
        !sameManagedEndpoint(environment, endpoint)
      ) {
        throw new ManagedEnvironmentDirectoryError(
          "The linked-computer service returned status for a different computer.",
        );
      }
      return status.status;
    },
  });
}

function sameManagedEndpoint(
  environment: ManagedEnvironmentSummary,
  endpoint: ManagedEnvironmentSummary["endpoint"],
): boolean {
  return (
    environment.endpoint.providerKind === endpoint.providerKind &&
    environment.endpoint.httpBaseUrl === endpoint.httpBaseUrl &&
    environment.endpoint.wsBaseUrl === endpoint.wsBaseUrl
  );
}
