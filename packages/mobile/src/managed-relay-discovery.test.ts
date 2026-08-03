import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  ManagedRelayEnvironmentStatusResponse,
  ManagedRelayListEnvironmentsResponse,
} from "@honk/shared/managed-relay";

import { createManagedRelayDiscovery } from "./managed-relay-discovery";

const relayZone = "remote.honk.example";
const environment = {
  environmentId: "studio",
  label: "Studio",
  endpoint: {
    providerKind: "cloudflare_tunnel",
    httpBaseUrl: "https://studio.remote.honk.example/",
    wsBaseUrl: "wss://studio.remote.honk.example/",
  },
  status: "unknown",
} as const;
const listed = Schema.decodeUnknownSync(ManagedRelayListEnvironmentsResponse)({
  environments: [environment],
});
const online = Schema.decodeUnknownSync(ManagedRelayEnvironmentStatusResponse)({
  environmentId: environment.environmentId,
  endpoint: environment.endpoint,
  status: "online",
  checkedAt: "2026-07-30T18:01:00.000Z",
});

describe("managed relay discovery adapter", () => {
  it("canonicalizes the directory and validates status identity before publishing", async () => {
    const client = {
      listEnvironments: vi.fn(() => Promise.resolve(listed)),
      getEnvironmentStatus: vi.fn(() => Promise.resolve(online)),
    };
    const discovery = createManagedRelayDiscovery({ client, relayZone });

    await discovery.setAccount("account-one");

    expect(discovery.getState().environments.get(online.environmentId)).toMatchObject({
      availability: "online",
      environment,
      error: null,
    });
  });

  it.each([
    {
      ...online,
      environmentId: "laptop",
    },
    {
      ...online,
      endpoint: {
        ...online.endpoint,
        httpBaseUrl: "https://attacker.example/",
        wsBaseUrl: "wss://attacker.example/",
      },
    },
    {
      ...online,
      endpoint: {
        ...online.endpoint,
        httpBaseUrl: "https://other.remote.honk.example/",
        wsBaseUrl: "wss://other.remote.honk.example/",
      },
    },
  ])("keeps the row but fails closed on mismatched status", async (status) => {
    const discovery = createManagedRelayDiscovery({
      relayZone,
      client: {
        listEnvironments: () => Promise.resolve(listed),
        getEnvironmentStatus: () => Promise.resolve(status as unknown as typeof online),
      },
    });

    await discovery.setAccount("account-one");

    expect(discovery.getState().environments.get(online.environmentId)).toMatchObject({
      availability: "error",
      error: {
        message: "Honk could not check this linked computer.",
      },
    });
  });

  it("rejects a duplicate environment directory before publishing rows", async () => {
    const discovery = createManagedRelayDiscovery({
      relayZone,
      client: {
        listEnvironments: () =>
          Promise.resolve(
            Schema.decodeUnknownSync(ManagedRelayListEnvironmentsResponse)({
              environments: [environment, environment],
            }),
          ),
        getEnvironmentStatus: () => Promise.resolve(online),
      },
    });

    await discovery.setAccount("account-one");

    expect(discovery.getState().environments.size).toBe(0);
    expect(discovery.getState().error).toMatchObject({
      message: "Honk could not refresh your linked computers.",
    });
  });
});
