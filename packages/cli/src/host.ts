import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  createServer,
  request as requestHttp,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import { connect as connectTcp } from "node:net";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Duplex } from "node:stream";

import {
  DeviceRegistry,
  normalizeRemoteDisplayName,
  PairingRequestIDError,
  RemoteDisplayNameError,
  type PairingState,
} from "./auth";
import { writeHostState, type DeviceRecord, type HostState } from "./state";

export {
  acquireCloudflaredExecutable,
  clearCloudflaredTunnelRecord,
  CLOUDFLARED_VERSION,
  CloudflaredAcquisitionError,
  CloudflaredTunnelError,
  CloudflaredTunnelTimeoutError,
  CloudflaredUnavailableError,
  managedCloudflaredExecutablePath,
  parseCloudflaredQuickTunnelUrl,
  probeCloudflaredExecutable,
  readCloudflaredTunnelRecord,
  reclaimOrphanedCloudflaredTunnel,
  resolveCloudflaredExecutable,
  resolveCloudflaredReleaseAsset,
  startCloudflaredQuickTunnel,
  writeCloudflaredTunnelRecord,
  type CloudflaredAcquisitionFailureReason,
  type CloudflaredAcquisitionOptions,
  type CloudflaredArchiveExtractor,
  type CloudflaredDownloader,
  type CloudflaredOptions,
  type CloudflaredProcessInspector,
  type CloudflaredQuickTunnel,
  type CloudflaredReleaseAsset,
  type CloudflaredSpawner,
  type CloudflaredTunnelRecord,
} from "./tunnel";
export {
  ManagedCloudflaredConfigurationError,
  ManagedCloudflaredExitError,
  ManagedCloudflaredStartError,
  ManagedCloudflaredTimeoutError,
  startManagedCloudflaredConnector,
  type ManagedCloudflaredConnector,
  type ManagedCloudflaredConnectorOptions,
  type ManagedCloudflaredExit,
  type ManagedCloudflaredOutput,
  type ManagedCloudflaredOutputLevel,
  type ManagedCloudflaredSpawner,
  type ManagedCloudflaredSpawnRequest,
  type ManagedCloudflaredTimers,
} from "./managed-tunnel";
export {
  cleanupLocalCloudflaredConfiguration,
  LocalCloudflaredCleanupError,
  LocalCloudflaredMaterializationError,
  materializeLocalCloudflaredConfiguration,
  type LocalCloudflaredCleanupOptions,
  type LocalCloudflaredMaterialization,
  type LocalCloudflaredMaterializationFailureReason,
  type LocalCloudflaredMaterializationOptions,
  type WindowsOwnerProtection,
  type WindowsOwnerProtectionInput,
} from "./local-cloudflared-config";
export {
  buildTailscaleHttpsUrl,
  disableTailscaleHttpsServe,
  enableTailscaleHttpsServe,
  parseTailscaleStatus,
  readTailscaleStatus,
  resolveTailscaleHttpsEndpoint,
  TailscaleServeError,
  TailscaleServeNotEnabledError,
  TailscaleStatusError,
  TailscaleUnavailableError,
  type TailscaleCommandOptions,
  type TailscaleCommandRequest,
  type TailscaleCommandResult,
  type TailscaleCommandRunner,
  type TailscaleHttpsEndpoint,
  type TailscaleStatus,
} from "./tailscale";
export {
  normalizeRemoteDisplayName,
  REMOTE_DISPLAY_NAME_MAX_LENGTH,
  RemoteDisplayNameError,
} from "./auth";

const COOKIE_NAME = "honk_device";
const PROVISIONAL_COOKIE_NAME = "honk_pairing_provisional";
const MAX_ADMIN_BODY_BYTES = 64 * 1024;

export interface HonkHostOptions {
  readonly name: string;
  readonly hostname: string;
  readonly port: number;
  readonly publicUrl?: string;
  readonly trustLoopbackForwardedFor?: boolean;
  readonly upstreamOrigin: string;
  readonly upstreamPassword: string;
  readonly cwd: string;
  readonly appDist?: string;
  readonly adminSecret: string;
  readonly serverId: string;
  readonly devices: readonly DeviceRecord[];
  readonly statePath: string;
}

export interface PairingLink {
  readonly id: string;
  readonly url: string | null;
  readonly mobileUrl: string;
  readonly expiresAt: string;
}

