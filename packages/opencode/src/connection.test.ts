// @honk/opencode ships without @types/node; the reference keeps this Node-only test typed.
/// <reference types="node" />

import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  cancelHonkPairing,
  confirmHonkPairing,
  createOpenCodeAttachUrl,
  exchangeHonkPairing,
  HonkPairingRequestError,
  parseOpenCodeConnection,
  probeHonkServerIdentity,
  previewHonkPairing,
  revokeHonkConnection,
  verifyHonkServerIdentity,
  type OpenCodeFetch,
} from "./connection";

const digest = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(createHash("sha256").update(bytes).digest());

describe("verifyHonkServerIdentity", () => {
  it("verifies the host without sending authorization", async () => {
    const origin = "https://honk.example.com";
    const serverId = "stored-server-identity";
    const nonce = "probe-123";
    const requests: Array<{ readonly input: string; readonly init?: RequestInit }> = [];

    await expect(
      verifyHonkServerIdentity(origin, serverId, nonce, digest, {
        fetch: async (input, init) => {
          requests.push({ input, ...(init === undefined ? {} : { init }) });
          return Response.json({
            healthy: true,
            proof: createHmac("sha256", serverId)
              .update(`${origin}\n${nonce}`, "utf8")
              .digest("hex"),
          });
        },
      }),
    ).resolves.toBe(true);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe(`${origin}/honk/health?probe=${nonce}`);
    expect(new Headers(requests[0]?.init?.headers).has("Authorization")).toBe(false);
    expect(requests[0]?.init).not.toHaveProperty("body");
  });

  it.each([
    ["a payload without a proof", async () => Response.json({ healthy: true })],
    ["a non-string proof", async () => Response.json({ proof: 42 })],
    ["a mismatched proof", async () => Response.json({ proof: "0".repeat(64) })],
    ["a non-success response", async () => new Response(null, { status: 500 })],
    ["an unreadable JSON body", async () => new Response("not json")],
    [
      "a rejected fetch",
      async () => {
        throw new TypeError("offline");
      },
    ],
  ] satisfies ReadonlyArray<readonly [string, OpenCodeFetch]>)(
    "fails closed for %s",
    async (_name, fetchImpl) => {
      await expect(
        verifyHonkServerIdentity(
          "https://honk.example.com",
          "stored-server-identity",
          "probe-123",
          digest,
          { fetch: fetchImpl },
        ),
      ).resolves.toBe(false);
    },
  );

  it("aborts a timed-out proof request", async () => {
    await expect(
      verifyHonkServerIdentity(
        "https://honk.example.com",
        "stored-server-identity",
        "probe-123",
        digest,
        {
          timeoutMs: 1,
          fetch: async (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(new TypeError("aborted")));
            }),
        },
      ),
    ).resolves.toBe(false);
  });

  it("distinguishes an invalid proof from a retryable outage", async () => {
    await expect(
      probeHonkServerIdentity(
        "https://honk.example.com",
        "stored-server-identity",
        "probe-123",
        digest,
        {
          fetch: async () => Response.json({ proof: "0".repeat(64) }),
        },
      ),
    ).resolves.toEqual({ kind: "mismatch" });

    await expect(
      probeHonkServerIdentity(
        "https://honk.example.com",
        "stored-server-identity",
        "probe-123",
        digest,
        {
          fetch: async () => {
            throw new TypeError("offline");
          },
        },
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("stops an identity probe when its connection attempt is cancelled", async () => {
    const controller = new AbortController();
    const probing = probeHonkServerIdentity(
      "https://honk.example.com",
      "stored-server-identity",
      "probe-123",
      digest,
      {
        signal: controller.signal,
        fetch: async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new TypeError("aborted")));
          }),
      },
    );

    controller.abort();

    await expect(probing).resolves.toEqual({ kind: "unavailable" });
  });

  it("treats a timed-out response body as unavailable", async () => {
    class StalledJsonResponse extends Response {
      readonly requestSignal: AbortSignal | null | undefined;

      constructor(requestSignal: AbortSignal | null | undefined) {
        super(null, { status: 200 });
        this.requestSignal = requestSignal;
      }

      override json(): Promise<unknown> {
        return new Promise((_resolve, reject) => {
          this.requestSignal?.addEventListener(
            "abort",
            () => reject(new TypeError("body aborted")),
            { once: true },
          );
        });
      }
    }

    await expect(
      probeHonkServerIdentity(
        "https://honk.example.com",
        "stored-server-identity",
        "probe-123",
        digest,
        {
          timeoutMs: 1,
          fetch: async (_input, init) => new StalledJsonResponse(init?.signal),
        },
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });
});

