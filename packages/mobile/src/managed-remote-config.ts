export interface ManagedRemoteConfig {
  readonly relayOrigin: string;
  readonly relayZone: string;
}

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

/**
 * Resolves public managed-remote configuration from Expo's untrusted `extra` payload.
 *
 * Deployment values are deliberately injected by the app config. An absent or malformed
 * configuration disables managed remote access instead of falling back to a baked-in service.
 */
export function resolveManagedRemoteConfig(extra: unknown): ManagedRemoteConfig | null {
  if (!isRecord(extra)) return null;
  const managedRemote = Reflect.get(extra, "managedRemote");
  if (!isRecord(managedRemote)) return null;

  const relayOrigin = canonicalHttpsOrigin(Reflect.get(managedRemote, "relayOrigin"));
  const relayZone = canonicalDnsZone(Reflect.get(managedRemote, "relayZone"));
  if (relayOrigin === null || relayZone === null) return null;
  return Object.freeze({ relayOrigin, relayZone });
}

function canonicalHttpsOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      !/^\/+$/u.test(url.pathname)
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function canonicalDnsZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const zone = value.trim().toLowerCase();
  if (
    zone.length === 0 ||
    zone.length > 253 ||
    !zone.includes(".") ||
    zone.endsWith(".") ||
    zone.split(".").some((label) => !DNS_LABEL.test(label)) ||
    /^\d+\.\d+\.\d+\.\d+$/u.test(zone)
  ) {
    return null;
  }
  return zone;
}

function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
