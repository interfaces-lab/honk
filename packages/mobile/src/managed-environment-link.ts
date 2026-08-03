import {
  canonicalManagedEnvironmentSummary,
  type ManagedEnvironmentId,
  type ManagedEnvironmentSummary,
  type ManagedRemoteProviderKind,
} from "@honk/shared/managed-remote-access";
import type {
  ManagedRelayDeviceId,
  ManagedRelayEnrollmentMetadata,
  ManagedRelayEnvironmentLinkRequest,
  ManagedRelayEnvironmentLinkResponse,
  ManagedRelayLinkChallengeRequest,
  ManagedRelayLinkChallengeResponse,
  ManagedRelayLinkProof,
} from "@honk/shared/managed-relay";

export interface ManagedEnvironmentLinkTarget {
  readonly environmentId: ManagedEnvironmentId;
  readonly deviceId: ManagedRelayDeviceId;
  readonly providerKind: ManagedRemoteProviderKind;
}

export interface ManagedEnvironmentLinkResult {
  readonly environment: ManagedEnvironmentSummary;
  readonly enrollment: ManagedRelayEnrollmentMetadata;
}

export interface ManagedEnvironmentLinkOperations {
  readonly createChallenge: (
    request: ManagedRelayLinkChallengeRequest,
  ) => Promise<ManagedRelayLinkChallengeResponse>;
  /**
   * This operation owns the authenticated bootstrap-host request. The orchestrator never receives
   * or forwards the paired device password.
   */
  readonly requestHostProof: (input: {
    readonly target: ManagedEnvironmentLinkTarget;
    readonly challenge: ManagedRelayLinkChallengeResponse;
  }) => Promise<ManagedRelayLinkProof>;
  readonly submitLink: (
    request: ManagedRelayEnvironmentLinkRequest,
  ) => Promise<ManagedRelayEnvironmentLinkResponse>;
  /**
   * Recovers a relay commit whose submit response may have been lost. A failed recovery preserves
   * the original submission error so an unrelated recovery failure cannot hide the first cause.
   */
  readonly recoverLink: (
    requestId: ManagedRelayEnvironmentLinkRequest["requestId"],
  ) => Promise<ManagedRelayEnvironmentLinkResponse>;
  /**
   * The host redeems this opaque grant directly with the relay. Mobile must not receive the host
   * enrollment credential or tunnel secret.
   */
  readonly deliverEnrollment: (result: ManagedEnvironmentLinkResult) => Promise<void>;
}

export class ManagedEnvironmentLinkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagedEnvironmentLinkValidationError";
  }
}

export async function linkManagedEnvironment(input: {
  readonly target: ManagedEnvironmentLinkTarget;
  readonly relayOrigin: string;
  readonly relayZone: string;
  readonly operations: ManagedEnvironmentLinkOperations;
  readonly now?: () => number;
}): Promise<ManagedEnvironmentLinkResult> {
  const challenge = await input.operations.createChallenge({
    environmentId: input.target.environmentId,
    deviceId: input.target.deviceId,
    providerKind: input.target.providerKind,
  });
  if (
    challenge.relayIssuer !== input.relayOrigin ||
    challenge.providerKind !== input.target.providerKind
  ) {
    throw new ManagedEnvironmentLinkValidationError(
      "The remote-access service returned a challenge for a different configuration.",
    );
  }
  if (Date.parse(challenge.expiresAt) <= (input.now ?? Date.now)()) {
    throw new ManagedEnvironmentLinkValidationError(
      "The remote-access setup challenge expired. Try again.",
    );
  }

  const proof = await input.operations.requestHostProof({
    target: input.target,
    challenge,
  });
  const response = await input.operations
    .submitLink({
      requestId: challenge.requestId,
      deviceId: input.target.deviceId,
      proof,
    })
    .then(
      (linked) => linked,
      (submissionError: unknown) =>
        input.operations.recoverLink(challenge.requestId).then(
          (recovered) => recovered,
          () => Promise.reject(submissionError),
        ),
    );
  const environment = canonicalManagedEnvironmentSummary(response.environment, input.relayZone);
  if (
    environment === null ||
    environment.environmentId !== input.target.environmentId ||
    environment.endpoint.providerKind !== input.target.providerKind ||
    response.enrollment.requestId !== challenge.requestId ||
    response.enrollment.allocationGeneration !== challenge.allocationGeneration
  ) {
    throw new ManagedEnvironmentLinkValidationError(
      "The remote-access service returned setup details for a different computer.",
    );
  }
  if (Date.parse(response.enrollment.expiresAt) <= (input.now ?? Date.now)()) {
    throw new ManagedEnvironmentLinkValidationError(
      "The remote-access enrollment expired. Try again.",
    );
  }

  const result = Object.freeze({ environment, enrollment: response.enrollment });
  await input.operations.deliverEnrollment(result);
  return result;
}