describe("parseOpenCodeConnection", () => {
  it("ignores the packaged desktop page URL", () => {
    expect(
      parseOpenCodeConnection("honk://desktop/index.html", "http://127.0.0.1:52010"),
    ).toBeNull();
  });

  it("parses a Honk attach URL", () => {
    expect(
      parseOpenCodeConnection(
        createOpenCodeAttachUrl({ origin: "http://127.0.0.1:52010", password: "secret" }),
      ),
    ).toEqual({
      origin: "http://127.0.0.1:52010",
      credential: { type: "password", value: "secret" },
    });
  });

  it.each([
    [
      "host pairing fragment",
      "https://honk.example.com/pair#pairing=one-time-token",
      undefined,
      "https://honk.example.com",
      "pairing",
      "one-time-token",
    ],
    [
      "legacy host pairing token",
      "https://honk.example.com/pair#token=one-time-token",
      undefined,
      "https://honk.example.com",
      "pairing",
      "one-time-token",
    ],
    [
      "pairing query",
      "https://honk.example.com/pair?pairing=one-time-token",
      undefined,
      "https://honk.example.com",
      "pairing",
      "one-time-token",
    ],
    [
      "legacy Honk link",
      "honk://connect?host=https%3A%2F%2Fhonk.example.com#token=one-time-token",
      undefined,
      "https://honk.example.com",
      "pairing",
      "one-time-token",
    ],
    [
      "embedded origin pairing link",
      "https://app.example.com/connect?origin=https%3A%2F%2Fhonk.example.com&token=one-time-token",
      undefined,
      "https://honk.example.com",
      "pairing",
      "one-time-token",
    ],
    [
      "authenticated HTTP token",
      "https://honk.example.com/#token=device-password",
      undefined,
      "https://honk.example.com",
      "password",
      "device-password",
    ],
    [
      "password query",
      "https://honk.example.com/?password=device-password",
      undefined,
      "https://honk.example.com",
      "password",
      "device-password",
    ],
    [
      "password fragment",
      "https://honk.example.com/#password=device-password",
      undefined,
      "https://honk.example.com",
      "password",
      "device-password",
    ],
    [
      "raw password",
      "device-password",
      "https://honk.example.com",
      "https://honk.example.com",
      "password",
      "device-password",
    ],
  ] as const)("parses %s", (_name, value, fallbackOrigin, origin, type, secret) => {
    expect(parseOpenCodeConnection(value, fallbackOrigin)).toEqual({
      origin,
      credential: { type, value: secret },
    });
  });

  it("gives explicit pairing and password fields precedence over a legacy token", () => {
    expect(
      parseOpenCodeConnection(
        "https://honk.example.com/pair?password=device-password&token=legacy#pairing=pairing-token",
      ),
    ).toEqual({
      origin: "https://honk.example.com",
      credential: { type: "pairing", value: "pairing-token" },
    });
  });

  it("uses the selected host for a raw password", () => {
    expect(parseOpenCodeConnection("secret", "https://honk.example.com")).toEqual({
      origin: "https://honk.example.com",
      credential: { type: "password", value: "secret" },
    });
  });
});

describe("revokeHonkConnection", () => {
  it("signs out with the device credential", async () => {
    const requests: Array<{ readonly input: string; readonly init?: RequestInit }> = [];
    await revokeHonkConnection(
      { origin: "https://honk.example.com", password: "device-password" },
      async (input, init) => {
        requests.push({ input, ...(init === undefined ? {} : { init }) });
        return new Response(null, { status: 204 });
      },
    );

    expect(requests).toEqual([
      {
        input: "https://honk.example.com/honk/sign-out",
        init: {
          method: "POST",
          headers: { Authorization: "Basic b3BlbmNvZGU6ZGV2aWNlLXBhc3N3b3Jk" },
        },
      },
    ]);
  });

  it("keeps a failed revocation retryable", async () => {
    await expect(
      revokeHonkConnection(
        { origin: "https://honk.example.com", password: "device-password" },
        async () => new Response(null, { status: 503 }),
      ),
    ).rejects.toThrow("could not remove the old access");
  });
});

