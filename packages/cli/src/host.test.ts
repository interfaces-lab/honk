import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  Agent,
  createServer,
  get as getHttp,
  request as requestHttp,
  type Server,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startHonkHost, type HonkHost, type PairingLink } from "./host";
import { readHostState } from "./state";

const REQUEST_ID = "request-0001";
const OTHER_REQUEST_ID = "request-0002";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("Missing server address.");
  return `http://127.0.0.1:${String(address.port)}`;
}

async function fixture(
  options: { readonly publicUrl?: string; readonly serveWeb?: boolean } = {},
): Promise<HonkHost> {
  const directory = await mkdtemp(join(tmpdir(), "honk-host-test-"));
  await writeFile(join(directory, "index.html"), "<!doctype html><title>Honk</title>");
  const upstream = createServer((request, response) => {
    if (request.url === "/api/event") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.write('data: {"type":"server.heartbeat"}\n\n');
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end('{"healthy":true}');
  });
  const upstreamOrigin = await listen(upstream);
  const host = await startHonkHost({
    name: "Test Mac",
    hostname: "127.0.0.1",
    port: 0,
    upstreamOrigin,
    upstreamPassword: "upstream-secret",
    cwd: directory,
    ...(options.publicUrl === undefined ? {} : { publicUrl: options.publicUrl }),
    ...(options.serveWeb === false ? {} : { appDist: directory }),
    adminSecret: "admin-secret",
    serverId: "test-server-identity",
    devices: [],
    statePath: join(directory, "host.json"),
  });
  cleanups.push(async () => {
    await host.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(directory, { force: true, recursive: true });
  });
  return host;
}

function pairingToken(pairing: PairingLink): string {
  if (pairing.url === null) throw new Error("Browser pairing URL is unavailable.");
  const token = new URLSearchParams(new URL(pairing.url).hash.slice(1)).get("pairing");
  if (token === null) throw new Error("Missing pairing token.");
  return token;
}

function authorization(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
}

async function provisionalCredential(response: Response): Promise<{
  readonly deviceId: string;
  readonly expiresAt: string;
  readonly password: string;
  readonly requestId: string;
}> {
  const body: unknown = await response.json();
  const deviceId = typeof body === "object" && body !== null ? Reflect.get(body, "deviceId") : null;
  const expiresAt =
    typeof body === "object" && body !== null ? Reflect.get(body, "expiresAt") : null;
  const password = typeof body === "object" && body !== null ? Reflect.get(body, "password") : null;
  const requestId =
    typeof body === "object" && body !== null ? Reflect.get(body, "requestId") : null;
  if (
    typeof deviceId !== "string" ||
    typeof expiresAt !== "string" ||
    typeof password !== "string" ||
    typeof requestId !== "string"
  ) {
    throw new Error("Pairing returned an invalid provisional credential.");
  }
  return { deviceId, expiresAt, password, requestId };
}

