import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetServerAuthBootstrapForTests, resolveAuthenticatedServerBearerToken } from "./auth";

const AUTH_DESCRIPTOR = {
  policy: "desktop-managed-local",
  bootstrapMethods: ["desktop-bootstrap"],
  sessionMethods: ["bearer-session-token"],
} as const;

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });
}

function createSessionStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function readFetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

describe("resolveAuthenticatedServerBearerToken", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T12:00:00.000Z"));
    __resetServerAuthBootstrapForTests();
  });

  afterEach(() => {
    __resetServerAuthBootstrapForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reuses a recently validated bearer session while reconnecting", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = readFetchInputUrl(input);
      if (url.endsWith("/api/auth/session")) {
        const headers = new Headers(init?.headers);
        return jsonResponse({
          authenticated: headers.has("authorization"),
          auth: AUTH_DESCRIPTOR,
        });
      }
      if (url.endsWith("/api/auth/bootstrap")) {
        return jsonResponse({
          authenticated: true,
          role: "owner",
          sessionMethod: "bearer-session-token",
          expiresAt: "2026-06-17T13:00:00.000Z",
          sessionToken: "session-token",
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      location: new URL("http://127.0.0.1:5733/"),
      sessionStorage: createSessionStorage(),
      desktopBridge: {
        getLocalEnvironmentBootstrap: () => ({
          label: "Local environment",
          httpBaseUrl: "http://127.0.0.1:13773",
          browserBootstrapUrl: "http://127.0.0.1:5733/#token=test-token",
          bootstrapToken: "bootstrap-token",
          runId: "test-run",
        }),
      },
    });

    await expect(resolveAuthenticatedServerBearerToken()).resolves.toBe("session-token");
    await expect(resolveAuthenticatedServerBearerToken()).resolves.toBe("session-token");

    expect(fetchMock.mock.calls.map(([input]) => readFetchInputUrl(input))).toEqual([
      "http://127.0.0.1:13773/api/auth/session",
      "http://127.0.0.1:13773/api/auth/bootstrap",
    ]);

    vi.setSystemTime(new Date("2026-06-17T12:01:01.000Z"));
    await expect(resolveAuthenticatedServerBearerToken()).resolves.toBe("session-token");

    expect(fetchMock.mock.calls.map(([input]) => readFetchInputUrl(input))).toEqual([
      "http://127.0.0.1:13773/api/auth/session",
      "http://127.0.0.1:13773/api/auth/bootstrap",
      "http://127.0.0.1:13773/api/auth/session",
    ]);
  });
});