describe("exchangeHonkPairing", () => {
  it("claims a code provisionally with an explicit replay request ID", async () => {
    const requests: Array<{ readonly input: string; readonly init?: RequestInit }> = [];
    const provisional = await exchangeHonkPairing("https://honk.example.com", "one-time-token", {
      requestId: "019f81b3-e756-7740-943d-c647307d40d9",
      label: "Honk on iPhone",
      replacePassword: "old-password",
      fetch: async (input, init) => {
        requests.push({ input, ...(init === undefined ? {} : { init }) });
        return Response.json(
          {
            status: "provisional",
            password: "new-password",
            deviceId: "device-1",
            requestId: "019f81b3-e756-7740-943d-c647307d40d9",
            expiresAt: "2026-07-20T18:10:00.000Z",
          },
          { status: 202 },
        );
      },
    });

    expect(provisional).toEqual({
      deviceId: "device-1",
      origin: "https://honk.example.com",
      password: "new-password",
      requestId: "019f81b3-e756-7740-943d-c647307d40d9",
      expiresAt: "2026-07-20T18:10:00.000Z",
    });
    expect(requests).toEqual([
      {
        input: "https://honk.example.com/honk/pair",
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: "Basic b3BlbmNvZGU6b2xkLXBhc3N3b3Jk",
          },
          body: JSON.stringify({
            token: "one-time-token",
            requestId: "019f81b3-e756-7740-943d-c647307d40d9",
            label: "Honk on iPhone",
          }),
        },
      },
    ]);
  });

  it("classifies an unreadable server response as retryable", async () => {
    await expect(
      exchangeHonkPairing("https://honk.example.com", "one-time-token", {
        requestId: "019f81b3-e756-7740-943d-c647307d40d9",
        fetch: async () => new Response("not json"),
      }),
    ).rejects.toMatchObject({ kind: "retryable" });
  });

  it.each([
    ["a primitive payload", Response.json("provisional", { status: 202 })],
    [
      "the wrong success status",
      Response.json({
        status: "provisional",
        password: "new-password",
        requestId: "019f81b3-e756-7740-943d-c647307d40d9",
        expiresAt: "2026-07-20T18:10:00.000Z",
      }),
    ],
    [
      "a mismatched replay identity",
      Response.json(
        {
          status: "provisional",
          password: "new-password",
          requestId: "different-request-id",
          expiresAt: "2026-07-20T18:10:00.000Z",
        },
        { status: 202 },
      ),
    ],
    [
      "an invalid expiry",
      Response.json(
        {
          status: "provisional",
          password: "new-password",
          requestId: "019f81b3-e756-7740-943d-c647307d40d9",
          expiresAt: "not-a-date",
        },
        { status: 202 },
      ),
    ],
  ])("rejects %s as a retryable response", async (_name, response) => {
    await expect(
      exchangeHonkPairing("https://honk.example.com", "one-time-token", {
        requestId: "019f81b3-e756-7740-943d-c647307d40d9",
        fetch: async () => response,
      }),
    ).rejects.toMatchObject({ kind: "retryable" });
  });

  it("keeps a code retryable when the saved replacement access is stale", async () => {
    await expect(
      exchangeHonkPairing("https://honk.example.com", "still-valid-token", {
        requestId: "019f81b3-e756-7740-943d-c647307d40d9",
        replacePassword: "revoked-password",
        fetch: async () =>
          Response.json(
            {
              code: "existing_access_invalid",
              error: "The existing device access is no longer valid.",
            },
            { status: 401 },
          ),
      }),
    ).rejects.toMatchObject({ kind: "existing-access-invalid" });
  });

  it("rejects a code already claimed by another request ID", async () => {
    await expect(
      exchangeHonkPairing("https://honk.example.com", "claimed-token", {
        requestId: "019f81b3-e756-7740-943d-c647307d40d9",
        fetch: async () => Response.json({ code: "pairing_in_progress" }, { status: 409 }),
      }),
    ).rejects.toMatchObject({
      kind: "invalid",
      message:
        "Another device already started using this connection code. Ask for a new code and try again.",
    });
  });
});

