import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startHonkHost, takePairingToken, type HonkHost, type RateBucket } from "./host";

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

async function fixture(options?: {
  readonly trustLoopbackForwardedFor?: boolean;
  readonly onUpstreamRequest?: () => void;
}): Promise<HonkHost> {
  const directory = await mkdtemp(join(tmpdir(), "honk-host-rate-limit-test-"));
  const upstream = createServer((_request, response) => {
    options?.onUpstreamRequest?.();
    response.setHeader("content-type", "application/json");
    response.end('{"healthy":true}');
  });
  const upstreamOrigin = await listen(upstream);
  const host = await startHonkHost({
    name: "Test Mac",
    hostname: "127.0.0.1",
    port: 0,
    ...(options?.trustLoopbackForwardedFor === true ? { trustLoopbackForwardedFor: true } : {}),
    upstreamOrigin,
    upstreamPassword: "upstream-secret",
    cwd: directory,
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

const invalidPairingRequest = (
  host: HonkHost,
  origin?: string,
  forwardedFor?: string,
): Promise<Response> =>
  fetch(`${host.origin}/honk/pair`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin === undefined ? {} : { origin }),
      ...(forwardedFor === undefined ? {} : { "cf-connecting-ip": forwardedFor }),
    },
    body: JSON.stringify({ token: "invalid", requestId: "request-0001" }),
  });

// Exactly one bucket token per request, so a full-capacity burst can run concurrently.
const invalidPairingBurst = async (host: HonkHost, forwardedFor?: string): Promise<number[]> =>
  (
    await Promise.all(
      Array.from({ length: 10 }, () => invalidPairingRequest(host, undefined, forwardedFor)),
    )
  ).map((response) => response.status);

describe("pairing token bucket", () => {
  it("allows a burst of 10 calls", () => {
    const buckets = new Map<string, RateBucket>();

    expect(Array.from({ length: 10 }, () => takePairingToken(buckets, "client-a", 0))).toEqual(
      Array.from({ length: 10 }, () => 0),
    );
  });

  it("refuses the 11th call with a positive integer wait", () => {
    const buckets = new Map<string, RateBucket>();
    Array.from({ length: 10 }, () => takePairingToken(buckets, "client-a", 0));

    const wait = takePairingToken(buckets, "client-a", 0);

    expect(wait).toBeGreaterThan(0);
    expect(Number.isInteger(wait)).toBe(true);
  });

  it("refills one token after 6 seconds", () => {
    const buckets = new Map<string, RateBucket>();
    Array.from({ length: 10 }, () => takePairingToken(buckets, "client-a", 0));

    expect(takePairingToken(buckets, "client-a", 6_000)).toBe(0);
    expect(takePairingToken(buckets, "client-a", 6_000)).toBeGreaterThan(0);
  });

  it("fully refills after 60 seconds", () => {
    const buckets = new Map<string, RateBucket>();
    Array.from({ length: 10 }, () => takePairingToken(buckets, "client-a", 0));

    expect(Array.from({ length: 10 }, () => takePairingToken(buckets, "client-a", 60_000))).toEqual(
      Array.from({ length: 10 }, () => 0),
    );
  });

  it("keeps distinct client buckets independent", () => {
    const buckets = new Map<string, RateBucket>();
    Array.from({ length: 10 }, () => takePairingToken(buckets, "client-a", 0));

    expect(takePairingToken(buckets, "client-a", 0)).toBeGreaterThan(0);
    expect(takePairingToken(buckets, "client-b", 0)).toBe(0);
  });

  it("caps retained client buckets during a distinct-client flood", () => {
    const buckets = new Map<string, RateBucket>();

    Array.from({ length: 5_000 }, (_, index) =>
      takePairingToken(buckets, `client-${String(index)}`, 0),
    );

    expect(buckets.size).toBeLessThanOrEqual(1_000);
  });
});

