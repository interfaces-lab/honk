import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface DeviceRecord {
  readonly id: string;
  readonly label: string;
  readonly passwordHash: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface HostState {
  readonly version: 1;
  readonly pid: number;
  readonly adminSecret: string;
  readonly origin: string;
  readonly publicUrl: string;
  readonly upstreamOrigin: string;
  readonly cwd: string;
  readonly devices: readonly DeviceRecord[];
}

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

const decodeDevice = (value: unknown): DeviceRecord | null => {
  if (!isObject(value)) return null;
  const id = Reflect.get(value, "id");
  const label = Reflect.get(value, "label");
  const passwordHash = Reflect.get(value, "passwordHash");
  const createdAt = Reflect.get(value, "createdAt");
  const revokedAt = Reflect.get(value, "revokedAt");
  if (
    typeof id !== "string" ||
    typeof label !== "string" ||
    typeof passwordHash !== "string" ||
    typeof createdAt !== "string" ||
    (revokedAt !== null && typeof revokedAt !== "string")
  ) {
    return null;
  }
  return { id, label, passwordHash, createdAt, revokedAt };
};

const decodeHostState = (value: unknown): HostState | null => {
  if (!isObject(value) || Reflect.get(value, "version") !== 1) return null;
  const pid = Reflect.get(value, "pid");
  const adminSecret = Reflect.get(value, "adminSecret");
  const origin = Reflect.get(value, "origin");
  const publicUrl = Reflect.get(value, "publicUrl");
  const upstreamOrigin = Reflect.get(value, "upstreamOrigin");
  const cwd = Reflect.get(value, "cwd");
  const rawDevices = Reflect.get(value, "devices");
  if (
    typeof pid !== "number" ||
    typeof adminSecret !== "string" ||
    typeof origin !== "string" ||
    typeof publicUrl !== "string" ||
    typeof upstreamOrigin !== "string" ||
    typeof cwd !== "string" ||
    !Array.isArray(rawDevices)
  ) {
    return null;
  }
  const devices: DeviceRecord[] = [];
  for (const rawDevice of rawDevices) {
    const device = decodeDevice(rawDevice);
    if (device === null) return null;
    devices.push(device);
  }
  return { version: 1, pid, adminSecret, origin, publicUrl, upstreamOrigin, cwd, devices };
};

export const resolveStatePath = (): string => {
  const home = process.env.HONK_HOME?.trim();
  return join(home && home.length > 0 ? home : join(homedir(), ".honk"), "host.json");
};

export async function readHostState(path = resolveStatePath()): Promise<HostState | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return decodeHostState(parsed);
  } catch (error) {
    if (isObject(error) && Reflect.get(error, "code") === "ENOENT") return null;
    return null;
  }
}

export async function writeHostState(state: HostState, path = resolveStatePath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export const freshAdminSecret = (): string => randomBytes(32).toString("base64url");