describe("confirmHonkPairing", () => {
  const provisional = {
    deviceId: "device-1",
    origin: "https://honk.example.com",
    password: "provisional-password",
    requestId: "019f81b3-e756-7740-943d-c647307d40d9",
    expiresAt: "2026-07-20T18:10:00.000Z",
  };

  it("activates access with the provisional credential", async () => {
    const requests: Array<{ readonly input: string; readonly init?: RequestInit }> = [];

    await expect(
      confirmHonkPairing(provisional, async (input, init) => {
        requests.push({ input, ...(init === undefined ? {} : { init }) });
        return Response.json({
          status: "completed",
          password: "provisional-password",
          deviceId: "device-1",
          label: "Honk web",
          serverId: "server-identity",
        });
      }),
    ).resolves.toEqual({
      deviceId: "device-1",
      origin: "https://honk.example.com",
      password: "provisional-password",
      serverId: "server-identity",
    });
    expect(requests).toEqual([
      {
        input: "https://honk.example.com/honk/pair/confirm",
        init: {
          method: "POST",
          headers: { Authorization: "Basic b3BlbmNvZGU6cHJvdmlzaW9uYWwtcGFzc3dvcmQ=" },
        },
      },
    ]);
  });

  it("accepts a confirmation from an older host without an identity", async () => {
    await expect(
      confirmHonkPairing(provisional, async () =>
        Response.json({
          status: "completed",
          password: "provisional-password",
          label: "Honk web",
        }),
      ),
    ).resolves.toEqual({
      deviceId: "device-1",
      origin: "https://honk.example.com",
      password: "provisional-password",
      serverId: null,
    });
  });

  it("rejects a confirmation for a different paired device", async () => {
    await expect(
      confirmHonkPairing(provisional, async () =>
        Response.json({
          status: "completed",
          password: "provisional-password",
          deviceId: "device-2",
          serverId: "server-identity",
        }),
      ),
    ).rejects.toMatchObject({ kind: "retryable" });
  });

  it("keeps transport and server failures retryable", async () => {
    await expect(
      confirmHonkPairing(provisional, async () => {
        throw new TypeError("response lost");
      }),
    ).rejects.toMatchObject({ kind: "retryable" });
    await expect(
      confirmHonkPairing(provisional, async () =>
        Response.json({ code: "pairing_confirm_failed" }, { status: 503 }),
      ),
    ).rejects.toMatchObject({ kind: "retryable" });
  });

  it("recovers when confirmation commits before its transport response is lost", async () => {
    const requests: string[] = [];

    await expect(
      confirmHonkPairing(provisional, async (input) => {
        requests.push(input);
        if (input.endsWith("/honk/pair/confirm")) throw new TypeError("response lost");
        return Response.json({ healthy: true });
      }),
    ).resolves.toEqual({
      deviceId: "device-1",
      origin: "https://honk.example.com",
      password: "provisional-password",
      serverId: null,
    });
    expect(requests).toEqual([
      "https://honk.example.com/honk/pair/confirm",
      "https://honk.example.com/global/health",
    ]);
  });

  it("keeps a transport failure retryable when health does not accept the candidate", async () => {
    await expect(
      confirmHonkPairing(provisional, async (input) => {
        if (input.endsWith("/honk/pair/confirm")) throw new TypeError("response lost");
        return new Response(null, { status: 401 });
      }),
    ).rejects.toMatchObject({ kind: "retryable" });
  });

  it("requires a new code when provisional access has expired", async () => {
    await expect(
      confirmHonkPairing(provisional, async () =>
        Response.json({ code: "pairing_invalid" }, { status: 401 }),
      ),
    ).rejects.toMatchObject({ kind: "invalid" });
  });

  it("recovers when confirmation was committed before its replay record expired", async () => {
    const requests: string[] = [];

    await expect(
      confirmHonkPairing(provisional, async (input) => {
        requests.push(input);
        return input.endsWith("/honk/pair/confirm")
          ? Response.json({ code: "pairing_invalid" }, { status: 401 })
          : Response.json({ healthy: true });
      }),
    ).resolves.toEqual({
      deviceId: "device-1",
      origin: "https://honk.example.com",
      password: "provisional-password",
      serverId: null,
    });
    expect(requests).toEqual([
      "https://honk.example.com/honk/pair/confirm",
      "https://honk.example.com/global/health",
    ]);
  });

  it("keeps an unauthorized confirmation invalid when health rejects the credential", async () => {
    await expect(
      confirmHonkPairing(provisional, async (input) =>
        input.endsWith("/honk/pair/confirm")
          ? Response.json({ code: "pairing_invalid" }, { status: 401 })
          : new Response(null, { status: 401 }),
      ),
    ).rejects.toMatchObject({ kind: "invalid" });
  });

  it("keeps an uncertain health fallback retryable", async () => {
    await expect(
      confirmHonkPairing(provisional, async (input) =>
        input.endsWith("/honk/pair/confirm")
          ? Response.json({ code: "pairing_invalid" }, { status: 401 })
          : new Response(null, { status: 503 }),
      ),
    ).rejects.toMatchObject({ kind: "retryable" });
  });

  it.each([
    ["unreadable health", new Response("not json")],
    ["an unhealthy response", Response.json({ healthy: false })],
  ])("does not certify access from %s", async (_name, health) => {
    await expect(
      confirmHonkPairing(provisional, async (input) =>
        input.endsWith("/honk/pair/confirm")
          ? Response.json({ code: "pairing_invalid" }, { status: 401 })
          : health,
      ),
    ).rejects.toMatchObject({ kind: "retryable" });
  });

  it.each([
    ["a primitive payload", Response.json("completed")],
    [
      "the wrong success status",
      Response.json({ status: "completed", password: "provisional-password" }, { status: 201 }),
    ],
    ["a changed password", Response.json({ status: "completed", password: "unexpected-password" })],
  ])("keeps %s retryable", async (_name, response) => {
    await expect(confirmHonkPairing(provisional, async () => response)).rejects.toMatchObject({
      kind: "retryable",
    });
  });
});

