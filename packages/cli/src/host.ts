import { createHash, timingSafeEqual } from "node:crypto";
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

import { DeviceRegistry } from "./auth";
import { writeHostState, type DeviceRecord, type HostState } from "./state";

export {
  buildTailscaleHttpsUrl,
  disableTailscaleHttpsServe,
  enableTailscaleHttpsServe,
  parseTailscaleStatus,
  readTailscaleStatus,
  resolveTailscaleHttpsEndpoint,
  TailscaleServeError,
  TailscaleStatusError,
  TailscaleUnavailableError,
  type TailscaleCommandOptions,
  type TailscaleCommandRequest,
  type TailscaleCommandResult,
  type TailscaleCommandRunner,
  type TailscaleHttpsEndpoint,
  type TailscaleStatus,
} from "./tailscale";

const COOKIE_NAME = "honk_device";
const MAX_ADMIN_BODY_BYTES = 64 * 1024;

export interface HonkHostOptions {
  readonly hostname: string;
  readonly port: number;
  readonly publicUrl?: string;
  readonly upstreamOrigin: string;
  readonly upstreamPassword: string;
  readonly cwd: string;
  readonly appDist?: string;
  readonly adminSecret: string;
  readonly devices: readonly DeviceRecord[];
  readonly statePath: string;
}

export interface PairingLink {
  readonly url: string;
  readonly mobileUrl: string;
  readonly expiresAt: string;
}

export interface HonkHost {
  readonly origin: string;
  readonly publicUrl: string;
  readonly issuePairing: (label?: string) => PairingLink;
  readonly devices: () => readonly DeviceRecord[];
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

const basicPasswordFrom = (request: IncomingMessage): string | null => {
  const authorization = request.headers.authorization;
  if (authorization !== undefined && authorization.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator >= 0 && decoded.slice(0, separator) === "opencode") {
        return decoded.slice(separator + 1);
      }
    } catch {
      return null;
    }
  }

  const cookie = request.headers.cookie;
  if (cookie === undefined) return null;
  for (const entry of cookie.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== COOKIE_NAME) continue;
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
};

const pairingUrl = (publicUrl: string, token: string): string => {
  const url = new URL("/pair", `${publicUrl}/`);
  url.hash = new URLSearchParams({ pairing: token }).toString();
  return url.toString();
};

const mobilePairingUrl = (publicUrl: string, token: string): string => {
  const query = new URLSearchParams({ origin: publicUrl });
  const fragment = new URLSearchParams({ pairing: token });
  return `honk://connect?${query.toString()}#${fragment.toString()}`;
};

const pairingLink = (publicUrl: string, token: string, expiresAt: string): PairingLink => ({
  url: pairingUrl(publicUrl, token),
  mobileUrl: mobilePairingUrl(publicUrl, token),
  expiresAt,
});

const deviceCookie = (publicUrl: string, password: string, maxAge: number): string => {
  const secure = publicUrl.startsWith("https:") ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(password)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure}`;
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
    state = { ...state, devices };
    await writeHostState(state, options.statePath);
  });
  const socketsByDevice = new Map<string, Set<Duplex>>();

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

  const closeDeviceSockets = (deviceID: string): void => {
    const sockets = socketsByDevice.get(deviceID);
    if (sockets === undefined) return;
    socketsByDevice.delete(deviceID);
    for (const socket of sockets) socket.destroy();
  };

  const revokeDevice = async (deviceID: string): Promise<boolean> => {
    const revoked = await registry.revoke(deviceID);
    if (revoked) closeDeviceSockets(deviceID);
    return revoked;
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
        json(response, 200, {
          healthy: true,
          openCodeReady: await probeUpstream(options.upstreamOrigin, options.upstreamPassword),
        });
        return;
      }

      if (url.pathname === "/honk/pair" && request.method === "POST") {
        if (!setCors(request, response, state.publicUrl)) {
          json(response, 403, { error: "This web origin is not allowed." });
          return;
        }
        try {
          const body = await readJson(request);
          const token = isObject(body) ? Reflect.get(body, "token") : undefined;
          const label = isObject(body) ? Reflect.get(body, "label") : undefined;
          if (typeof token !== "string" || token.length === 0) {
            json(response, 400, { error: "A pairing token is required." });
            return;
          }
          const device = await registry.exchange(
            token,
            typeof label === "string" && label.trim().length > 0 ? label : undefined,
          );
          if (device === null) {
            json(response, 401, {
              error: "The pairing token is invalid, expired, or already used.",
            });
            return;
          }
          response.setHeader(
            "set-cookie",
            deviceCookie(state.publicUrl, device.password, 31_536_000),
          );
          json(response, 200, {
            password: device.password,
            deviceId: device.id,
            label: device.label,
          });
        } catch (error) {
          json(response, 400, {
            error: error instanceof Error ? error.message : "The pairing request is invalid.",
          });
        }
        return;
      }

      if (url.pathname === "/honk/sign-out" && request.method === "POST") {
        if (!setCors(request, response, state.publicUrl)) {
          json(response, 403, { error: "This web origin is not allowed." });
          return;
        }
        const password = basicPasswordFrom(request);
        const device = password === null ? null : registry.authenticate(password);
        if (device !== null) await revokeDevice(device.id);
        response.setHeader("set-cookie", deviceCookie(state.publicUrl, "", 0));
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
            openCodeReady: await probeUpstream(options.upstreamOrigin, options.upstreamPassword),
          });
          return;
        }
        if (url.pathname === "/honk/admin/pairings" && request.method === "POST") {
          const body = await readJson(request).catch(() => ({}));
          const label = isObject(body) ? Reflect.get(body, "label") : undefined;
          const issued = registry.issuePairing(
            typeof label === "string" && label.trim().length > 0 ? label : "New device",
          );
          json(response, 201, {
            ...pairingLink(state.publicUrl, issued.token, issued.expiresAt),
          });
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
      return pairingLink(publicUrl, issued.token, issued.expiresAt);
    },
    devices() {
      return registry.list();
    },
    revokeDevice,
    close() {
      closePromise ??= new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
        server.closeAllConnections();
        socketsByDevice.clear();
        for (const socket of upgradedSockets) socket.destroy();
      });
      return closePromise;
    },
  };
}
