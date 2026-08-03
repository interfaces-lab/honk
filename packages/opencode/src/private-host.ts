// This matches Apple's local-network allowance except carrier-grade NAT. 100.64.0.0/10 is also a
// live internet path on mobile carriers, while Tailscale mode already terminates HTTPS. Callers must
// pass a parsed URL hostname because the WHATWG parser canonicalizes alternate IPv4 spellings.
export function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.endsWith(".local")) return true;
  const octets = host.split(".");
  if (octets.length !== 4) return false;
  if (octets.some((octet) => !/^\d{1,3}$/.test(octet))) return false;
  const first = Number(octets[0]);
  const second = Number(octets[1]);
  if (first === 10) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  return first === 169 && second === 254;
}