describe("cancelHonkPairing", () => {
  const provisional = {
    deviceId: "device-1",
    origin: "https://honk.example.com",
    password: "provisional-password",
    requestId: "019f81b3-e756-7740-943d-c647307d40d9",
    expiresAt: "2026-07-20T18:10:00.000Z",
  };

  it("cancels only the provisional credential", async () => {
    const requests: Array<{ readonly input: string; readonly init?: RequestInit }> = [];
    await cancelHonkPairing(provisional, async (input, init) => {
      requests.push({ input, ...(init === undefined ? {} : { init }) });
      return new Response(null, { status: 204 });
    });

    expect(requests).toEqual([
      {
        input: "https://honk.example.com/honk/pair/cancel",
        init: {
          method: "POST",
          headers: { Authorization: "Basic b3BlbmNvZGU6cHJvdmlzaW9uYWwtcGFzc3dvcmQ=" },
        },
      },
    ]);
  });

  it("keeps a failed cancellation retryable", async () => {
    await expect(
      cancelHonkPairing(provisional, async () => new Response(null, { status: 503 })),
    ).rejects.toMatchObject({ kind: "retryable" });
  });
});

describe("previewHonkPairing", () => {
  it("decodes the host identity without exposing the pairing token in the URL", async () => {
    const requests: string[] = [];
    const preview = await previewHonkPairing(
      "https://honk.example.com",
      "one-time-token",
      async (input, init) => {
        requests.push(input);
        expect(init?.body).toBe(JSON.stringify({ token: "one-time-token" }));
        return new Response(
          JSON.stringify({
            name: "Daniel's Mac",
            origin: "https://honk.example.com",
            expiresAt: "2026-07-20T13:21:39.000Z",
            serverId: "server-identity",
          }),
          { status: 200 },
        );
      },
    );

    expect(requests).toEqual(["https://honk.example.com/honk/pair/preview"]);
    expect(preview).toEqual({
      name: "Daniel's Mac",
      origin: "https://honk.example.com",
      expiresAt: "2026-07-20T13:21:39.000Z",
      serverId: "server-identity",
    });
  });

  it("accepts a preview from an older host without an identity", async () => {
    await expect(
      previewHonkPairing("https://honk.example.com", "one-time-token", async () =>
        Response.json({
          name: "Daniel's Mac",
          origin: "https://honk.example.com",
          expiresAt: "2026-07-20T13:21:39.000Z",
        }),
      ),
    ).resolves.toEqual({
      name: "Daniel's Mac",
      origin: "https://honk.example.com",
      expiresAt: "2026-07-20T13:21:39.000Z",
      serverId: null,
    });
  });

  it("distinguishes an expired code from a retryable network failure", async () => {
    await expect(
      previewHonkPairing(
        "https://honk.example.com",
        "expired-token",
        async () => new Response(null, { status: 401 }),
      ),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      previewHonkPairing("https://honk.example.com", "live-token", async () => {
        throw new TypeError("offline");
      }),
    ).rejects.toMatchObject({ kind: "retryable" } satisfies Partial<HonkPairingRequestError>);
  });

  it.each([
    ["unreadable JSON", new Response("not json")],
    [
      "an invalid returned address",
      Response.json({
        name: "Daniel's Mac",
        origin: "not an address",
        expiresAt: "2026-07-20T13:21:39.000Z",
      }),
    ],
    [
      "an invalid expiry",
      Response.json({
        name: "Daniel's Mac",
        origin: "https://honk.example.com",
        expiresAt: "not-a-date",
      }),
    ],
  ])("classifies %s as a retryable server response", async (_name, response) => {
    await expect(
      previewHonkPairing("https://honk.example.com", "one-time-token", async () => response),
    ).rejects.toMatchObject({ kind: "retryable" });
  });
});
