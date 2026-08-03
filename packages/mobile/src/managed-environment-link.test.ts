import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  ManagedRelayDeviceId,
  ManagedRelayEnvironmentLinkResponse,
  ManagedRelayLinkChallengeResponse,
  ManagedRelayLinkProof,
} from "@honk/shared/managed-relay";
import {
  ManagedEnvironmentId,
  ManagedRemoteProviderKind,
} from "@honk/shared/managed-remote-access";

import {
  linkManagedEnvironment,
  ManagedEnvironmentLinkValidationError,
  type ManagedEnvironmentLinkOperations,
} from "./managed-environment-link";

const relayOrigin = "https://relay.honk.example";
const relayZone = "remote.honk.example";
const environmentId = Schema.decodeUnknownSync(ManagedEnvironmentId)("environment-studio");
const deviceId = Schema.decodeUnknownSync(ManagedRelayDeviceId)("device-phone");
const providerKind = Schema.decodeUnknownSync(ManagedRemoteProviderKind)("cloudflare_tunnel");
const challenge = Schema.decodeUnknownSync(ManagedRelayLinkChallengeResponse)({
  requestId: "link-request-1",
  challenge: "single-use-challenge",
  allocationGeneration: 4,
  providerKind,
  relayIssuer: relayOrigin,
  expiresAt: "2026-07-30T18:05:00.000Z",
});
const link = Schema.decodeUnknownSync(ManagedRelayEnvironmentLinkResponse)({
  environment: {
    environmentId,
    label: "Studio",
    endpoint: {
      providerKind,
      httpBaseUrl: "https://studio.remote.honk.example/",
      wsBaseUrl: "wss://studio.remote.honk.example/",
    },
    status: "unknown",
  },
  enrollment: {
    requestId: challenge.requestId,
    allocationGeneration: challenge.allocationGeneration,
    grant: "opaque-enrollment-grant",
    expiresAt: "2026-07-30T18:04:00.000Z",
  },
});

function operations(
  events: string[],
  overrides: Partial<ManagedEnvironmentLinkOperations> = {},
): ManagedEnvironmentLinkOperations {
  return {
    createChallenge: async (request) => {
      events.push(`challenge:${request.environmentId}:${request.deviceId}`);
      return challenge;
    },
    requestHostProof: async ({ challenge: request }) => {
      events.push(`proof:${request.requestId}`);
      return Schema.decodeUnknownSync(ManagedRelayLinkProof)("signed-host-proof");
    },
    submitLink: async (request) => {
      events.push(`link:${request.requestId}:${request.deviceId}:${request.proof}`);
      return link;
    },
    recoverLink: async (requestId) => {
      events.push(`recover:${requestId}`);
      return link;
    },
    deliverEnrollment: async (result) => {
      events.push(`enroll:${result.enrollment.requestId}:${result.environment.environmentId}`);
    },
    ...overrides,
  };
}

