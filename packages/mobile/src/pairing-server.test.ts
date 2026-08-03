import { describe, expect, it } from "vitest";
import { openCodeServerKey } from "@honk/opencode";

import type { PairingAdoption } from "./pairing-adoption";
import { pairingServer } from "./pairing-server";
import { decodeStoredRegistry, storedRegistry, type StoredServer } from "./server-registry-store";

const adoption: PairingAdoption = {
  status: "confirming",
  deviceId: "device-new",
  origin: "https://new.example.com",
  rebindOrigin: "https://old.example.com",
  serverId: "server-1",
  requestId: "request_1234",
  password: "password",
  expiresAt: "2026-07-30T12:00:00.000Z",
  serverLabel: "Studio",
  defaultDirectory: "/workspace",
  replacePassword: null,
  replaceServerId: null,
  restorePreviousAccess: false,
  previousServerLabel: null,
  previousDefaultDirectory: null,
  previousActiveServerKey: "https://old.example.com",
  previousEnvironmentId: "environment-1",
  previousDeviceId: "device-1",
  previousProofKeyThumbprint: "proof-1",
};

describe("pairingServer", () => {
  it("does not duplicate managed metadata before a rebind is released", () => {
    expect(pairingServer(adoption, false)).toMatchObject({
      environmentId: null,
      deviceId: null,
      proofKeyThumbprint: null,
    });
  });

  it("moves managed metadata onto a confirmed rebind", () => {
    expect(pairingServer(adoption, true)).toMatchObject({
      environmentId: "environment-1",
      deviceId: "device-new",
      proofKeyThumbprint: "proof-1",
    });
  });

  it("keeps managed metadata for a same-origin replacement", () => {
    expect(pairingServer({ ...adoption, rebindOrigin: adoption.origin }, false)).toMatchObject({
      environmentId: "environment-1",
      deviceId: "device-new",
      proofKeyThumbprint: "proof-1",
    });
  });

  it("keeps every crash-visible rebind registry decodable", () => {
    const previous: StoredServer = {
      environmentId: "environment-1",
      deviceId: "device-1",
      proofKeyThumbprint: "proof-1",
      origin: adoption.rebindOrigin!,
      label: "Studio",
      defaultDirectory: "/workspace",
      serverId: "server-1",
    };
    const provisional = pairingServer(adoption, false);
    const beforeRelease = new Map([
      [openCodeServerKey(previous.origin), previous],
      [openCodeServerKey(provisional.origin), provisional],
    ]);
    expect(
      decodeStoredRegistry(
        JSON.stringify(storedRegistry(beforeRelease, openCodeServerKey(provisional.origin))),
      ).servers,
    ).toHaveLength(2);

    const afterRelease = new Map(beforeRelease);
    afterRelease.delete(openCodeServerKey(previous.origin));
    afterRelease.set(openCodeServerKey(provisional.origin), pairingServer(adoption, true));
    expect(
      decodeStoredRegistry(
        JSON.stringify(storedRegistry(afterRelease, openCodeServerKey(provisional.origin))),
      ).servers,
    ).toHaveLength(1);
  });
});
