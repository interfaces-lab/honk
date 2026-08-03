import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ManagedRelayEnvironmentLinkRequest,
  ManagedRelayEnvironmentLinkResponse,
  ManagedRelayLinkChallengeRequest,
  ManagedRelayEnvironmentStatusResponse,
  ManagedRelayLinkChallengeResponse,
  ManagedRelayListEnvironmentsResponse,
} from "./managed-relay";

const endpoint = {
  providerKind: "cloudflare_tunnel",
  httpBaseUrl: "https://7zc4pk2m.remote.honk.example/",
  wsBaseUrl: "wss://7zc4pk2m.remote.honk.example/",
};
const environment = {
  environmentId: "environment-7zc4pk2m",
  label: "Studio",
  endpoint,
  status: "online",
  lastSeenAt: "2026-07-30T18:00:00.000Z",
};

describe("managed relay link contracts", () => {
  it("decodes a paired-device challenge request without an account-provider field", () => {
    expect(
      Schema.decodeUnknownSync(ManagedRelayLinkChallengeRequest)({
        environmentId: environment.environmentId,
        deviceId: "device-phone",
        providerKind: "cloudflare_tunnel",
      }),
    ).toEqual({
      environmentId: environment.environmentId,
      deviceId: "device-phone",
      providerKind: "cloudflare_tunnel",
    });
  });

  it("decodes the relay-owned challenge and allocation generation", () => {
    expect(
      Schema.decodeUnknownSync(ManagedRelayLinkChallengeResponse)({
        requestId: "link-1",
        challenge: "single-use-challenge",
        allocationGeneration: 3,
        providerKind: "cloudflare_tunnel",
        relayIssuer: "https://relay.honk.example",
        expiresAt: "2026-07-30T18:05:00.000Z",
      }),
    ).toEqual({
      requestId: "link-1",
      challenge: "single-use-challenge",
      allocationGeneration: 3,
      providerKind: "cloudflare_tunnel",
      relayIssuer: "https://relay.honk.example",
      expiresAt: "2026-07-30T18:05:00.000Z",
    });
  });

  it("decodes an environment-signed proof as the only link capability", () => {
    expect(
      Schema.decodeUnknownSync(ManagedRelayEnvironmentLinkRequest)({
        requestId: "link-1",
        deviceId: "device-phone",
        proof: "signed-proof",
      }),
    ).toEqual({
      requestId: "link-1",
      deviceId: "device-phone",
      proof: "signed-proof",
    });
  });

  it("decodes only opaque enrollment material for mobile delivery", () => {
    const decoded = Schema.decodeUnknownSync(ManagedRelayEnvironmentLinkResponse)({
      environment,
      enrollment: {
        requestId: "link-1",
        allocationGeneration: 3,
        grant: "single-use-enrollment-grant",
        expiresAt: "2026-07-30T18:05:00.000Z",
        connectorToken: "must-not-cross-mobile",
        tunnelSecret: "must-not-cross-mobile",
      },
      environmentCredential: "must-not-cross-mobile",
    });

    expect(decoded).toEqual({
      environment,
      enrollment: {
        requestId: "link-1",
        allocationGeneration: 3,
        grant: "single-use-enrollment-grant",
        expiresAt: "2026-07-30T18:05:00.000Z",
      },
    });
    expectTypeOf(decoded).toEqualTypeOf<ManagedRelayEnvironmentLinkResponse>();
  });

  it.each([
    {
      requestId: "link-1",
      challenge: "",
      allocationGeneration: 3,
      providerKind: "cloudflare_tunnel",
      relayIssuer: "https://relay.honk.example",
      expiresAt: "2026-07-30T18:05:00.000Z",
    },
    {
      requestId: "link-1",
      challenge: "challenge",
      allocationGeneration: -1,
      providerKind: "cloudflare_tunnel",
      relayIssuer: "https://relay.honk.example",
      expiresAt: "2026-07-30T18:05:00.000Z",
    },
    {
      requestId: "link-1",
      challenge: "challenge",
      allocationGeneration: 3,
      providerKind: "quick_tunnel",
      relayIssuer: "https://relay.honk.example",
      expiresAt: "2026-07-30T18:05:00.000Z",
    },
  ])("rejects malformed challenge metadata", (value) => {
    expect(() => Schema.decodeUnknownSync(ManagedRelayLinkChallengeResponse)(value)).toThrow();
  });
});

describe("managed relay discovery contracts", () => {
  it("decodes linked environment discovery", () => {
    expect(
      Schema.decodeUnknownSync(ManagedRelayListEnvironmentsResponse)({
        environments: [environment],
      }),
    ).toEqual({ environments: [environment] });
  });

  it("decodes a fresh status result without account or host credentials", () => {
    expect(
      Schema.decodeUnknownSync(ManagedRelayEnvironmentStatusResponse)({
        environmentId: environment.environmentId,
        endpoint,
        status: "offline",
        checkedAt: "2026-07-30T18:01:00.000Z",
      }),
    ).toEqual({
      environmentId: environment.environmentId,
      endpoint,
      status: "offline",
      checkedAt: "2026-07-30T18:01:00.000Z",
    });
  });

  it("rejects discovery with an unsupported provider", () => {
    expect(() =>
      Schema.decodeUnknownSync(ManagedRelayListEnvironmentsResponse)({
        environments: [
          {
            ...environment,
            endpoint: {
              ...endpoint,
              providerKind: "manual",
            },
          },
        ],
      }),
    ).toThrow();
  });
});