describe("linkManagedEnvironment", () => {
  it("links through the paired host and delivers only an opaque enrollment grant", async () => {
    const events: string[] = [];
    const deliverEnrollment = vi.fn<ManagedEnvironmentLinkOperations["deliverEnrollment"]>();

    await expect(
      linkManagedEnvironment({
        target: { environmentId, deviceId, providerKind },
        relayOrigin,
        relayZone,
        operations: operations(events, { deliverEnrollment }),
        now: () => Date.parse("2026-07-30T18:00:00.000Z"),
      }),
    ).resolves.toEqual({
      environment: link.environment,
      enrollment: link.enrollment,
    });
    expect(events).toEqual([
      `challenge:${environmentId}:${deviceId}`,
      `proof:${challenge.requestId}`,
      `link:${challenge.requestId}:${deviceId}:signed-host-proof`,
    ]);
    expect(deliverEnrollment).toHaveBeenCalledWith({
      environment: link.environment,
      enrollment: link.enrollment,
    });
    expect(JSON.stringify(deliverEnrollment.mock.calls)).not.toMatch(
      /connectorToken|tunnelSecret|password/i,
    );
  });

  it.each([
    {
      ...challenge,
      relayIssuer: "https://attacker.example",
    },
    {
      ...challenge,
      expiresAt: "2026-07-30T17:59:59.000Z",
    },
  ])("rejects a mismatched or expired challenge before asking the host", async (candidate) => {
    const requestHostProof = vi.fn<ManagedEnvironmentLinkOperations["requestHostProof"]>();

    await expect(
      linkManagedEnvironment({
        target: { environmentId, deviceId, providerKind },
        relayOrigin,
        relayZone,
        operations: operations([], {
          createChallenge: () =>
            Promise.resolve(candidate as unknown as ManagedRelayLinkChallengeResponse),
          requestHostProof,
        }),
        now: () => Date.parse("2026-07-30T18:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ManagedEnvironmentLinkValidationError);
    expect(requestHostProof).not.toHaveBeenCalled();
  });

  it.each([
    {
      ...link,
      environment: { ...link.environment, environmentId: "environment-other" },
    },
    {
      ...link,
      enrollment: { ...link.enrollment, requestId: "different-request" },
    },
    {
      ...link,
      enrollment: { ...link.enrollment, allocationGeneration: 5 },
    },
    {
      ...link,
      environment: {
        ...link.environment,
        endpoint: {
          ...link.environment.endpoint,
          httpBaseUrl: "https://attacker.example/",
          wsBaseUrl: "wss://attacker.example/",
        },
      },
    },
  ])("rejects mismatched link material before delivering enrollment", async (candidate) => {
    const deliverEnrollment = vi.fn<ManagedEnvironmentLinkOperations["deliverEnrollment"]>();

    await expect(
      linkManagedEnvironment({
        target: { environmentId, deviceId, providerKind },
        relayOrigin,
        relayZone,
        operations: operations([], {
          submitLink: () =>
            Promise.resolve(candidate as unknown as ManagedRelayEnvironmentLinkResponse),
          deliverEnrollment,
        }),
        now: () => Date.parse("2026-07-30T18:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ManagedEnvironmentLinkValidationError);
    expect(deliverEnrollment).not.toHaveBeenCalled();
  });

  it("leaves the direct connection outside the transaction when enrollment delivery fails", async () => {
    const cause = new Error("bootstrap host is offline");

    await expect(
      linkManagedEnvironment({
        target: { environmentId, deviceId, providerKind },
        relayOrigin,
        relayZone,
        operations: operations([], {
          deliverEnrollment: () => Promise.reject(cause),
        }),
        now: () => Date.parse("2026-07-30T18:00:00.000Z"),
      }),
    ).rejects.toBe(cause);
  });

  it("recovers a link whose successful relay response was lost", async () => {
    const events: string[] = [];
    const cause = new Error("response disappeared");

    await expect(
      linkManagedEnvironment({
        target: { environmentId, deviceId, providerKind },
        relayOrigin,
        relayZone,
        operations: operations(events, {
          submitLink: () => Promise.reject(cause),
        }),
        now: () => Date.parse("2026-07-30T18:00:00.000Z"),
      }),
    ).resolves.toEqual({
      environment: link.environment,
      enrollment: link.enrollment,
    });
    expect(events).toContain(`recover:${challenge.requestId}`);
  });

  it("preserves the submission failure when recovery also fails", async () => {
    const submissionError = new Error("link response disappeared");

    await expect(
      linkManagedEnvironment({
        target: { environmentId, deviceId, providerKind },
        relayOrigin,
        relayZone,
        operations: operations([], {
          submitLink: () => Promise.reject(submissionError),
          recoverLink: () => Promise.reject(new Error("recovery unavailable")),
        }),
        now: () => Date.parse("2026-07-30T18:00:00.000Z"),
      }),
    ).rejects.toBe(submissionError);
  });
});
