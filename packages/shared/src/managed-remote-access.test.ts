import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  canonicalManagedEnvironmentSummary,
  canonicalManagedRemoteEndpoint,
  type ManagedRemoteEndpoint,
  ManagedRemoteEndpointWire,
} from "./managed-remote-access";

const relayZone = "remote.honk.example";
const endpoint: ManagedRemoteEndpointWire = {
  providerKind: "cloudflare_tunnel",
  httpBaseUrl: "https://7zc4pk2m.remote.honk.example/",
  wsBaseUrl: "wss://7zc4pk2m.remote.honk.example/",
};

describe("canonicalManagedRemoteEndpoint", () => {
  it("accepts one canonical opaque hostname in the configured relay zone", () => {
    const canonical = canonicalManagedRemoteEndpoint(endpoint, relayZone);
    expect(canonical).toEqual(endpoint);
    expect(canonicalManagedRemoteEndpoint(endpoint, " REMOTE.HONK.EXAMPLE ")).toEqual(endpoint);
    expectTypeOf(canonical).toEqualTypeOf<ManagedRemoteEndpoint | null>();
  });

  it("keeps decoded wire endpoints outside the canonical type", () => {
    const decoded = Schema.decodeUnknownSync(ManagedRemoteEndpointWire)(endpoint);
    expect(decoded).toEqual(endpoint);
    expectTypeOf(decoded).toEqualTypeOf<ManagedRemoteEndpointWire>();
    expectTypeOf(decoded).not.toMatchTypeOf<ManagedRemoteEndpoint>();
  });

  it.each([
    {
      ...endpoint,
      httpBaseUrl: "http://7zc4pk2m.remote.honk.example/",
    },
    {
      ...endpoint,
      httpBaseUrl: "https://user@7zc4pk2m.remote.honk.example/",
    },
    {
      ...endpoint,
      httpBaseUrl: "https://7zc4pk2m.remote.honk.example:444/",
    },
    {
      ...endpoint,
      httpBaseUrl: "https://7zc4pk2m.remote.honk.example:443/",
    },
    {
      ...endpoint,
      httpBaseUrl: "https://7zc4pk2m.remote.honk.example",
    },
    {
      ...endpoint,
      httpBaseUrl: "https://7zc4pk2m.remote.honk.example/path",
    },
    {
      ...endpoint,
      httpBaseUrl: "https://7zc4pk2m.remote.honk.example/?next=elsewhere",
    },
    {
      ...endpoint,
      httpBaseUrl: "https://7zc4pk2m.remote.honk.example/#fragment",
    },
    {
      ...endpoint,
      httpBaseUrl: "https://nested.7zc4pk2m.remote.honk.example/",
      wsBaseUrl: "wss://nested.7zc4pk2m.remote.honk.example/",
    },
    {
      ...endpoint,
      httpBaseUrl: "https://7zc4pk2m.attacker.example/",
      wsBaseUrl: "wss://7zc4pk2m.attacker.example/",
    },
  ])("rejects a noncanonical HTTP authority: $httpBaseUrl", (candidate) => {
    expect(canonicalManagedRemoteEndpoint(candidate, relayZone)).toBeNull();
  });

  it.each([
    "ws://7zc4pk2m.remote.honk.example/",
    "wss://different.remote.honk.example/",
    "wss://7zc4pk2m.remote.honk.example/socket",
    "wss://7zc4pk2m.remote.honk.example/?token=secret",
    "wss://7zc4pk2m.remote.honk.example/#fragment",
  ])("rejects a mismatched WebSocket authority: %s", (wsBaseUrl) => {
    expect(canonicalManagedRemoteEndpoint({ ...endpoint, wsBaseUrl }, relayZone)).toBeNull();
  });

  it("rejects malformed contracts and relay zones", () => {
    expect(canonicalManagedRemoteEndpoint(null, relayZone)).toBeNull();
    expect(
      canonicalManagedRemoteEndpoint(
        {
          ...endpoint,
          providerKind: "quick_tunnel",
        },
        relayZone,
      ),
    ).toBeNull();
    expect(canonicalManagedRemoteEndpoint(endpoint, "localhost")).toBeNull();
    expect(canonicalManagedRemoteEndpoint(endpoint, "remote.honk.example.")).toBeNull();
  });
});

describe("canonicalManagedEnvironmentSummary", () => {
  const summary = {
    environmentId: "environment-7zc4pk2m",
    label: "Studio",
    endpoint,
    status: "online",
    lastSeenAt: "2026-07-30T18:00:00.000Z",
  };

  it("returns a decoded summary only when its endpoint is canonical", () => {
    expect(canonicalManagedEnvironmentSummary(summary, relayZone)).toEqual(summary);
    expect(
      canonicalManagedEnvironmentSummary(
        {
          ...summary,
          endpoint: {
            ...endpoint,
            httpBaseUrl: "https://attacker.example/",
          },
        },
        relayZone,
      ),
    ).toBeNull();
  });

  it("rejects malformed summary fields before endpoint use", () => {
    expect(canonicalManagedEnvironmentSummary({ ...summary, environmentId: " " }, relayZone)).toBe(
      null,
    );
    expect(
      canonicalManagedEnvironmentSummary({ ...summary, status: "ready" }, relayZone),
    ).toBeNull();
  });
});
