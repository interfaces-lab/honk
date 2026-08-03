import { openCodeServerKey, type OpenCodeServerKey } from "@honk/opencode";

import { normalizeRemoteOrigin } from "./pairing";

export const REGISTRY_SCHEMA = "honk.mobile.opencode.servers";
export const REGISTRY_VERSION = 3;
const CREDENTIAL_STORAGE_PREFIX = "honk.mobile.opencode.credential.";

export interface StoredServer {
  readonly environmentId?: string | null;
  readonly deviceId?: string | null;
  readonly proofKeyThumbprint?: string | null;
  readonly origin: string;
  readonly label: string;
  readonly defaultDirectory: string;
  readonly serverId: string | null;
}

export interface StoredRegistry {
  readonly schema: typeof REGISTRY_SCHEMA;
  readonly version: typeof REGISTRY_VERSION;
  readonly activeServerKey: string | null;
  readonly pendingCredentialOrigins: readonly string[];
  readonly servers: readonly StoredServer[];
}

export function serverKeyHash(value: string): string {
  // More saved origins per computer increase this 32-bit hash's birthday exposure. A collision
  // degrades to "password not found", not a leak, because credential reads re-check the saved origin.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function credentialStorageKey(origin: string): string {
  // Credentials stay keyed by origin so existing installs keep their passwords. Identity is an
  // attribute of the saved server, not its registry key.
  return `${CREDENTIAL_STORAGE_PREFIX}${serverKeyHash(origin)}`;
}

export function decodeStoredRegistry(raw: string | object | null): StoredRegistry {
  if (raw === null) {
    return {
      schema: REGISTRY_SCHEMA,
      version: REGISTRY_VERSION,
      activeServerKey: null,
      pendingCredentialOrigins: [],
      servers: [],
    };
  }
  const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The saved Honk server registry is invalid.");
  }
  const version = Reflect.get(value, "version");
  if (
    Reflect.get(value, "schema") !== REGISTRY_SCHEMA ||
    (version !== 1 && version !== 2 && version !== REGISTRY_VERSION)
  ) {
    throw new Error("The saved Honk server registry uses an unsupported format.");
  }
  const active = Reflect.get(value, "activeServerKey");
  const servers = Reflect.get(value, "servers");
  if ((active !== null && typeof active !== "string") || !Array.isArray(servers)) {
    throw new Error("The saved Honk server registry is incomplete.");
  }
  const decoded = servers.map<StoredServer>((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("A saved Honk server is invalid.");
    }
    const origin = Reflect.get(item, "origin");
    const label = Reflect.get(item, "label");
    const defaultDirectory = Reflect.get(item, "defaultDirectory");
    const serverId = Reflect.get(item, "serverId");
    if (
      typeof origin !== "string" ||
      typeof label !== "string" ||
      typeof defaultDirectory !== "string"
    ) {
      throw new Error("A saved Honk server is incomplete.");
    }
    return {
      environmentId:
        version === REGISTRY_VERSION ? decodeOptionalIdentifier(item, "environmentId") : null,
      deviceId: version === REGISTRY_VERSION ? decodeOptionalIdentifier(item, "deviceId") : null,
      proofKeyThumbprint:
        version === REGISTRY_VERSION ? decodeOptionalIdentifier(item, "proofKeyThumbprint") : null,
      origin: normalizeRemoteOrigin(origin),
      label: label.trim(),
      defaultDirectory: defaultDirectory.trim(),
      serverId: typeof serverId === "string" && serverId.length > 0 ? serverId : null,
    };
  });
  const environmentIds = decoded.flatMap((server) =>
    server.environmentId === null || server.environmentId === undefined
      ? []
      : [server.environmentId],
  );
  if (new Set(environmentIds).size !== environmentIds.length) {
    throw new Error("The saved Honk server registry contains a duplicate environment.");
  }
  const activeServerKey = validActiveServerKey(active, decoded);
  return {
    schema: REGISTRY_SCHEMA,
    version: REGISTRY_VERSION,
    activeServerKey,
    pendingCredentialOrigins:
      version === REGISTRY_VERSION ? decodePendingCredentialOrigins(value) : [],
    servers: decoded,
  };
}

function decodeOptionalIdentifier(item: object, field: string): string | null {
  const value = Reflect.get(item, field);
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  throw new Error(`A saved Honk server has an invalid ${field}.`);
}

function decodePendingCredentialOrigins(value: object): readonly string[] {
  const pending = Reflect.get(value, "pendingCredentialOrigins");
  if (pending === undefined) return [];
  if (!Array.isArray(pending)) {
    throw new Error("The saved Honk server registry has invalid credential cleanup.");
  }
  const origins = pending.map((origin) => {
    if (typeof origin !== "string") {
      throw new Error("The saved Honk server registry has invalid credential cleanup.");
    }
    return normalizeRemoteOrigin(origin);
  });
  if (new Set(origins).size !== origins.length) {
    throw new Error("The saved Honk server registry has duplicate credential cleanup.");
  }
  return origins;
}

function validActiveServerKey(active: unknown, servers: readonly StoredServer[]): string | null {
  if (typeof active !== "string") return null;
  try {
    const normalized = normalizeRemoteOrigin(active);
    return servers.some((server) => server.origin === normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export function storedRegistry(
  servers: ReadonlyMap<OpenCodeServerKey, StoredServer>,
  activeServerKey: OpenCodeServerKey | null,
  pendingCredentialOrigins: readonly string[] = [],
): StoredRegistry {
  return {
    schema: REGISTRY_SCHEMA,
    version: REGISTRY_VERSION,
    activeServerKey,
    pendingCredentialOrigins,
    servers: [...servers.values()],
  };
}

export function storedServerMap(
  registry: StoredRegistry,
): ReadonlyMap<OpenCodeServerKey, StoredServer> {
  return new Map(registry.servers.map((server) => [openCodeServerKey(server.origin), server]));
}

export function sameStoredRegistry(
  leftServers: ReadonlyMap<OpenCodeServerKey, StoredServer>,
  leftActiveServerKey: OpenCodeServerKey | null,
  rightServers: ReadonlyMap<OpenCodeServerKey, StoredServer>,
  rightActiveServerKey: OpenCodeServerKey | null,
): boolean {
  return (
    leftActiveServerKey === rightActiveServerKey &&
    leftServers.size === rightServers.size &&
    [...leftServers].every(([key, server]) => {
      const other = rightServers.get(key);
      return (
        other !== undefined &&
        other.origin === server.origin &&
        other.label === server.label &&
        other.defaultDirectory === server.defaultDirectory &&
        other.serverId === server.serverId &&
        (other.environmentId ?? null) === (server.environmentId ?? null) &&
        (other.deviceId ?? null) === (server.deviceId ?? null) &&
        (other.proofKeyThumbprint ?? null) === (server.proofKeyThumbprint ?? null)
      );
    })
  );
}

/**
 * The saved entry for this same computer at a different address, or null. Identity is only ever
 * consulted inside a pairing the person just started: `/honk/pair/preview` is unauthenticated, so
 * acting on a claimed id anywhere else would let any LAN peer relocate a saved connection.
 */
export function findRebindableServer(
  servers: ReadonlyMap<OpenCodeServerKey, StoredServer>,
  origin: string,
  serverId: string | null,
): readonly [OpenCodeServerKey, StoredServer] | null {
  if (serverId === null) return null;
  const key = openCodeServerKey(origin);
  return (
    [...servers].find(([storedKey, stored]) => storedKey !== key && stored.serverId === serverId) ??
    null
  );
}
