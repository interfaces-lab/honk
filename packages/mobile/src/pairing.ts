import { normalizeOpenCodeOrigin, parseOpenCodeConnection } from "@honk/opencode";

export { parseOpenCodeConnection };

const isLoopback = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname === "127.0.0.1" ||
  hostname.startsWith("127.") ||
  hostname === "::1" ||
  hostname === "[::1]";

export function normalizeRemoteOrigin(value: string): string {
  const origin = normalizeOpenCodeOrigin(value);
  const url = new URL(origin);
  if (url.protocol !== "https:" && !isLoopback(url.hostname)) {
    throw new Error("Remote Honk hosts must use HTTPS.");
  }
  return origin;
}
