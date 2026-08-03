import { describe, expect, it } from "vitest";

import { resolveManagedRemoteConfig } from "./managed-remote-config";

describe("managed remote config", () => {
  it("resolves and canonicalizes injected Expo extra values", () => {
    expect(
      resolveManagedRemoteConfig({
        router: {},
        managedRemote: {
          relayOrigin: " HTTPS://Relay.Honk.Example/// ",
          relayZone: " Remote.Honk.Example ",
        },
      }),
    ).toEqual({
      relayOrigin: "https://relay.honk.example",
      relayZone: "remote.honk.example",
    });
  });

  it.each([
    undefined,
    null,
    {},
    [],
    { managedRemote: null },
    { managedRemote: {} },
    { managedRemote: { relayOrigin: "https://relay.honk.example" } },
    { managedRemote: { relayZone: "remote.honk.example" } },
  ])("returns null when managed remote access is unconfigured in %j", (extra) => {
    expect(resolveManagedRemoteConfig(extra)).toBeNull();
  });

  it.each([
    "http://relay.honk.example",
    "wss://relay.honk.example",
    "https://user@relay.honk.example",
    "https://relay.honk.example/path",
    "https://relay.honk.example?region=one",
    "https://relay.honk.example#fragment",
    "relay.honk.example",
    "",
    42,
  ])("rejects invalid relay origin %j", (relayOrigin) => {
    expect(
      resolveManagedRemoteConfig({
        managedRemote: { relayOrigin, relayZone: "remote.honk.example" },
      }),
    ).toBeNull();
  });

  it.each([
    "localhost",
    "https://remote.honk.example",
    "*.remote.honk.example",
    "remote_honk.example",
    "-remote.honk.example",
    "remote-.honk.example",
    "remote.honk.example.",
    "127.0.0.1",
    "réseau.honk.example",
    "",
    42,
  ])("rejects invalid relay zone %j", (relayZone) => {
    expect(
      resolveManagedRemoteConfig({
        managedRemote: { relayOrigin: "https://relay.honk.example", relayZone },
      }),
    ).toBeNull();
  });

  it("does not read similarly named values outside managedRemote", () => {
    expect(
      resolveManagedRemoteConfig({
        relayOrigin: "https://relay.honk.example",
        relayZone: "remote.honk.example",
        relay: {
          origin: "https://relay.honk.example",
          zone: "remote.honk.example",
        },
      }),
    ).toBeNull();
  });
});
