import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { DeviceRecord } from "./state";

const PAIRING_TTL_MS = 10 * 60 * 1000;

interface PairingGrant {
  readonly expiresAt: number;
  readonly label: string;
}

export interface IssuedPairing {
  readonly token: string;
  readonly expiresAt: string;
}

export interface IssuedDevice {
  readonly id: string;
  readonly label: string;
  readonly password: string;
}

const hashSecret = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const equalHash = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

export class DeviceRegistry {
  readonly #pairings = new Map<string, PairingGrant>();
  #devices: DeviceRecord[];
  readonly #persist: (devices: readonly DeviceRecord[]) => Promise<void>;

  constructor(
    devices: readonly DeviceRecord[],
    persist: (devices: readonly DeviceRecord[]) => Promise<void>,
  ) {
    this.#devices = [...devices];
    this.#persist = persist;
  }

  list(): readonly DeviceRecord[] {
    return this.#devices.map((device) => ({ ...device }));
  }

  issuePairing(label = "New device"): IssuedPairing {
    const now = Date.now();
    for (const [key, grant] of this.#pairings) {
      if (grant.expiresAt < now) this.#pairings.delete(key);
    }
    const token = randomBytes(24).toString("base64url");
    const expiresAt = now + PAIRING_TTL_MS;
    this.#pairings.set(hashSecret(token), { expiresAt, label });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  async exchange(token: string, requestedLabel?: string): Promise<IssuedDevice | null> {
    const key = hashSecret(token);
    const grant = this.#pairings.get(key);
    this.#pairings.delete(key);
    if (grant === undefined || grant.expiresAt < Date.now()) return null;

    const password = randomBytes(32).toString("base64url");
    const device: DeviceRecord = {
      id: randomBytes(12).toString("hex"),
      label: requestedLabel?.trim() || grant.label,
      passwordHash: hashSecret(password),
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    this.#devices = [...this.#devices, device];
    await this.#persist(this.#devices);
    return { id: device.id, label: device.label, password };
  }

  authenticate(password: string): DeviceRecord | null {
    const candidate = hashSecret(password);
    return (
      this.#devices.find(
        (device) => device.revokedAt === null && equalHash(device.passwordHash, candidate),
      ) ?? null
    );
  }

  async revoke(id: string): Promise<boolean> {
    let found = false;
    this.#devices = this.#devices.map((device) => {
      if (device.id !== id || device.revokedAt !== null) return device;
      found = true;
      return { ...device, revokedAt: new Date().toISOString() };
    });
    if (found) await this.#persist(this.#devices);
    return found;
  }
}