export interface HonkHost {
  readonly origin: string;
  readonly publicUrl: string;
  readonly issuePairing: (label?: string) => PairingLink;
  readonly pairingState: (pairingID: string) => PairingState;
  readonly cancelPairing: (pairingID: string) => Promise<boolean>;
  readonly devices: () => readonly DeviceRecord[];
  readonly setName: (name: string) => string;
  readonly renameDevice: (deviceID: string, label: string) => Promise<boolean>;
  readonly revokeDevice: (deviceID: string) => Promise<boolean>;
  readonly close: () => Promise<void>;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

const normalizedBaseUrl = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The public Honk URL must use HTTP or HTTPS.");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("The public Honk URL cannot contain credentials.");
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new Error("The public Honk URL must be an origin without a path.");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
};

const hostForUrl = (hostname: string): string =>
  hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;

// crypto.randomUUID and crypto.subtle are secure-context only, so a browser cannot complete
// pairing against a plaintext non-loopback origin. Loopback still counts as a secure context.
const supportsBrowserPairing = (publicUrl: string): boolean => {
  const url = new URL(publicUrl);
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  return (
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.startsWith("127.") ||
    url.hostname === "[::1]" ||
    url.hostname === "::1"
  );
};

const hash = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

const secretEquals = (left: string, right: string): boolean =>
  timingSafeEqual(hash(left), hash(right));

const json = (response: ServerResponse, status: number, value: unknown): void => {
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(body);
};

const isDesktopClientOrigin = (origin: string): boolean => {
  if (origin === "honk://desktop") return true;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname.endsWith(".localhost") ||
        url.hostname === "127.0.0.1" ||
        url.hostname.startsWith("127."))
    );
  } catch {
    return false;
  }
};

// CORS is not authentication; absent-Origin traffic is authorized only by pairing capability or
// device credential.
const setCors = (
  request: IncomingMessage,
  response: ServerResponse,
  publicUrl: string,
): boolean => {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  let trusted = false;
  try {
    trusted = new URL(origin).origin === new URL(publicUrl).origin || isDesktopClientOrigin(origin);
  } catch {
    trusted = false;
  }
  if (!trusted) return false;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader(
    "access-control-allow-methods",
    "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  response.setHeader(
    "access-control-allow-headers",
    "authorization, content-type, x-opencode-directory, x-opencode-workspace",
  );
  response.setHeader("access-control-allow-credentials", "true");
  response.setHeader("vary", "Origin");
  return true;
};

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_ADMIN_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(bytes);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
};

const bearerFrom = (request: IncomingMessage): string | null => {
  const authorization = request.headers.authorization;
  if (authorization === undefined || !authorization.startsWith("Bearer ")) return null;
  const secret = authorization.slice("Bearer ".length).trim();
  return secret.length > 0 ? secret : null;
};

const isBasicAuthorization = (authorization: string | undefined): boolean =>
  authorization?.slice(0, "Basic ".length).toLowerCase() === "basic ";

const basicAuthorizationPasswordFrom = (authorization: string | undefined): string | null => {
  if (authorization === undefined || !isBasicAuthorization(authorization)) return null;
  try {
    const decoded = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return separator >= 0 && decoded.slice(0, separator) === "opencode"
      ? decoded.slice(separator + 1)
      : null;
  } catch {
    return null;
  }
};

