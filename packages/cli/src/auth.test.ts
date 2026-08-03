import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DeviceRegistry } from "./auth";
import type { DeviceRecord } from "./state";

const EXISTING_PASSWORD = "existing-password";
const REQUEST_ID = "request-0001";
const OTHER_REQUEST_ID = "request-0002";
const EXISTING_DEVICE: DeviceRecord = {
  id: "existing-device",
  label: "Old phone",
  passwordHash: createHash("sha256").update(EXISTING_PASSWORD, "utf8").digest("hex"),
  createdAt: "2026-07-20T17:00:00.000Z",
  revokedAt: null,
};

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  return {
    promise: new Promise<void>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve: () => resolvePromise?.(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DeviceRegistry", () => {
  it("keeps provisional credentials out of active devices and persistent state", async () => {
    const persist = vi.fn(async () => undefined);
    const registry = new DeviceRegistry([], persist);
    const pairing = registry.issuePairing("Test phone");
    const result = await registry.provision(pairing.token, REQUEST_ID, "Renamed client");

    expect(result).toMatchObject({
      status: "provisional",
      device: { label: "Renamed client", requestID: REQUEST_ID },
    });
    if (result.status !== "provisional") throw new Error("Expected provisional access.");
    expect(registry.authenticate(result.device.password)).toBeNull();
    expect(registry.list()).toEqual([]);
    expect(registry.pairingState(pairing.id).status).toBe("pending");
    expect(registry.preview(pairing.token)).toMatchObject({ label: "Test phone" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("replays the exact provisional result only for the same request or credential", async () => {
    const registry = new DeviceRegistry(
      [],
      vi.fn(async () => undefined),
    );
    const pairing = registry.issuePairing("Test phone");
    const first = await registry.provision(pairing.token, REQUEST_ID);
    if (first.status !== "provisional") throw new Error("Expected provisional access.");

    await expect(registry.provision(pairing.token, REQUEST_ID, "Changed name")).resolves.toEqual(
      first,
    );
    await expect(registry.provision(pairing.token, OTHER_REQUEST_ID)).resolves.toEqual({
      status: "in-progress",
    });
    await expect(
      registry.provision(
        pairing.token,
        OTHER_REQUEST_ID,
        undefined,
        undefined,
        first.device.password,
      ),
    ).resolves.toEqual(first);
  });

  it("keeps replacement access atomic and retryable when confirmation cannot be saved", async () => {
    const persist = vi
      .fn<(devices: readonly DeviceRecord[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValue(undefined);
    const registry = new DeviceRegistry([EXISTING_DEVICE], persist);
    const pairing = registry.issuePairing("New phone");
    const provisional = await registry.provision(
      pairing.token,
      REQUEST_ID,
      "New phone",
      EXISTING_DEVICE.id,
    );
    if (provisional.status !== "provisional") throw new Error("Expected provisional access.");

    await expect(registry.confirm(provisional.device.password)).rejects.toThrow("save failed");
    expect(registry.list()).toEqual([EXISTING_DEVICE]);
    expect(registry.authenticate(EXISTING_PASSWORD)?.id).toBe(EXISTING_DEVICE.id);
    expect(registry.authenticate(provisional.device.password)).toBeNull();
    expect(registry.pairingState(pairing.id).status).toBe("pending");

    await expect(registry.confirm(provisional.device.password)).resolves.toMatchObject({
      status: "completed",
      device: {
        id: provisional.device.id,
        replacedDeviceID: EXISTING_DEVICE.id,
      },
    });
    expect(registry.authenticate(EXISTING_PASSWORD)).toBeNull();
    expect(registry.authenticate(provisional.device.password)?.id).toBe(provisional.device.id);
    expect(registry.list().filter((device) => device.revokedAt === null)).toHaveLength(1);
  });

  it("replays a completed confirmation without persisting twice", async () => {
    const persist = vi.fn(async () => undefined);
    const registry = new DeviceRegistry([], persist);
    const pairing = registry.issuePairing("Test phone");
    const provisional = await registry.provision(pairing.token, REQUEST_ID);
    if (provisional.status !== "provisional") throw new Error("Expected provisional access.");

    const first = await registry.confirm(provisional.device.password);
    await expect(registry.confirm(provisional.device.password)).resolves.toEqual(first);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(registry.list()).toHaveLength(1);
  });

  it("invalidates a provisional replacement when its source device is revoked first", async () => {
    const firstSave = deferred();
    const persist = vi
      .fn<(devices: readonly DeviceRecord[]) => Promise<void>>()
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValue(undefined);
    const registry = new DeviceRegistry([EXISTING_DEVICE], persist);
    const pairing = registry.issuePairing("New phone");
    const provisional = await registry.provision(
      pairing.token,
      REQUEST_ID,
      "New phone",
      EXISTING_DEVICE.id,
    );
    if (provisional.status !== "provisional") throw new Error("Expected provisional access.");

    const revocation = registry.revoke(EXISTING_DEVICE.id);
    await Promise.resolve();
    const confirmation = registry.confirm(provisional.device.password);
    firstSave.resolve();

    await expect(revocation).resolves.toBe(true);
    await expect(confirmation).resolves.toEqual({ status: "invalid" });
    expect(registry.pairingState(pairing.id).status).toBe("cancelled");
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.revokedAt).not.toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("does not restore provisional access in a new registry", async () => {
    const pairingSource = new DeviceRegistry(
      [],
      vi.fn(async () => undefined),
    );
    const pairing = pairingSource.issuePairing("Test phone");
    const provisional = await pairingSource.provision(pairing.token, REQUEST_ID);
    if (provisional.status !== "provisional") throw new Error("Expected provisional access.");

    const restarted = new DeviceRegistry(
      pairingSource.list(),
      vi.fn(async () => undefined),
    );
    await expect(restarted.confirm(provisional.device.password)).resolves.toEqual({
      status: "invalid",
    });
    expect(restarted.authenticate(provisional.device.password)).toBeNull();
  });

  it("cancels provisional access without touching persistent state", async () => {
    const persist = vi.fn(async () => undefined);
    const registry = new DeviceRegistry([], persist);
    const pairing = registry.issuePairing("Test phone");
    const provisional = await registry.provision(pairing.token, REQUEST_ID);
    if (provisional.status !== "provisional") throw new Error("Expected provisional access.");

    await expect(registry.cancelProvisional(provisional.device.password)).resolves.toBe(true);
    await expect(registry.cancelProvisional(provisional.device.password)).resolves.toBe(false);
    await expect(registry.confirm(provisional.device.password)).resolves.toEqual({
      status: "invalid",
    });
    expect(registry.pairingState(pairing.id).status).toBe("cancelled");
    expect(persist).not.toHaveBeenCalled();
  });

  it("cancels a pairing candidate before confirmation", async () => {
    const persist = vi.fn(async () => undefined);
    const registry = new DeviceRegistry([], persist);
    const pairing = registry.issuePairing("Test phone");
    const provisional = await registry.provision(pairing.token, REQUEST_ID);
    if (provisional.status !== "provisional") throw new Error("Expected provisional access.");

    await expect(registry.cancelPairingCandidate(provisional.device.password)).resolves.toEqual({
      cancelled: true,
      revokedDeviceID: null,
    });
    await expect(registry.confirm(provisional.device.password)).resolves.toEqual({
      status: "invalid",
    });
    expect(registry.pairingState(pairing.id).status).toBe("cancelled");
    expect(persist).not.toHaveBeenCalled();
  });

  it("revokes only the same pairing candidate after confirmation", async () => {
    const persist = vi.fn(async () => undefined);
    const registry = new DeviceRegistry([EXISTING_DEVICE], persist);
    const pairing = registry.issuePairing("Test phone");
    const provisional = await registry.provision(pairing.token, REQUEST_ID);
    if (provisional.status !== "provisional") throw new Error("Expected provisional access.");
    await registry.confirm(provisional.device.password);

    await expect(registry.cancelPairingCandidate(provisional.device.password)).resolves.toEqual({
      cancelled: true,
      revokedDeviceID: provisional.device.id,
    });
    expect(registry.authenticate(provisional.device.password)).toBeNull();
    expect(registry.authenticate(EXISTING_PASSWORD)?.id).toBe(EXISTING_DEVICE.id);
    expect(registry.pairingState(pairing.id).status).toBe("cancelled");
  });

  it("revokes a confirmed candidate after the host registry restarts", async () => {
    const registry = new DeviceRegistry(
      [EXISTING_DEVICE],
      vi.fn(async () => undefined),
    );
    const pairing = registry.issuePairing("Test phone");
    const provisional = await registry.provision(pairing.token, REQUEST_ID);
    if (provisional.status !== "provisional") throw new Error("Expected provisional access.");
    await registry.confirm(provisional.device.password);

    const persist = vi.fn(async () => undefined);
    const restarted = new DeviceRegistry(registry.list(), persist);
    await expect(restarted.cancelPairingCandidate(provisional.device.password)).resolves.toEqual({
      cancelled: true,
      revokedDeviceID: provisional.device.id,
    });
    expect(restarted.authenticate(provisional.device.password)).toBeNull();
    expect(restarted.authenticate(EXISTING_PASSWORD)?.id).toBe(EXISTING_DEVICE.id);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("revokes a device when its pairing is cancelled during confirmation", async () => {
    const firstSave = deferred();
    const persist = vi
      .fn<(devices: readonly DeviceRecord[]) => Promise<void>>()
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValue(undefined);
    const registry = new DeviceRegistry([], persist);
    const pairing = registry.issuePairing("Test phone");
    const provisional = await registry.provision(pairing.token, REQUEST_ID);
    if (provisional.status !== "provisional") throw new Error("Expected provisional access.");
    const confirmation = registry.confirm(provisional.device.password);
    await Promise.resolve();

    const cancellation = registry.cancelPairing(pairing.id);
    firstSave.resolve();
    await expect(confirmation).resolves.toMatchObject({ status: "completed" });
    await expect(cancellation).resolves.toMatchObject({
      cancelled: true,
      revokedDeviceID: provisional.device.id,
    });

    expect(registry.list().filter((device) => device.revokedAt === null)).toEqual([]);
    expect(registry.pairingState(pairing.id).status).toBe("cancelled");
  });

  it("keeps completed access retryable when cancellation cannot be saved", async () => {
    const persist = vi
      .fn<(devices: readonly DeviceRecord[]) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValue(undefined);
    const registry = new DeviceRegistry([], persist);
    const pairing = registry.issuePairing("Test phone");
    const provisional = await registry.provision(pairing.token, REQUEST_ID);
    if (provisional.status !== "provisional") throw new Error("Expected provisional access.");
    await registry.confirm(provisional.device.password);

    await expect(registry.cancelPairing(pairing.id)).rejects.toThrow("save failed");
    expect(registry.authenticate(provisional.device.password)).not.toBeNull();
    expect(registry.pairingState(pairing.id).status).toBe("completed");

    await expect(registry.cancelPairing(pairing.id)).resolves.toMatchObject({ cancelled: true });
    expect(registry.authenticate(provisional.device.password)).toBeNull();
  });

  it("does not report completed pairing after its device is revoked", async () => {
    const registry = new DeviceRegistry(
      [],
      vi.fn(async () => undefined),
    );
    const pairing = registry.issuePairing("Test phone");
    const provisional = await registry.provision(pairing.token, REQUEST_ID);
    if (provisional.status !== "provisional") throw new Error("Expected provisional access.");
    await registry.confirm(provisional.device.password);

    await expect(registry.revoke(provisional.device.id)).resolves.toBe(true);
    expect(registry.pairingState(pairing.id).status).toBe("cancelled");
  });

  it("expires provisional access at the advertised ten-minute boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T18:00:00.000Z"));
    const persist = vi.fn(async () => undefined);
    const registry = new DeviceRegistry([], persist);
    const pairing = registry.issuePairing("Expiring phone");
    const provisional = await registry.provision(pairing.token, REQUEST_ID);
    if (provisional.status !== "provisional") throw new Error("Expected provisional access.");

    vi.setSystemTime(new Date(new Date(pairing.expiresAt).getTime() - 1));
    expect(registry.preview(pairing.token)).not.toBeNull();
    vi.setSystemTime(new Date(pairing.expiresAt));
    await expect(registry.confirm(provisional.device.password)).resolves.toEqual({
      status: "invalid",
    });
    expect(registry.pairingState(pairing.id).status).toBe("expired");
    expect(registry.preview(pairing.token)).toBeNull();
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects invalid request IDs and names before persistence", async () => {
    const persist = vi.fn(async () => undefined);
    const registry = new DeviceRegistry([EXISTING_DEVICE], persist);
    const shortRequestPairing = registry.issuePairing("Test phone");

    await expect(registry.provision(shortRequestPairing.token, "short")).rejects.toThrow(
      "Request IDs must be",
    );
    await expect(registry.rename(EXISTING_DEVICE.id, "   ")).rejects.toThrow("Enter a name.");
    await expect(registry.rename(EXISTING_DEVICE.id, "x".repeat(81))).rejects.toThrow(
      "Names can be at most 80 characters.",
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not mutate names or access when persistence fails", async () => {
    const persist = vi.fn(async () => {
      throw new Error("save failed");
    });
    const registry = new DeviceRegistry([EXISTING_DEVICE], persist);

    await expect(registry.rename(EXISTING_DEVICE.id, "New name")).rejects.toThrow("save failed");
    expect(registry.list()).toEqual([EXISTING_DEVICE]);

    await expect(registry.revoke(EXISTING_DEVICE.id)).rejects.toThrow("save failed");
    expect(registry.list()).toEqual([EXISTING_DEVICE]);
  });
});
