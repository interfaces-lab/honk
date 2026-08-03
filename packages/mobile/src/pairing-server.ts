import { openCodeServerKey } from "@honk/opencode";

import type { PendingPairingAdoption } from "./pairing-adoption";
import type { StoredServer } from "./server-registry-store";

export function pairingServer(
  pending: PendingPairingAdoption,
  includeReboundMetadata: boolean,
): StoredServer {
  const movesManagedMetadata =
    pending.rebindOrigin !== null &&
    openCodeServerKey(pending.rebindOrigin) !== openCodeServerKey(pending.origin);
  return {
    environmentId:
      movesManagedMetadata && !includeReboundMetadata ? null : pending.previousEnvironmentId,
    deviceId:
      movesManagedMetadata && !includeReboundMetadata
        ? null
        : (pending.deviceId ?? pending.previousDeviceId),
    proofKeyThumbprint:
      movesManagedMetadata && !includeReboundMetadata ? null : pending.previousProofKeyThumbprint,
    origin: pending.origin,
    label: pending.serverLabel,
    defaultDirectory: pending.defaultDirectory,
    serverId: pending.serverId,
  };
}