const cookiePasswordFrom = (request: IncomingMessage, name: string): string | null => {
  const cookie = request.headers.cookie;
  if (cookie === undefined) return null;
  for (const entry of cookie.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
};

const basicPasswordFrom = (request: IncomingMessage): string | null =>
  basicAuthorizationPasswordFrom(request.headers.authorization) ??
  cookiePasswordFrom(request, COOKIE_NAME);

const pairingUrl = (publicUrl: string, token: string): string => {
  const url = new URL("/", `${publicUrl}/`);
  url.hash = new URLSearchParams({ pairing: token }).toString();
  return url.toString();
};

const mobilePairingUrl = (publicUrl: string, token: string): string => {
  const query = new URLSearchParams({ origin: publicUrl });
  const fragment = new URLSearchParams({ pairing: token });
  return `honk://connect?${query.toString()}#${fragment.toString()}`;
};

const pairingLink = (
  publicUrl: string,
  id: string,
  token: string,
  expiresAt: string,
): PairingLink => ({
  id,
  url: supportsBrowserPairing(publicUrl) ? pairingUrl(publicUrl, token) : null,
  mobileUrl: mobilePairingUrl(publicUrl, token),
  expiresAt,
});

const authCookie = (
  publicUrl: string,
  name: string,
  password: string,
  maxAge: number,
  path: string,
): string => {
  const secure = publicUrl.startsWith("https:") ? "; Secure" : "";
  return `${name}=${encodeURIComponent(password)}; HttpOnly; Path=${path}; SameSite=Strict; Max-Age=${maxAge}${secure}`;
};

const setAuthCookies = (
  response: ServerResponse,
  publicUrl: string,
  cookies: readonly string[],
): void => {
  if (!supportsBrowserPairing(publicUrl)) return;
  response.setHeader("set-cookie", [...cookies]);
};

const sanitizedProxyHeaders = (
  headers: IncomingHttpHeaders,
  upstream: URL,
  upstreamPassword: string,
): OutgoingHttpHeaders => {
  const output: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLocaleLowerCase();
    if (
      lower === "authorization" ||
      lower === "cookie" ||
      lower === "connection" ||
      lower === "host" ||
      lower === "proxy-authorization"
    ) {
      continue;
    }
    output[name] = value;
  }
  output.host = upstream.host;
  output.authorization = `Basic ${Buffer.from(`opencode:${upstreamPassword}`, "utf8").toString("base64")}`;
  return output;
};

const copyProxyResponseHeaders = (headers: IncomingHttpHeaders, response: ServerResponse): void => {
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLocaleLowerCase();
    if (
      lower.startsWith("access-control-") ||
      lower === "connection" ||
      lower === "keep-alive" ||
      lower === "set-cookie" ||
      lower === "transfer-encoding"
    ) {
      continue;
    }
    if (value !== undefined) response.setHeader(name, value);
  }
};

const proxyHttp = (
  request: IncomingMessage,
  response: ServerResponse,
  upstreamOrigin: string,
  upstreamPassword: string,
  publicUrl: string,
): void => {
  const target = new URL(request.url ?? "/", `${upstreamOrigin}/`);
  const upstream = requestHttp(
    target,
    {
      method: request.method,
      headers: sanitizedProxyHeaders(request.headers, target, upstreamPassword),
    },
    (upstreamResponse) => {
      response.statusCode = upstreamResponse.statusCode ?? 502;
      copyProxyResponseHeaders(upstreamResponse.headers, response);
      setCors(request, response, publicUrl);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    json(response, 502, { error: "OpenCode is still starting." });
  });
  request.on("aborted", () => upstream.destroy());
  request.pipe(upstream);
};

const sendUpgradeUnauthorized = (socket: Duplex): void => {
  socket.end(
    "HTTP/1.1 401 Unauthorized\r\n" +
      'WWW-Authenticate: Basic realm="Honk"\r\n' +
      "Connection: close\r\n\r\n",
  );
};