async function pair(host: HonkHost): Promise<{
  readonly deviceId: string;
  readonly pairingId: string;
  readonly password: string;
}> {
  const pairing = host.issuePairing("Test phone");
  const response = await fetch(`${host.origin}/honk/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: pairingToken(pairing), requestId: REQUEST_ID }),
  });
  expect(response.status).toBe(202);
  const provisional = await provisionalCredential(response);
  const confirmation = await fetch(`${host.origin}/honk/pair/confirm`, {
    method: "POST",
    headers: { authorization: authorization(provisional.password) },
  });
  expect(confirmation.status).toBe(200);
  await expect(confirmation.json()).resolves.toMatchObject({
    serverId: "test-server-identity",
  });
  return {
    deviceId: provisional.deviceId,
    pairingId: pairing.id,
    password: provisional.password,
  };
}

async function openDeviceEventStream(
  host: HonkHost,
  password: string,
): Promise<{ readonly closed: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const request = getHttp(
      `${host.origin}/api/event`,
      { headers: { authorization: authorization(password) } },
      (response) => {
        response.once("data", () => {
          resolve({
            closed: new Promise<void>((resolveClose) => {
              response.once("close", resolveClose);
            }),
          });
        });
      },
    );
    request.once("error", reject);
  });
}

async function requestWithAgent(
  url: string,
  input: {
    readonly agent: Agent;
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly method?: string;
  },
): Promise<{ readonly body: string; readonly closed: Promise<void>; readonly status: number }> {
  return new Promise((resolve, reject) => {
    const request = requestHttp(
      url,
      { agent: input.agent, headers: input.headers, method: input.method },
      (response) => {
        const chunks: Buffer[] = [];
        const closed = new Promise<void>((resolveClose) => {
          if (response.socket.destroyed) {
            resolveClose();
            return;
          }
          response.socket.once("close", resolveClose);
        });
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            closed,
            status: response.statusCode ?? 0,
          }),
        );
      },
    );
    request.once("error", reject);
    request.end(input.body);
  });
}

async function expectStreamClosed(
  stream: { readonly closed: Promise<void> },
  failure: string,
): Promise<void> {
  await expect(
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(failure)), 1_000);
      void stream.closed.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (cause: unknown) => {
          clearTimeout(timer);
          reject(cause);
        },
      );
    }),
  ).resolves.toBeUndefined();
}

describe("Honk remote host", () => {
  it("returns a keyed identity proof only when asked", async () => {
    const host = await fixture();
    const health: unknown = await fetch(`${host.origin}/honk/health`).then((response) =>
      response.json(),
    );

    expect(health).toEqual({ healthy: true, openCodeReady: true });
    expect(health).not.toHaveProperty("proof");
    expect(health).not.toHaveProperty("serverId");

    const nonce = "stable-probe";
    const expectedProof = createHmac("sha256", "test-server-identity")
      .update(`${host.publicUrl}\n${nonce}`, "utf8")
      .digest("hex");
    const first: unknown = await fetch(
      `${host.origin}/honk/health?probe=${encodeURIComponent(nonce)}`,
    ).then((response) => response.json());
    const second: unknown = await fetch(
      `${host.origin}/honk/health?probe=${encodeURIComponent(nonce)}`,
    ).then((response) => response.json());
    const otherNonce = "different-probe";
    const different: unknown = await fetch(
      `${host.origin}/honk/health?probe=${encodeURIComponent(otherNonce)}`,
    ).then((response) => response.json());

    expect(first).toEqual({ healthy: true, openCodeReady: true, proof: expectedProof });
    expect(second).toEqual(first);
    expect(different).toEqual({
      healthy: true,
      openCodeReady: true,
      proof: createHmac("sha256", "test-server-identity")
        .update(`${host.publicUrl}\n${otherNonce}`, "utf8")
        .digest("hex"),
    });
    expect(different).not.toEqual(first);
    expect(first).not.toHaveProperty("serverId");
  });

  it("restores legacy host state before minting its server identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "honk-host-state-test-"));
    const statePath = join(directory, "host.json");
    cleanups.push(() => rm(directory, { force: true, recursive: true }));
    const devices = [
      {
        id: "device-1",
        label: "Test phone",
        passwordHash: "password-hash",
        createdAt: "2026-07-20T18:00:00.000Z",
        revokedAt: null,
      },
    ];
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        pid: 123,
        adminSecret: "legacy-admin-secret",
        origin: "http://127.0.0.1:3773",
        publicUrl: "https://honk.example.com",
        upstreamOrigin: "http://127.0.0.1:4096",
        cwd: directory,
        devices,
      }),
    );

    const restored = await readHostState(statePath);
    expect(restored).toMatchObject({
      adminSecret: "legacy-admin-secret",
      devices,
      serverId: expect.any(String),
    });
    expect(restored?.serverId.length).toBeGreaterThan(0);
  });

  it("issues native-only pairing links for a plaintext LAN origin", async () => {
    const host = await fixture({ publicUrl: "http://192.168.1.42:3773" });
    const pairing = host.issuePairing("Test phone");
    const token = new URLSearchParams(new URL(pairing.mobileUrl).hash.slice(1)).get("pairing");
    if (token === null) throw new Error("Missing mobile pairing token.");

    expect(pairing.url).toBeNull();
    expect(pairing.mobileUrl).toBe(
      `honk://connect?origin=http%3A%2F%2F192.168.1.42%3A3773#pairing=${token}`,
    );

    const preview = await fetch(`${host.origin}/honk/pair/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({
      origin: "http://192.168.1.42:3773",
      serverId: "test-server-identity",
    });

    const exchange = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, requestId: REQUEST_ID }),
    });
    expect(exchange.status).toBe(202);
    expect(exchange.headers.get("set-cookie")).toBeNull();
    const provisional = await provisionalCredential(exchange);

    const confirmation = await fetch(`${host.origin}/honk/pair/confirm`, {
      method: "POST",
      headers: { authorization: authorization(provisional.password) },
    });
    expect(confirmation.status).toBe(200);
    expect(confirmation.headers.get("set-cookie")).toBeNull();

    const adminResponse = await fetch(`${host.origin}/honk/admin/pairings`, {
      method: "POST",
      headers: {
        authorization: "Bearer admin-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ label: "Another phone" }),
    });
    const adminBody: unknown = await adminResponse.json();
    expect(adminResponse.status).toBe(201);
    expect(
      typeof adminBody === "object" && adminBody !== null && Object.hasOwn(adminBody, "url"),
    ).toBe(false);
    expect(adminBody).toMatchObject({
      id: expect.any(String),
      mobileUrl: expect.stringContaining(
        "honk://connect?origin=http%3A%2F%2F192.168.1.42%3A3773#pairing=",
      ),
      expiresAt: expect.any(String),
    });
  });

  it("previews provisional pairing safely and lets the issuer cancel it", async () => {
    const host = await fixture();
    const pairing = host.issuePairing("Test phone");
    const token = pairingToken(pairing);

    const preview = await fetch(`${host.origin}/honk/pair/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({
      name: "Test Mac",
      origin: host.publicUrl,
      expiresAt: pairing.expiresAt,
      serverId: "test-server-identity",
    });

    const exchange = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, requestId: REQUEST_ID }),
    });
    expect(exchange.status).toBe(202);
    const provisional = await provisionalCredential(exchange);
    await expect(host.cancelPairing(pairing.id)).resolves.toBe(true);

    const confirmation = await fetch(`${host.origin}/honk/pair/confirm`, {
      method: "POST",
      headers: { authorization: authorization(provisional.password) },
    });
    expect(confirmation.status).toBe(401);
    expect(host.devices()).toEqual([]);
  });

  it("runs as an API-only canonical proxy for desktop mobile access", async () => {
    const host = await fixture({ serveWeb: false });
    const device = await pair(host);
    const response = await fetch(`${host.origin}/global/health`, {
      headers: { authorization: authorization(device.password) },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ healthy: true });
  });

  it("allows credentialed CORS from its web and desktop clients", async () => {
    const host = await fixture();
    const pairing = host.issuePairing("Browser");
    const rejected = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ token: pairingToken(pairing), requestId: REQUEST_ID }),
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();

    const accepted = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: host.publicUrl },
      body: JSON.stringify({ token: pairingToken(pairing), requestId: REQUEST_ID }),
    });
    expect(accepted.status).toBe(202);
    expect(accepted.headers.get("access-control-allow-origin")).toBe(host.publicUrl);

    const desktopPairing = host.issuePairing("Desktop");
    const desktopAccepted = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "honk://desktop" },
      body: JSON.stringify({ token: pairingToken(desktopPairing), requestId: REQUEST_ID }),
    });
    expect(desktopAccepted.status).toBe(202);
    expect(desktopAccepted.headers.get("access-control-allow-origin")).toBe("honk://desktop");
  });

  it("replays only the same request, including recovery through the provisional cookie", async () => {
    const host = await fixture();
    const pairing = host.issuePairing("Browser");
    const token = pairingToken(pairing);
    const first = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, requestId: REQUEST_ID }),
    });
    expect(first.status).toBe(202);
    const firstBody = await provisionalCredential(first);
    const setCookie = first.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("honk_pairing_provisional=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/honk");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Max-Age=600");
    expect(setCookie).not.toContain("Secure");
    expect(setCookie).not.toMatch(/(?:^|,\s*)honk_device=/);

    const replay = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, requestId: REQUEST_ID, label: "Ignored" }),
    });
    expect(replay.status).toBe(202);
    await expect(provisionalCredential(replay)).resolves.toEqual(firstBody);

    const conflict = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, requestId: OTHER_REQUEST_ID }),
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: "pairing_in_progress" });

    const cookieReplay = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: {
        cookie: `honk_pairing_provisional=${encodeURIComponent(firstBody.password)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token, requestId: OTHER_REQUEST_ID }),
    });
    expect(cookieReplay.status).toBe(202);
    await expect(provisionalCredential(cookieReplay)).resolves.toEqual(firstBody);
  });

  it("keeps provisional access unusable and cancels it from the cookie cancel route", async () => {
    const host = await fixture();
    const pairing = host.issuePairing("Browser");
    const response = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: pairingToken(pairing), requestId: REQUEST_ID }),
    });
    const provisional = await provisionalCredential(response);
    expect(
      await fetch(`${host.origin}/global/health`, {
        headers: { authorization: authorization(provisional.password) },
      }),
    ).toMatchObject({ status: 401 });

    const cancellation = await fetch(`${host.origin}/honk/pair/cancel`, {
      method: "POST",
      headers: {
        cookie: `honk_pairing_provisional=${encodeURIComponent(provisional.password)}`,
      },
    });
    expect(cancellation.status).toBe(204);
    expect(cancellation.headers.get("set-cookie")).toContain(
      "honk_pairing_provisional=; HttpOnly; Path=/honk",
    );
    expect(cancellation.headers.get("set-cookie")).not.toContain("honk_device=");

    const confirmation = await fetch(`${host.origin}/honk/pair/confirm`, {
      method: "POST",
      headers: { authorization: authorization(provisional.password) },
    });
    expect(confirmation.status).toBe(401);
    expect(host.devices()).toEqual([]);
  });

  it("revokes a confirmed pairing candidate after a lost response on a keep-alive socket", async () => {
    const host = await fixture();
    const device = await pair(host);
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    cleanups.push(async () => agent.destroy());

    await expect(
      requestWithAgent(`${host.origin}/global/health`, {
        agent,
        headers: { authorization: authorization(device.password) },
      }),
    ).resolves.toMatchObject({ status: 200 });
    const cancellation = await requestWithAgent(`${host.origin}/honk/pair/cancel`, {
      agent,
      method: "POST",
      headers: { authorization: authorization(device.password) },
    });
    expect(cancellation.status).toBe(204);
    await expectStreamClosed(cancellation, "Pairing cancellation kept its device socket open.");
    await expect(
      requestWithAgent(`${host.origin}/global/health`, {
        agent,
        headers: { authorization: authorization(device.password) },
      }),
    ).resolves.toMatchObject({ status: 401 });
    expect(
      host.devices().find((candidate) => candidate.id === device.deviceId)?.revokedAt,
    ).not.toBe(null);
  });

  it("keeps cookie-only cancellation provisional after confirmation", async () => {
    const host = await fixture();
    const device = await pair(host);

    const cancellation = await fetch(`${host.origin}/honk/pair/cancel`, {
      method: "POST",
      headers: {
        cookie: `honk_device=${encodeURIComponent(device.password)}; honk_pairing_provisional=${encodeURIComponent(device.password)}`,
      },
    });

    expect(cancellation.status).toBe(204);
    expect(cancellation.headers.get("set-cookie")).not.toContain("honk_device=");
    expect(
      await fetch(`${host.origin}/global/health`, {
        headers: { authorization: authorization(device.password) },
      }),
    ).toMatchObject({ status: 200 });
  });

  it("keeps old replacement access live until confirmation then closes its streams", async () => {
    const host = await fixture();
    const existing = await pair(host);
    const oldStream = await openDeviceEventStream(host, existing.password);
    const pairing = host.issuePairing("Replacement phone");
    const response = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: {
        authorization: authorization(existing.password),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        token: pairingToken(pairing),
        requestId: REQUEST_ID,
        label: "Replacement phone",
      }),
    });
    expect(response.status).toBe(202);
    const provisional = await provisionalCredential(response);
    expect(host.devices().filter((device) => device.revokedAt === null)).toHaveLength(1);
    expect(
      await fetch(`${host.origin}/global/health`, {
        headers: { authorization: authorization(existing.password) },
      }),
    ).toMatchObject({ status: 200 });
    expect(
      await fetch(`${host.origin}/global/health`, {
        headers: { authorization: authorization(provisional.password) },
      }),
    ).toMatchObject({ status: 401 });

    const confirmation = await fetch(`${host.origin}/honk/pair/confirm`, {
      method: "POST",
      headers: { authorization: authorization(provisional.password) },
    });
    expect(confirmation.status).toBe(200);
    expect(host.devices().filter((device) => device.revokedAt === null)).toHaveLength(1);
    expect(
      host.devices().find((device) => device.id === existing.deviceId)?.revokedAt,
    ).not.toBeNull();
    expect(
      await fetch(`${host.origin}/global/health`, {
        headers: { authorization: authorization(existing.password) },
      }),
    ).toMatchObject({ status: 401 });
    expect(
      await fetch(`${host.origin}/global/health`, {
        headers: { authorization: authorization(provisional.password) },
      }),
    ).toMatchObject({ status: 200 });
    await expectStreamClosed(oldStream, "The replaced device stream stayed open.");
  });

  it("finishes replacement on a keep-alive socket authenticated as the old device", async () => {
    const host = await fixture();
    const existing = await pair(host);
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    cleanups.push(async () => agent.destroy());

    await expect(
      requestWithAgent(`${host.origin}/global/health`, {
        agent,
        headers: { authorization: authorization(existing.password) },
      }),
    ).resolves.toMatchObject({ status: 200 });

    const pairing = host.issuePairing("Replacement phone");
    const exchange = await requestWithAgent(`${host.origin}/honk/pair`, {
      agent,
      method: "POST",
      headers: {
        authorization: authorization(existing.password),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        token: pairingToken(pairing),
        requestId: REQUEST_ID,
        label: "Replacement phone",
      }),
    });
    expect(exchange.status).toBe(202);
    const body: unknown = JSON.parse(exchange.body);
    const password =
      typeof body === "object" && body !== null ? Reflect.get(body, "password") : null;
    if (typeof password !== "string") throw new Error("Missing provisional password.");

    const confirmation = await requestWithAgent(`${host.origin}/honk/pair/confirm`, {
      agent,
      method: "POST",
      headers: { authorization: authorization(password) },
    });
    expect(confirmation.status).toBe(200);
    await expectStreamClosed(confirmation, "Replacement kept the old device socket open.");
    await expect(
      requestWithAgent(`${host.origin}/global/health`, {
        agent,
        headers: { authorization: authorization(existing.password) },
      }),
    ).resolves.toMatchObject({ status: 401 });
  });

  it("rejects bad explicit replacement access without consuming the code", async () => {
    const host = await fixture();
    const pairing = host.issuePairing("Test phone");
    const token = pairingToken(pairing);
    const rejected = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: {
        authorization: authorization("stale"),
        "content-type": "application/json",
      },
      body: JSON.stringify({ token, requestId: REQUEST_ID }),
    });
    expect(rejected.status).toBe(401);
    await expect(rejected.json()).resolves.toMatchObject({ code: "existing_access_invalid" });

    const retried = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, requestId: REQUEST_ID }),
    });
    expect(retried.status).toBe(202);
  });

  it("revokes completed access when the issuer cancels after confirmation", async () => {
    const host = await fixture();
    const device = await pair(host);
    const stream = await openDeviceEventStream(host, device.password);

    await expect(host.cancelPairing(device.pairingId)).resolves.toBe(true);
    expect(
      host.devices().find((candidate) => candidate.id === device.deviceId)?.revokedAt,
    ).not.toBeNull();
    await expectStreamClosed(stream, "The cancelled pairing stream stayed open.");
  });

  it("uses browser cookies for replacement and emits the final cookie only after confirmation", async () => {
    const host = await fixture();
    const existing = await pair(host);
    const replacement = host.issuePairing("Browser replacement");
    const replaced = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: {
        cookie: `honk_device=${encodeURIComponent(existing.password)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: pairingToken(replacement), requestId: REQUEST_ID }),
    });
    expect(replaced.status).toBe(202);
    const provisional = await provisionalCredential(replaced);
    expect(replaced.headers.get("set-cookie")).toContain("honk_pairing_provisional=");
    expect(host.devices().filter((device) => device.revokedAt === null)).toHaveLength(1);

    const confirmed = await fetch(`${host.origin}/honk/pair/confirm`, {
      method: "POST",
      headers: {
        cookie: `honk_pairing_provisional=${encodeURIComponent(provisional.password)}`,
      },
    });
    expect(confirmed.status).toBe(200);
    const cookies = confirmed.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("honk_device=");
    expect(cookies).toContain("HttpOnly; Path=/; SameSite=Strict; Max-Age=31536000");
    expect(cookies).not.toContain("honk_device=; ");
    expect(cookies).not.toContain("Secure");
    expect(cookies).toContain("honk_pairing_provisional=; HttpOnly; Path=/honk");
    expect(cookies).toContain("SameSite=Strict; Max-Age=0");

    const fresh = host.issuePairing("Recovered browser");
    const recovered = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: {
        cookie: "honk_device=stale",
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: pairingToken(fresh), requestId: REQUEST_ID }),
    });
    expect(recovered.status).toBe(202);
  });

  it("marks provisional and final cookies Secure for an HTTPS public URL", async () => {
    const host = await fixture({ publicUrl: "https://honk.example.com" });
    const pairing = host.issuePairing("Browser");
    const response = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: pairingToken(pairing), requestId: REQUEST_ID }),
    });
    const provisional = await provisionalCredential(response);
    expect(response.headers.get("set-cookie")).toContain(
      "HttpOnly; Path=/honk; SameSite=Strict; Max-Age=600; Secure",
    );

    const confirmation = await fetch(`${host.origin}/honk/pair/confirm`, {
      method: "POST",
      headers: { authorization: authorization(provisional.password) },
    });
    const cookies = confirmation.headers.get("set-cookie") ?? "";
    expect(cookies).toContain(
      "honk_device=" +
        `${encodeURIComponent(provisional.password)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=31536000; Secure`,
    );
    expect(cookies).toContain(
      "honk_pairing_provisional=; HttpOnly; Path=/honk; SameSite=Strict; Max-Age=0; Secure",
    );
  });

  it("cancels an explicit browser replacement without touching the old final cookie", async () => {
    const host = await fixture();
    const existing = await pair(host);
    const replacement = host.issuePairing("Browser replacement");
    const response = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: {
        cookie: `honk_device=${encodeURIComponent(existing.password)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: pairingToken(replacement), requestId: REQUEST_ID }),
    });
    const provisional = await provisionalCredential(response);

    const cancellation = await fetch(`${host.origin}/honk/pair/cancel`, {
      method: "POST",
      headers: {
        authorization: authorization(provisional.password),
        cookie: `honk_device=${encodeURIComponent(existing.password)}`,
      },
    });
    expect(cancellation.status).toBe(204);
    expect(cancellation.headers.get("set-cookie")).toContain(
      "honk_pairing_provisional=; HttpOnly; Path=/honk",
    );
    expect(cancellation.headers.get("set-cookie")).not.toContain("honk_device=");
    expect(
      await fetch(`${host.origin}/global/health`, {
        headers: { authorization: authorization(existing.password) },
      }),
    ).toMatchObject({ status: 200 });
    expect(
      await fetch(`${host.origin}/honk/pair/confirm`, {
        method: "POST",
        headers: { authorization: authorization(provisional.password) },
      }),
    ).toMatchObject({ status: 401 });
  });

  it("full sign-out independently cancels provisional access and revokes final access", async () => {
    const host = await fixture();
    const existing = await pair(host);
    const replacement = host.issuePairing("Browser replacement");
    const response = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: {
        cookie: `honk_device=${encodeURIComponent(existing.password)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: pairingToken(replacement), requestId: REQUEST_ID }),
    });
    const provisional = await provisionalCredential(response);

    const signOut = await fetch(`${host.origin}/honk/sign-out`, {
      method: "POST",
      headers: {
        cookie: `honk_device=${encodeURIComponent(existing.password)}; honk_pairing_provisional=${encodeURIComponent(provisional.password)}`,
      },
    });
    expect(signOut.status).toBe(204);
    expect(signOut.headers.get("set-cookie")).toContain("honk_device=; HttpOnly; Path=/");
    expect(signOut.headers.get("set-cookie")).toContain(
      "honk_pairing_provisional=; HttpOnly; Path=/honk",
    );
    expect(
      await fetch(`${host.origin}/global/health`, {
        headers: { authorization: authorization(existing.password) },
      }),
    ).toMatchObject({ status: 401 });
    expect(
      await fetch(`${host.origin}/honk/pair/confirm`, {
        method: "POST",
        headers: { authorization: authorization(provisional.password) },
      }),
    ).toMatchObject({ status: 401 });
  });

  it("finishes sign-out before invalidating a tracked keep-alive socket", async () => {
    const host = await fixture();
    const device = await pair(host);
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    cleanups.push(async () => agent.destroy());

    await expect(
      requestWithAgent(`${host.origin}/global/health`, {
        agent,
        headers: { authorization: authorization(device.password) },
      }),
    ).resolves.toMatchObject({ status: 200 });
    const signOut = await requestWithAgent(`${host.origin}/honk/sign-out`, {
      agent,
      method: "POST",
      headers: { authorization: authorization(device.password) },
    });
    expect(signOut.status).toBe(204);
    await expectStreamClosed(signOut, "Sign-out kept its device socket open.");
    await expect(
      requestWithAgent(`${host.origin}/global/health`, {
        agent,
        headers: { authorization: authorization(device.password) },
      }),
    ).resolves.toMatchObject({ status: 401 });
  });

  it("full sign-out still revokes a valid cookie when explicit Basic access is stale", async () => {
    const host = await fixture();
    const existing = await pair(host);
    const signOut = await fetch(`${host.origin}/honk/sign-out`, {
      method: "POST",
      headers: {
        authorization: authorization("stale"),
        cookie: `honk_device=${encodeURIComponent(existing.password)}`,
      },
    });
    expect(signOut.status).toBe(204);
    expect(
      await fetch(`${host.origin}/global/health`, {
        headers: { authorization: authorization(existing.password) },
      }),
    ).toMatchObject({ status: 401 });
  });

  it("rejects invalid request IDs and oversized names without consuming the code", async () => {
    const host = await fixture();
    const pairing = host.issuePairing("Test phone");
    const token = pairingToken(pairing);
    const invalidRequest = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, requestId: "short" }),
    });
    expect(invalidRequest.status).toBe(400);
    await expect(invalidRequest.json()).resolves.toMatchObject({ code: "invalid_request_id" });

    const rejectedName = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, requestId: REQUEST_ID, label: "x".repeat(81) }),
    });
    expect(rejectedName.status).toBe(400);
    await expect(rejectedName.json()).resolves.toMatchObject({
      code: "invalid_name",
      error: "Names can be at most 80 characters.",
    });

    const retried = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, requestId: REQUEST_ID, label: "Test phone" }),
    });
    expect(retried.status).toBe(202);
  });

  it("terminates a device event stream when that device is revoked", async () => {
    const host = await fixture();
    const device = await pair(host);
    const stream = await openDeviceEventStream(host, device.password);
    const revoked = await fetch(
      `${host.origin}/honk/admin/devices/${encodeURIComponent(device.deviceId)}`,
      { method: "DELETE", headers: { authorization: "Bearer admin-secret" } },
    );
    expect(revoked.status).toBe(200);
    await expectStreamClosed(stream, "The revoked stream stayed open.");
  });

  it("renames an authorized device", async () => {
    const host = await fixture();
    const device = await pair(host);

    await expect(host.renameDevice(device.deviceId, "Daniel's iPhone")).resolves.toBe(true);
    expect(host.devices().find((entry) => entry.id === device.deviceId)?.label).toBe(
      "Daniel's iPhone",
    );
  });
});
