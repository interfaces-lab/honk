import { isLoopbackHost, normalizeOpenCodeOrigin } from "./connection";
import { isPrivateNetworkHost } from "./private-host";

// Native clients may reach a computer on the same network over HTTP. Browser clients must keep using
// normalizeRemoteOpenCodeOrigin, so this module is not re-exported from the package barrel.
export function normalizeNativeOpenCodeOrigin(value: string): string {
  const origin = normalizeOpenCodeOrigin(value);
  const url = new URL(origin);
  if (url.protocol === "https:") return origin;
  if (isLoopbackHost(url.hostname) || isPrivateNetworkHost(url.hostname)) return origin;
  throw new Error("Connections over the internet must use HTTPS.");
}