const proxyUpgrade = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  upstreamOrigin: string,
  upstreamPassword: string,
): void => {
  const upstreamUrl = new URL(upstreamOrigin);
  const port = Number(upstreamUrl.port || (upstreamUrl.protocol === "https:" ? 443 : 80));
  if (upstreamUrl.protocol !== "http:") {
    socket.destroy(new Error("The managed OpenCode upstream must use HTTP."));
    return;
  }
  const upstream = connectTcp(port, upstreamUrl.hostname);
  upstream.once("connect", () => {
    const lines = [`${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}`];
    for (const [name, value] of Object.entries(request.headers)) {
      const lower = name.toLocaleLowerCase();
      if (lower === "authorization" || lower === "cookie" || lower === "host") continue;
      if (Array.isArray(value)) {
        for (const entry of value) lines.push(`${name}: ${entry}`);
      } else if (value !== undefined) {
        lines.push(`${name}: ${value}`);
      }
    }
    lines.push(`host: ${upstreamUrl.host}`);
    lines.push(
      `authorization: Basic ${Buffer.from(`opencode:${upstreamPassword}`, "utf8").toString("base64")}`,
    );
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.once("error", (error) => socket.destroy(error));
  socket.once("error", () => upstream.destroy());
  socket.once("close", () => upstream.destroy());
};

const fileWithin = (root: string, pathname: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidate = resolve(root, `.${decoded}`);
  const child = relative(root, candidate);
  if (child === "" || child.startsWith(`..${sep}`) || child === ".." || isAbsolute(child)) {
    return null;
  }
  return candidate;
};

const serveFile = async (
  request: IncomingMessage,
  response: ServerResponse,
  file: string,
  cache: "index" | "asset",
): Promise<boolean> => {
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    response.statusCode = 200;
    response.setHeader(
      "content-type",
      MIME_TYPES[extname(file).toLocaleLowerCase()] ?? "application/octet-stream",
    );
    response.setHeader("content-length", info.size);
    response.setHeader(
      "cache-control",
      cache === "index" ? "no-store" : "public, max-age=31536000, immutable",
    );
    if (request.method === "HEAD") {
      response.end();
    } else {
      createReadStream(file).pipe(response);
    }
    return true;
  } catch {
    return false;
  }
};

const probeUpstream = async (origin: string, password: string): Promise<boolean> => {
  try {
    const authorization = Buffer.from(`opencode:${password}`, "utf8").toString("base64");
    const response = await fetch(new URL("/global/health", origin), {
      headers: { authorization: `Basic ${authorization}` },
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const CAPACITY = 10;
const REFILL_MS = 6_000;
const MAX_CLIENTS = 1_000;
const UPSTREAM_PROBE_TTL_MS = 3_000;

export interface RateBucket {
  readonly tokens: number;
  readonly updatedAt: number;
}

/**
 * Token bucket per client: 10 attempts, then one more every 6s. Returns 0 when the request may
 * proceed, otherwise the seconds to wait. Keeps password hashing and provisioning writes out of
 * reach of a scripted scan once the host is reachable from outside the machine.
 */
export function takePairingToken(
  buckets: Map<string, RateBucket>,
  client: string,
  now: number,
): number {
  const bucket = buckets.get(client) ?? { tokens: CAPACITY, updatedAt: now };
  const tokens = Math.min(CAPACITY, bucket.tokens + (now - bucket.updatedAt) / REFILL_MS);
  if (tokens < 1) {
    buckets.set(client, { tokens, updatedAt: now });
    return Math.ceil(((1 - tokens) * REFILL_MS) / 1_000);
  }
  buckets.set(client, { tokens: tokens - 1, updatedAt: now });
  if (buckets.size > MAX_CLIENTS) evictIdleBuckets(buckets, now);
  return 0;
}

// A fully refilled bucket carries no state worth keeping; trim oldest-first if a flood of
// distinct addresses still leaves the map over its cap.
function evictIdleBuckets(buckets: Map<string, RateBucket>, now: number): void {
  for (const [client, bucket] of buckets) {
    if (now - bucket.updatedAt < CAPACITY * REFILL_MS) continue;
    buckets.delete(client);
  }
  for (const client of buckets.keys()) {
    if (buckets.size <= MAX_CLIENTS) return;
    buckets.delete(client);
  }
}

export async function startHonkHost(options: HonkHostOptions): Promise<HonkHost> {
  const appRoot = options.appDist === undefined ? null : resolve(options.appDist);
  const indexFile = appRoot === null ? null : resolve(appRoot, "index.html");
  if (indexFile !== null) {
    const indexInfo = await stat(indexFile).catch(() => null);
    if (indexInfo === null || !indexInfo.isFile()) {
      throw new Error(`Honk web assets were not found at ${appRoot}. Build @honk/app first.`);
    }
  }

  let state: HostState;
  const registry = new DeviceRegistry(options.devices, async (devices) => {
    const nextState = { ...state, devices };
    await writeHostState(nextState, options.statePath);
    state = nextState;
  });
  const socketsByDevice = new Map<string, Set<Duplex>>();
  const pairingRateBuckets = new Map<string, RateBucket>();
  const upstreamProbeCache: {
    value: boolean | null;
    expiresAt: number;
    inFlight: Promise<boolean> | null;
  } = {
    value: null,
    expiresAt: 0,
    inFlight: null,
  };
  let displayName = normalizeRemoteDisplayName(options.name);

  const cachedProbeUpstream = (): Promise<boolean> => {
    if (upstreamProbeCache.value !== null && Date.now() < upstreamProbeCache.expiresAt) {
      return Promise.resolve(upstreamProbeCache.value);
    }
    if (upstreamProbeCache.inFlight !== null) return upstreamProbeCache.inFlight;
    const inFlight = probeUpstream(options.upstreamOrigin, options.upstreamPassword).then(
      (value) => {
        upstreamProbeCache.value = value;
        upstreamProbeCache.expiresAt = Date.now() + UPSTREAM_PROBE_TTL_MS;
        upstreamProbeCache.inFlight = null;
        return value;
      },
    );
    upstreamProbeCache.inFlight = inFlight;
    return inFlight;
  };

  const trackDeviceSocket = (deviceID: string, socket: Duplex): void => {
    const sockets = socketsByDevice.get(deviceID) ?? new Set<Duplex>();
    if (sockets.has(socket)) return;
    sockets.add(socket);
    socketsByDevice.set(deviceID, sockets);
    socket.once("close", () => {
      sockets.delete(socket);
      if (sockets.size === 0) socketsByDevice.delete(deviceID);
    });
  };

  const closeDeviceSockets = (deviceID: string, except?: Duplex): void => {
    const sockets = socketsByDevice.get(deviceID);
    if (sockets === undefined) return;
    socketsByDevice.delete(deviceID);
    for (const socket of sockets) {
      if (socket !== except) socket.destroy();
    }
  };

  const revokeDevice = async (deviceID: string): Promise<boolean> => {
    const revoked = await registry.revoke(deviceID);
    if (revoked) closeDeviceSockets(deviceID);
    return revoked;
  };

  const closeDeviceSocketsAfterResponse = (
    deviceIDs: readonly string[],
    response: ServerResponse,
  ): void => {
    if (deviceIDs.length === 0) return;
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      for (const deviceID of deviceIDs) closeDeviceSockets(deviceID);
    };
    response.once("finish", close);
    response.once("close", close);
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://honk.local");
      if (request.method === "OPTIONS") {
        if (!setCors(request, response, state.publicUrl)) {
          json(response, 403, { error: "This web origin is not allowed." });
          return;
        }
        response.statusCode = 204;
        response.end();
        return;
      }

      if (url.pathname === "/honk/health") {
        setCors(request, response, state.publicUrl);
        const nonce = url.searchParams.get("probe");
        json(response, 200, {
          healthy: true,
          openCodeReady: await cachedProbeUpstream(),
          // Bind the proof to the host's advertised origin so a relay cannot present it for the
          // relay's address. The cap prevents unbounded caller-chosen HMAC input.
          ...(nonce !== null && nonce.length > 0 && nonce.length <= 128
            ? {
                proof: createHmac("sha256", options.serverId)
                  .update(`${state.publicUrl}\n${nonce}`, "utf8")
                  .digest("hex"),
              }
            : {}),
        });
        return;
      }

      if (
        request.method === "POST" &&
        (url.pathname === "/honk/pair" ||
          url.pathname === "/honk/pair/confirm" ||
          url.pathname === "/honk/pair/preview")
      ) {
        if (!setCors(request, response, state.publicUrl)) {
          json(response, 403, { error: "This web origin is not allowed." });
          return;
        }
        const socketAddress = request.socket.remoteAddress ?? "unknown";
        const forwardedFor = request.headers["cf-connecting-ip"];
        const trimmedForwardedFor = typeof forwardedFor === "string" ? forwardedFor.trim() : "";
        const socketIsLoopback =
          socketAddress === "localhost" ||
          socketAddress === "::1" ||
          socketAddress.startsWith("127.") ||
          socketAddress.toLowerCase().startsWith("::ffff:127.");
        // Separate namespaces prevent a spoofed header from exhausting a socket-keyed bucket.
        const client =
          options.trustLoopbackForwardedFor === true &&
          socketIsLoopback &&
          trimmedForwardedFor.length > 0 &&
          trimmedForwardedFor.length <= 64 &&
          !trimmedForwardedFor.includes(",")
            ? `forwarded:${trimmedForwardedFor}`
            : `socket:${socketAddress}`;
        const retryAfter = takePairingToken(pairingRateBuckets, client, Date.now());
        if (retryAfter > 0) {
          response.setHeader("retry-after", String(retryAfter));
          json(response, 429, {
            code: "pairing_rate_limited",
            error: "Too many connection attempts. Wait a minute, then try again.",
          });
          return;
        }
      }

      if (url.pathname === "/honk/pair" && request.method === "POST") {
        if (!setCors(request, response, state.publicUrl)) {
          json(response, 403, { error: "This web origin is not allowed." });
          return;
        }
        try {
          const body = await readJson(request);
          const token = isObject(body) ? Reflect.get(body, "token") : undefined;
          const requestID = isObject(body) ? Reflect.get(body, "requestId") : undefined;
          const label = isObject(body) ? Reflect.get(body, "label") : undefined;
          if (typeof token !== "string" || token.length === 0) {
            json(response, 400, { error: "A pairing token is required." });
            return;
          }
          if (typeof requestID !== "string") {
            json(response, 400, {
              code: "invalid_request_id",
              error: "A valid pairing request ID is required.",
            });
            return;
          }
          const explicitReplacement = isBasicAuthorization(request.headers.authorization);
          const existingPassword = explicitReplacement
            ? basicAuthorizationPasswordFrom(request.headers.authorization)
            : cookiePasswordFrom(request, COOKIE_NAME);
          const existingDevice =
            existingPassword === null ? null : registry.authenticate(existingPassword);
          if (explicitReplacement && existingDevice === null) {
            json(response, 401, {
              code: "existing_access_invalid",
              error: "The existing device access is no longer valid.",
            });
            return;
          }
          const result = await registry.provision(
            token,
            requestID,
            typeof label === "string" && label.trim().length > 0 ? label : undefined,
            existingDevice?.id,
            cookiePasswordFrom(request, PROVISIONAL_COOKIE_NAME) ?? undefined,
          );
          if (result.status === "in-progress") {
            json(response, 409, {
              code: "pairing_in_progress",
              error: "Another device already started using this pairing code.",
            });
            return;
          }
          if (result.status === "invalid") {
            json(response, 401, {
              code: "pairing_invalid",
              error: "The pairing token is invalid, expired, or already used.",
            });
            return;
          }
          setAuthCookies(response, state.publicUrl, [
            authCookie(
              state.publicUrl,
              PROVISIONAL_COOKIE_NAME,
              result.device.password,
              Math.max(0, Math.ceil((Date.parse(result.device.expiresAt) - Date.now()) / 1_000)),
              "/honk",
            ),
          ]);
          json(response, 202, {
            status: result.status,
            password: result.device.password,
            deviceId: result.device.id,
            label: result.device.label,
            requestId: result.device.requestID,
            expiresAt: result.device.expiresAt,
          });
        } catch (error) {
          if (error instanceof PairingRequestIDError) {
            json(response, 400, { code: "invalid_request_id", error: error.message });
            return;
          }
          if (error instanceof RemoteDisplayNameError) {
            json(response, 400, { code: "invalid_name", error: error.message });
            return;
          }
          json(response, 503, {
            code: "pairing_provision_failed",
            error: "Honk could not start device access. Try again.",
          });
        }
        return;
      }

      if (url.pathname === "/honk/pair/confirm" && request.method === "POST") {
        if (!setCors(request, response, state.publicUrl)) {
          json(response, 403, { error: "This web origin is not allowed." });
          return;
        }
        const password =
          basicAuthorizationPasswordFrom(request.headers.authorization) ??
          cookiePasswordFrom(request, PROVISIONAL_COOKIE_NAME) ??
          cookiePasswordFrom(request, COOKIE_NAME);
        if (password === null) {
          json(response, 401, {
            code: "provisional_access_invalid",
            error: "Pairing confirmation is no longer available.",
          });
          return;
        }
        try {
          const result = await registry.confirm(password);
          if (result.status === "invalid") {
            json(response, 401, {
              code: "provisional_access_invalid",
              error: "Pairing confirmation is invalid or expired.",
            });
            return;
          }
          const replacedDeviceID = result.device.replacedDeviceID;
          if (replacedDeviceID !== null) {
            closeDeviceSocketsAfterResponse([replacedDeviceID], response);
          }
          setAuthCookies(response, state.publicUrl, [
            authCookie(state.publicUrl, COOKIE_NAME, result.device.password, 31_536_000, "/"),
            authCookie(state.publicUrl, PROVISIONAL_COOKIE_NAME, "", 0, "/honk"),
          ]);
          json(response, 200, {
            status: result.status,
            password: result.device.password,
            deviceId: result.device.id,
            label: result.device.label,
            serverId: options.serverId,
          });
        } catch {
          json(response, 503, {
            code: "pairing_confirm_failed",
            error: "Honk could not save device access. Try again.",
          });
        }
        return;
      }

      if (url.pathname === "/honk/pair/preview" && request.method === "POST") {
        if (!setCors(request, response, state.publicUrl)) {
          json(response, 403, { error: "This web origin is not allowed." });
          return;
        }
        const body = await readJson(request).catch(() => ({}));
        const token = isObject(body) ? Reflect.get(body, "token") : undefined;
        const preview = typeof token === "string" ? registry.preview(token) : null;
        if (preview === null) {
          json(response, 401, {
            code: "pairing_invalid",
            error: "The pairing token is invalid, expired, or already used.",
          });
          return;
        }
        json(response, 200, {
          name: displayName,
          origin: state.publicUrl,
          expiresAt: preview.expiresAt,
          serverId: options.serverId,
        });
        return;
      }

      if (url.pathname === "/honk/pair/cancel" && request.method === "POST") {
        if (!setCors(request, response, state.publicUrl)) {
          json(response, 403, { error: "This web origin is not allowed." });
          return;
        }
        const explicitPassword = basicAuthorizationPasswordFrom(request.headers.authorization);
        const provisionalPassword = cookiePasswordFrom(request, PROVISIONAL_COOKIE_NAME);
        const cancellation =
          explicitPassword === null
            ? {
                cancelled:
                  provisionalPassword !== null &&
                  (await registry.cancelProvisional(provisionalPassword)),
                revokedDeviceID: null,
              }
            : await registry.cancelPairingCandidate(explicitPassword);
        if (cancellation.revokedDeviceID !== null) {
          closeDeviceSocketsAfterResponse([cancellation.revokedDeviceID], response);
        }
        setAuthCookies(response, state.publicUrl, [
          authCookie(state.publicUrl, PROVISIONAL_COOKIE_NAME, "", 0, "/honk"),
        ]);
        response.statusCode = 204;
        response.end();
        return;
      }

      if (url.pathname === "/honk/sign-out" && request.method === "POST") {
        if (!setCors(request, response, state.publicUrl)) {
          json(response, 403, { error: "This web origin is not allowed." });
          return;
        }
        const passwords = new Set(
          [
            basicAuthorizationPasswordFrom(request.headers.authorization),
            cookiePasswordFrom(request, PROVISIONAL_COOKIE_NAME),
            cookiePasswordFrom(request, COOKIE_NAME),
          ].filter((password): password is string => password !== null),
        );
        const revokedDeviceIDs: string[] = [];
        for (const password of passwords) {
          await registry.cancelProvisional(password);
          const device = registry.authenticate(password);
          if (device !== null && (await registry.revoke(device.id))) {
            revokedDeviceIDs.push(device.id);
          }
        }
        closeDeviceSocketsAfterResponse(revokedDeviceIDs, response);
        setAuthCookies(response, state.publicUrl, [
          authCookie(state.publicUrl, COOKIE_NAME, "", 0, "/"),
          authCookie(state.publicUrl, PROVISIONAL_COOKIE_NAME, "", 0, "/honk"),
        ]);
        response.statusCode = 204;
        response.end();
        return;
      }

      if (url.pathname.startsWith("/honk/admin/")) {
        setCors(request, response, state.publicUrl);
        const adminSecret = bearerFrom(request);
        if (adminSecret === null || !secretEquals(adminSecret, state.adminSecret)) {
          json(response, 401, { error: "Admin authentication is required." });
          return;
        }
        if (url.pathname === "/honk/admin/status" && request.method === "GET") {
          json(response, 200, {
            pid: state.pid,
            origin: state.origin,
            publicUrl: state.publicUrl,
            cwd: state.cwd,
            openCodeReady: await cachedProbeUpstream(),
          });
          return;
        }
        if (url.pathname === "/honk/admin/pairings" && request.method === "POST") {
          const body = await readJson(request).catch(() => ({}));
          const label = isObject(body) ? Reflect.get(body, "label") : undefined;
          try {
            const issued = registry.issuePairing(
              typeof label === "string" && label.trim().length > 0 ? label : "New device",
            );
            const link = pairingLink(state.publicUrl, issued.id, issued.token, issued.expiresAt);
            json(response, 201, {
              ...link,
              // JSON.stringify drops undefined, so plaintext LAN responses omit the browser URL.
              url: link.url ?? undefined,
            });
          } catch (error) {
            json(response, 400, {
              error: error instanceof Error ? error.message : "The device name is invalid.",
            });
          }
          return;
        }
        if (url.pathname === "/honk/admin/shutdown" && request.method === "POST") {
          json(response, 202, { stopping: true });
          setTimeout(() => process.kill(process.pid, "SIGTERM"), 25);
          return;
        }
        if (url.pathname === "/honk/admin/devices" && request.method === "GET") {
          json(
            response,
            200,
            registry.list().map(({ passwordHash: _passwordHash, ...device }) => device),
          );
          return;
        }
        const deviceMatch = /^\/honk\/admin\/devices\/([^/]+)$/.exec(url.pathname);
        if (deviceMatch !== null && request.method === "DELETE") {
          const id = decodeURIComponent(deviceMatch[1] ?? "");
          const revoked = await revokeDevice(id);
          json(response, revoked ? 200 : 404, { revoked });
          return;
        }
        json(response, 404, { error: "Unknown Honk admin endpoint." });
        return;
      }

      if (
        appRoot !== null &&
        indexFile !== null &&
        (request.method === "GET" || request.method === "HEAD")
      ) {
        const asset = fileWithin(appRoot, url.pathname);
        if (asset !== null && basename(asset) !== "index.html") {
          if (await serveFile(request, response, asset, "asset")) return;
        }
        if ((request.headers.accept ?? "").includes("text/html")) {
          await serveFile(request, response, indexFile, "index");
          return;
        }
      }

      const password = basicPasswordFrom(request);
      const device = password === null ? null : registry.authenticate(password);
      if (device === null) {
        setCors(request, response, state.publicUrl);
        response.setHeader("www-authenticate", 'Basic realm="Honk"');
        json(response, 401, { error: "Pair this device with the Honk host first." });
        return;
      }
      trackDeviceSocket(device.id, request.socket);
      proxyHttp(
        request,
        response,
        options.upstreamOrigin,
        options.upstreamPassword,
        state.publicUrl,
      );
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      json(response, 500, { error: error instanceof Error ? error.message : "Honk host failed." });
    });
  });

  const upgradedSockets = new Set<Duplex>();
  server.on("upgrade", (request, socket, head) => {
    upgradedSockets.add(socket);
    socket.once("close", () => upgradedSockets.delete(socket));
    const password = basicPasswordFrom(request);
    const device = password === null ? null : registry.authenticate(password);
    if (device === null) {
      sendUpgradeUnauthorized(socket);
      return;
    }
    trackDeviceSocket(device.id, socket);
    proxyUpgrade(request, socket, head, options.upstreamOrigin, options.upstreamPassword);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, options.hostname, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    throw new Error("Honk host did not bind a TCP port.");
  }
  const connectionHost =
    options.hostname === "0.0.0.0" || options.hostname === "::" ? "127.0.0.1" : options.hostname;
  const origin = `http://${hostForUrl(connectionHost)}:${address.port}`;
  const publicUrl = normalizedBaseUrl(options.publicUrl ?? origin);
  state = {
    version: 1,
    pid: process.pid,
    adminSecret: options.adminSecret,
    serverId: options.serverId,
    origin,
    publicUrl,
    upstreamOrigin: options.upstreamOrigin,
    cwd: options.cwd,
    devices: registry.list(),
  };
  await writeHostState(state, options.statePath);

  let closePromise: Promise<void> | null = null;
  return {
    origin,
    publicUrl,
    issuePairing(label) {
      const issued = registry.issuePairing(label);
      return pairingLink(publicUrl, issued.id, issued.token, issued.expiresAt);
    },
    pairingState(pairingID) {
      return registry.pairingState(pairingID);
    },
    async cancelPairing(pairingID) {
      const cancellation = await registry.cancelPairing(pairingID);
      if (cancellation.revokedDeviceID !== null) {
        closeDeviceSockets(cancellation.revokedDeviceID);
      }
      return cancellation.cancelled;
    },
    devices() {
      return registry.list();
    },
    setName(name) {
      displayName = normalizeRemoteDisplayName(name);
      return displayName;
    },
    renameDevice: (deviceID, label) => registry.rename(deviceID, label),
    revokeDevice,
    close() {
      closePromise ??= new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
        server.closeAllConnections();
        pairingRateBuckets.clear();
        socketsByDevice.clear();
        for (const socket of upgradedSockets) socket.destroy();
      });
      return closePromise;
    },
  };
}
