import { Schema } from "effect";

import { IsoDateTime, TrimmedNonEmptyString } from "./base-schemas";
import {
  ManagedAllocationGeneration,
  ManagedEnvironmentId,
  ManagedEnvironmentStatus,
  ManagedEnvironmentSummaryWire,
  ManagedRemoteEndpointWire,
  ManagedRemoteProviderKind,
} from "./managed-remote-access";

export const ManagedRelayDeviceId = TrimmedNonEmptyString.pipe(
  Schema.brand("ManagedRelayDeviceId"),
);
export type ManagedRelayDeviceId = typeof ManagedRelayDeviceId.Type;

export const ManagedRelayLinkRequestId = TrimmedNonEmptyString.pipe(
  Schema.brand("ManagedRelayLinkRequestId"),
);
export type ManagedRelayLinkRequestId = typeof ManagedRelayLinkRequestId.Type;

export const ManagedRelayLinkChallenge = TrimmedNonEmptyString.pipe(
  Schema.brand("ManagedRelayLinkChallenge"),
);
export type ManagedRelayLinkChallenge = typeof ManagedRelayLinkChallenge.Type;

export const ManagedRelayLinkProof = TrimmedNonEmptyString.pipe(
  Schema.brand("ManagedRelayLinkProof"),
);
export type ManagedRelayLinkProof = typeof ManagedRelayLinkProof.Type;

export const ManagedRelayIssuer = TrimmedNonEmptyString.pipe(Schema.brand("ManagedRelayIssuer"));
export type ManagedRelayIssuer = typeof ManagedRelayIssuer.Type;

export const ManagedRelayEnrollmentGrant = TrimmedNonEmptyString.pipe(
  Schema.brand("ManagedRelayEnrollmentGrant"),
);
export type ManagedRelayEnrollmentGrant = typeof ManagedRelayEnrollmentGrant.Type;

export const ManagedRelayLinkChallengeRequest = Schema.Struct({
  environmentId: ManagedEnvironmentId,
  deviceId: ManagedRelayDeviceId,
  providerKind: ManagedRemoteProviderKind,
});
export type ManagedRelayLinkChallengeRequest = typeof ManagedRelayLinkChallengeRequest.Type;

export const ManagedRelayLinkChallengeResponse = Schema.Struct({
  requestId: ManagedRelayLinkRequestId,
  challenge: ManagedRelayLinkChallenge,
  allocationGeneration: ManagedAllocationGeneration,
  providerKind: ManagedRemoteProviderKind,
  relayIssuer: ManagedRelayIssuer,
  expiresAt: IsoDateTime,
});
export type ManagedRelayLinkChallengeResponse = typeof ManagedRelayLinkChallengeResponse.Type;

export const ManagedRelayEnvironmentLinkRequest = Schema.Struct({
  requestId: ManagedRelayLinkRequestId,
  deviceId: ManagedRelayDeviceId,
  proof: ManagedRelayLinkProof,
});
export type ManagedRelayEnvironmentLinkRequest = typeof ManagedRelayEnvironmentLinkRequest.Type;

export const ManagedRelayEnrollmentMetadata = Schema.Struct({
  requestId: ManagedRelayLinkRequestId,
  allocationGeneration: ManagedAllocationGeneration,
  grant: ManagedRelayEnrollmentGrant,
  expiresAt: IsoDateTime,
});
export type ManagedRelayEnrollmentMetadata = typeof ManagedRelayEnrollmentMetadata.Type;

export const ManagedRelayEnvironmentLinkResponse = Schema.Struct({
  environment: ManagedEnvironmentSummaryWire,
  enrollment: ManagedRelayEnrollmentMetadata,
});
export type ManagedRelayEnvironmentLinkResponse = typeof ManagedRelayEnvironmentLinkResponse.Type;

export const ManagedRelayEnvironmentLinkRecoveryResponse = ManagedRelayEnvironmentLinkResponse;
export type ManagedRelayEnvironmentLinkRecoveryResponse =
  typeof ManagedRelayEnvironmentLinkRecoveryResponse.Type;

export const ManagedRelayListEnvironmentsResponse = Schema.Struct({
  environments: Schema.Array(ManagedEnvironmentSummaryWire),
});
export type ManagedRelayListEnvironmentsResponse = typeof ManagedRelayListEnvironmentsResponse.Type;

export const ManagedRelayEnvironmentParams = Schema.Struct({
  environmentId: ManagedEnvironmentId,
});
export type ManagedRelayEnvironmentParams = typeof ManagedRelayEnvironmentParams.Type;

export const ManagedRelayEnvironmentLinkRecoveryParams = Schema.Struct({
  requestId: ManagedRelayLinkRequestId,
});
export type ManagedRelayEnvironmentLinkRecoveryParams =
  typeof ManagedRelayEnvironmentLinkRecoveryParams.Type;

export const ManagedRelayEnvironmentStatusResponse = Schema.Struct({
  environmentId: ManagedEnvironmentId,
  endpoint: ManagedRemoteEndpointWire,
  status: ManagedEnvironmentStatus,
  checkedAt: IsoDateTime,
  lastSeenAt: Schema.optionalKey(IsoDateTime),
});
export type ManagedRelayEnvironmentStatusResponse =
  typeof ManagedRelayEnvironmentStatusResponse.Type;
