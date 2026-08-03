import { describe, expect, it, vi } from "vitest";

import {
  createManagedEnvironmentDirectory,
  ManagedEnvironmentDirectoryError,
} from "./managed-environment-directory";

const relayZone = "remote.honk.example";
const environment = {
  environmentId: "environment-studio",
  label: "Studio",
  endpoint: {
    providerKind: "cloudflare_tunnel",
    httpBaseUrl: "https://n4k7mz2p.remote.honk.example/",
    wsBaseUrl: "wss://n4k7mz2p.remote.honk.example/",
  },
  status: "online",
  lastSeenAt: "2026-07-30T18:00:00.000Z",
};

describe("createManagedEnvironmentDirectory", () => {
  it("lists and resolves only canonical managed endpoints", async () => {
    const directory = createManagedEnvironmentDirectory({
      relayZone,
      load: vi.fn(() => Promise.resolve([environment])),
    });

    await expect(directory.list()).resolves.toEqual([environment]);
    await expect(directory.resolve("environment-studio")).resolves.toEqual(environment);
    await expect(directory.resolve("environment-missing")).resolves.toBeNull();
  });

  it("rejects an endpoint outside the configured relay zone", async () => {
    const directory = createManagedEnvironmentDirectory({
      relayZone,
      load: () =>
        Promise.resolve([
          {
            ...environment,
            endpoint: {
              ...environment.endpoint,
              httpBaseUrl: "https://attacker.example/",
              wsBaseUrl: "wss://attacker.example/",
            },
          },
        ]),
    });

    await expect(directory.list()).rejects.toEqual(
      new ManagedEnvironmentDirectoryError(
        "The linked-computer service returned an invalid endpoint.",
      ),
    );
  });

  it("fails the whole discovery response when an environment id is duplicated", async () => {
    const directory = createManagedEnvironmentDirectory({
      relayZone,
      load: () => Promise.resolve([environment, environment]),
    });

    await expect(directory.list()).rejects.toThrow("duplicate environment");
  });

  it("maps transport failures without exposing the upstream response", async () => {
    const cause = new Error("relay request included a sensitive bearer");
    const directory = createManagedEnvironmentDirectory({
      relayZone,
      load: () => Promise.reject(cause),
    });

    await expect(directory.list()).rejects.toMatchObject({
      message: "Honk could not load your linked computers.",
      cause,
    });
  });
});
