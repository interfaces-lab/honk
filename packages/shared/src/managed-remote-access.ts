import { Option, Schema } from "effect";

import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./base-schemas";

export const ManagedEnvironmentId = TrimmedNonEmptyString.pipe(
  Schema.brand("ManagedEnvironmentId"),
);
export type ManagedEnvironmentId = typeof ManagedEnvironmentId.Type;

export const ManagedAllocationGeneration = NonNegativeInt.pipe(
  Schema.brand("ManagedAllocationGeneration"),
);
export type ManagedAllocationGeneration = typeof ManagedAllocationGeneration.Type;

export const ManagedRemoteProviderKind = Schema.Literal("cloudflare_tunnel");
export type ManagedRemoteProviderKind = typeof ManagedRemoteProviderKind.Type;

export const ManagedRemoteEndpointWire = Schema.Struct({
  providerKind: ManagedRemoteProviderKind,
  httpBaseUrl: Schema.String,
  wsBaseUrl: Schema.String,
});
export type ManagedRemoteEndpointWire = typeof ManagedRemoteEndpointWire.Type;

const CanonicalManagedRemoteEndpoint = ManagedRemoteEndpointWire.pipe(
  Schema.brand("ManagedRemoteEndpoint"),
);
export type ManagedRemoteEndpoint = typeof CanonicalManagedRemoteEndpoint.Type;

export const ManagedEnvironmentStatus = Schema.Literals(["online", "offline", "unknown"]);
export type ManagedEnvironmentStatus = typeof ManagedEnvironmentStatus.Type;

export const ManagedEnvironmentSummaryWire = Schema.Struct({
  environmentId: ManagedEnvironmentId,
  label: TrimmedNonEmptyString,
  endpoint: ManagedRemoteEndpointWire,
  status: ManagedEnvironmentStatus,
  lastSeenAt: Schema.optional(IsoDateTime),
});
export type ManagedEnvironmentSummaryWire = typeof ManagedEnvironmentSummaryWire.Type;

const CanonicalManagedEnvironmentSummary = Schema.Struct({
  environmentId: ManagedEnvironmentId,
  label: TrimmedNonEmptyString,
  endpoint: CanonicalManagedRemoteEndpoint,
  status: ManagedEnvironmentStatus,
  lastSeenAt: Schema.optional(IsoDateTime),
}).pipe(Schema.brand("ManagedEnvironmentSummary"));
export type ManagedEnvironmentSummary = typeof CanonicalManagedEnvironmentSummary.Type;

const decodeManagedRemoteEndpoint = Schema.decodeUnknownOption(ManagedRemoteEndpointWire);
const decodeManagedEnvironmentSummary = Schema.decodeUnknownOption(ManagedEnvironmentSummaryWire);
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Decode a relay endpoint and require its one-host HTTPS/WSS authority.
 *
 * Redirect policy and certificate validation remain request-time checks.
 */
export function canonicalManagedRemoteEndpoint(
  input: unknown,
  relayZone: string,
): ManagedRemoteEndpoint | null {
  const decoded = Option.getOrNull(decodeManagedRemoteEndpoint(input));
  const zone = relayZone.trim().toLowerCase();
  if (decoded === null || !isCanonicalDnsName(zone)) return null;
  if (!URL.canParse(decoded.httpBaseUrl) || !URL.canParse(decoded.wsBaseUrl)) return null;

  const http = new URL(decoded.httpBaseUrl);
  const ws = new URL(decoded.wsBaseUrl);
  const suffix = `.${zone}`;
  const hostname = http.hostname;
  const label = hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : "";
  if (
    http.protocol !== "https:" ||
    http.username.length > 0 ||
    http.password.length > 0 ||
    http.pathname !== "/" ||
    http.search.length > 0 ||
    http.hash.length > 0 ||
    http.port.length > 0 ||
    hostname.length > 253 ||
    hostname !== hostname.toLowerCase() ||
    !DNS_LABEL.test(label) ||
    label.includes(".") ||
    decoded.httpBaseUrl !== `https://${hostname}/` ||
    decoded.wsBaseUrl !== `wss://${hostname}/`
  ) {
    return null;
  }
  if (
    ws.protocol !== "wss:" ||
    ws.hostname !== hostname ||
    ws.username.length > 0 ||
    ws.password.length > 0 ||
    ws.pathname !== "/" ||
    ws.search.length > 0 ||
    ws.hash.length > 0 ||
    ws.port.length > 0
  ) {
    return null;
  }
  return Object.freeze(CanonicalManagedRemoteEndpoint.make(decoded));
}

export function canonicalManagedEnvironmentSummary(
  input: unknown,
  relayZone: string,
): ManagedEnvironmentSummary | null {
  const decoded = Option.getOrNull(decodeManagedEnvironmentSummary(input));
  if (decoded === null) return null;
  const endpoint = canonicalManagedRemoteEndpoint(decoded.endpoint, relayZone);
  if (endpoint === null) return null;
  return Object.freeze(CanonicalManagedEnvironmentSummary.make({ ...decoded, endpoint }));
}

function isCanonicalDnsName(value: string): boolean {
  return (
    value.length <= 253 &&
    value.includes(".") &&
    value.split(".").every((label) => DNS_LABEL.test(label))
  );
}