describe("pairing HTTP rate limiting", () => {
  it("throttles the 11th invalid pairing request without an Origin header", async () => {
    const host = await fixture();

    expect(await invalidPairingBurst(host)).toEqual(Array.from({ length: 10 }, () => 401));

    const throttled = await invalidPairingRequest(host);
    const body: unknown = await throttled.json();
    const retryAfter = Number(throttled.headers.get("retry-after"));

    expect(throttled.status).toBe(429);
    expect(typeof body === "object" && body !== null ? Reflect.get(body, "code") : null).toBe(
      "pairing_rate_limited",
    );
    expect(retryAfter).toBeGreaterThan(0);
    expect(Number.isInteger(retryAfter)).toBe(true);
  });

  it("keeps trusted loopback forwarded clients in independent buckets", async () => {
    const host = await fixture({ trustLoopbackForwardedFor: true });

    expect(await invalidPairingBurst(host, "198.51.100.10")).toEqual(
      Array.from({ length: 10 }, () => 401),
    );

    const throttled = await invalidPairingRequest(host, undefined, "198.51.100.10");
    const independent = await invalidPairingRequest(host, undefined, "198.51.100.11");

    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("retry-after")).not.toBeNull();
    expect(independent.status).toBe(401);
  });

  it("ignores forwarded client headers by default", async () => {
    const host = await fixture();

    expect(await invalidPairingBurst(host, "198.51.100.20")).toEqual(
      Array.from({ length: 10 }, () => 401),
    );

    const secondForwardedClient = await invalidPairingRequest(host, undefined, "198.51.100.21");

    expect(secondForwardedClient.status).toBe(429);
    expect(secondForwardedClient.headers.get("retry-after")).not.toBeNull();
  });

  it("accepts an absent Origin and reaches pairing capability authorization", async () => {
    const host = await fixture();

    // CORS is not authentication, so absent-Origin traffic must reach the route and be authorized
    // by pairing capability or device credential.
    const response = await fetch(`${host.origin}/honk/pair/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "invalid" }),
    });

    expect(response.status).toBe(401);
  });

  it("rejects a disallowed Origin before consuming a pairing token", async () => {
    const host = await fixture();

    const rejected = await invalidPairingRequest(host, "https://attacker.example");
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();

    expect(await invalidPairingBurst(host)).toEqual(Array.from({ length: 10 }, () => 401));
  });

  it("leaves authenticated admin routes unaffected after pairing exhaustion", async () => {
    const host = await fixture();
    expect(await invalidPairingBurst(host)).toEqual(Array.from({ length: 10 }, () => 401));

    const response = await fetch(`${host.origin}/honk/admin/status`, {
      headers: { authorization: "Bearer admin-secret" },
    });

    expect(response.status).toBe(200);
  });
});

describe("health probe caching", () => {
  it("single-flights and caches upstream probes while preserving identity proofs", async () => {
    const upstreamRequests = { count: 0 };
    const host = await fixture({
      onUpstreamRequest: () => {
        upstreamRequests.count += 1;
      },
    });
    const expectHealthy = async (nonce: string): Promise<void> => {
      const response = await fetch(`${host.origin}/honk/health?probe=${encodeURIComponent(nonce)}`);
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(typeof body === "object" && body !== null ? Reflect.get(body, "healthy") : null).toBe(
        true,
      );
      expect(
        typeof body === "object" && body !== null ? Reflect.get(body, "openCodeReady") : null,
      ).toBe(true);
      expect(typeof body === "object" && body !== null ? Reflect.get(body, "proof") : null).toBe(
        createHmac("sha256", "test-server-identity")
          .update(`${host.publicUrl}\n${nonce}`, "utf8")
          .digest("hex"),
      );
    };

    await Promise.all(
      Array.from({ length: 20 }, (_, index) => expectHealthy(`concurrent-${String(index)}`)),
    );
    await expectHealthy("sequential-1");
    await expectHealthy("sequential-2");

    const adminStatus = await fetch(`${host.origin}/honk/admin/status`, {
      headers: { authorization: "Bearer admin-secret" },
    });
    const adminBody: unknown = await adminStatus.json();

    expect(adminStatus.status).toBe(200);
    expect(
      typeof adminBody === "object" && adminBody !== null
        ? Reflect.get(adminBody, "openCodeReady")
        : null,
    ).toBe(true);
    expect(upstreamRequests.count).toBeGreaterThan(0);
    expect(upstreamRequests.count).toBeLessThanOrEqual(2);
  });
});
