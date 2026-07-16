import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, get as getHttp, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startHonkHost, type HonkHost } from "./host";

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

async function fixture(options: { readonly serveWeb?: boolean } = {}): Promise<HonkHost> {
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
    hostname: "127.0.0.1",
    port: 0,
    upstreamOrigin,
    upstreamPassword: "upstream-secret",
    cwd: directory,
    ...(options.serveWeb === false ? {} : { appDist: directory }),
    adminSecret: "admin-secret",
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

async function pair(
  host: HonkHost,
): Promise<{ readonly deviceId: string; readonly password: string }> {
  const pairing = host.issuePairing("Test phone");
  const token = new URLSearchParams(new URL(pairing.url).hash.slice(1)).get("pairing");
  if (token === null) throw new Error("Missing pairing token.");
  const response = await fetch(`${host.origin}/honk/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, label: "Test phone" }),
  });
  const body: unknown = await response.json();
  const deviceId = typeof body === "object" && body !== null ? Reflect.get(body, "deviceId") : null;
  const password = typeof body === "object" && body !== null ? Reflect.get(body, "password") : null;
  if (typeof deviceId !== "string" || typeof password !== "string") {
    throw new Error("Pairing returned an invalid credential.");
  }
  return { deviceId, password };
}

describe("Honk remote host", () => {
  it("runs as an API-only canonical proxy for desktop mobile access", async () => {
    const host = await fixture({ serveWeb: false });
    const device = await pair(host);
    const authorization = `Basic ${Buffer.from(`opencode:${device.password}`).toString("base64")}`;
    const response = await fetch(`${host.origin}/global/health`, {
      headers: { authorization },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ healthy: true });
  });

  it("allows credentialed CORS from its web and desktop clients", async () => {
    const host = await fixture();
    const pairing = host.issuePairing("Browser");
    const token = new URLSearchParams(new URL(pairing.url).hash.slice(1)).get("pairing");
    if (token === null) throw new Error("Missing pairing token.");

    const rejected = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ token }),
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();

    const accepted = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: host.publicUrl },
      body: JSON.stringify({ token }),
    });
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("access-control-allow-origin")).toBe(host.publicUrl);

    const desktopPairing = host.issuePairing("Desktop");
    const desktopToken = new URLSearchParams(new URL(desktopPairing.url).hash.slice(1)).get(
      "pairing",
    );
    if (desktopToken === null) throw new Error("Missing desktop pairing token.");
    const desktopAccepted = await fetch(`${host.origin}/honk/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "honk://desktop" },
      body: JSON.stringify({ token: desktopToken }),
    });
    expect(desktopAccepted.status).toBe(200);
    expect(desktopAccepted.headers.get("access-control-allow-origin")).toBe("honk://desktop");
  });

  it("terminates a device event stream when that device is revoked", async () => {
    const host = await fixture();
    const device = await pair(host);
    const authorization = `Basic ${Buffer.from(`opencode:${device.password}`).toString("base64")}`;

    const stream = await new Promise<{ readonly closed: Promise<void> }>((resolve, reject) => {
      const request = getHttp(
        `${host.origin}/api/event`,
        { headers: { authorization } },
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

    const revoked = await fetch(
      `${host.origin}/honk/admin/devices/${encodeURIComponent(device.deviceId)}`,
      { method: "DELETE", headers: { authorization: "Bearer admin-secret" } },
    );
    expect(revoked.status).toBe(200);
    await expect(
      Promise.race([
        stream.closed,
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error("The revoked stream stayed open.")), 1_000);
        }),
      ]),
    ).resolves.toBeUndefined();
  });
});
