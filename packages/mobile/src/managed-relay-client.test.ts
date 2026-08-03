import {
  ManagedRelayEnvironmentLinkRequest,
  ManagedRelayLinkChallengeRequest,
} from "@honk/shared/managed-relay";
import {
  ManagedEnvironmentSummaryWire,
  ManagedRemoteEndpointWire,
} from "@honk/shared/managed-remote-access";
import { Schema } from "effect";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  createManagedRelayClient,
  ManagedRelayAuthorizationError,
  ManagedRelayConfigurationInvalidError,
  type ManagedRelayClient,
  type ManagedRelayFetch,
  ManagedRelayHttpError,
  ManagedRelayOriginInvalidError,
  ManagedRelayRequestAbortedError,
  ManagedRelayRequestFailedError,
  ManagedRelayRequestTimeoutError,
  ManagedRelayResponseInvalidError,
  normalizeManagedRelayOrigin,
} from "./managed-relay-client";

const accountToken = "account-token-secret";
const session = { account: "account-one" };
const endpoint = Schema.decodeUnknownSync(ManagedRemoteEndpointWire)({
  providerKind: "cloudflare_tunnel",
  httpBaseUrl: "https://7zc4pk2m.remote.honk.example/",
  wsBaseUrl: "wss://7zc4pk2m.remote.honk.example/",
});
const environment = Schema.decodeUnknownSync(ManagedEnvironmentSummaryWire)({
  environmentId: "environment-7zc4pk2m",
  label: "Studio",
  endpoint,
  status: "online",
  lastSeenAt: "2026-07-30T18:00:00.000Z",
});
const challengePayload = Schema.decodeUnknownSync(ManagedRelayLinkChallengeRequest)({
  environmentId: environment.environmentId,
  deviceId: "device-phone",
  providerKind: "cloudflare_tunnel",
});
const linkPayload = Schema.decodeUnknownSync(ManagedRelayEnvironmentLinkRequest)({
  requestId: "link-1",
  deviceId: "device-phone",
  proof: "signed-environment-proof",
});

afterEach(() => {
  vi.useRealTimers();
});

describe("managed relay origin", () => {
  it.each([
    [" https://Relay.Example.test/// ", "https://relay.example.test"],
    ["https://relay.example.test:8443/", "https://relay.example.test:8443"],
  ])("normalizes a secure origin", (value, expected) => {
    expect(normalizeManagedRelayOrigin(value)).toBe(expected);
  });

  it.each([
    "http://relay.example.test",
    "https://user:password@relay.example.test",
    "https://relay.example.test/v1",
    "https://relay.example.test?account=secret",
    "https://relay.example.test#fragment",
    "/relative",
    "not a URL",
  ])("rejects a non-canonical or insecure origin", (value) => {
    expect(normalizeManagedRelayOrigin(value)).toBeNull();
    expect(() =>
      createManagedRelayClient({
        relayOrigin: value,
        readAccountToken: () => Promise.resolve(accountToken),
      }),
    ).toThrow(ManagedRelayOriginInvalidError);
  });

  it("rejects an invalid timeout without exposing configuration input", () => {
    expect(() =>
      createManagedRelayClient({
        relayOrigin: "https://relay.example.test",
        readAccountToken: () => Promise.resolve(accountToken),
        timeoutMs: 0,
      }),
    ).toThrow(ManagedRelayConfigurationInvalidError);
  });
});

describe("managed relay requests", () => {
  it("uses the specified relay routes and decodes every response schema", async () => {
    const fetchImpl = vi.fn<ManagedRelayFetch>();
    [
      {
        requestId: "link-1",
        challenge: "single-use-challenge",
        allocationGeneration: 3,
        providerKind: "cloudflare_tunnel",
        relayIssuer: "https://relay.example.test",
        expiresAt: "2026-07-30T18:05:00.000Z",
        responseSecret: "discard-me",
      },
      {
        environment,
        enrollment: {
          requestId: "link-1",
          allocationGeneration: 3,
          grant: "single-use-enrollment-grant",
          expiresAt: "2026-07-30T18:05:00.000Z",
          connectorToken: "must-not-cross-mobile",
          tunnelSecret: "must-not-cross-mobile",
        },
        environmentCredential: "must-not-cross-mobile",
      },
      {
        environment,
        enrollment: {
          requestId: "link-1",
          allocationGeneration: 3,
          grant: "single-use-enrollment-grant",
          expiresAt: "2026-07-30T18:05:00.000Z",
        },
      },
      {
        environments: [environment],
        accountToken: "must-not-survive-decoding",
      },
      {
        environmentId: environment.environmentId,
        endpoint,
        status: "online",
        checkedAt: "2026-07-30T18:01:00.000Z",
        hostCredential: "must-not-survive-decoding",
      },
    ].forEach((value) => {
      fetchImpl.mockResolvedValueOnce(
        new Response(JSON.stringify(value), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    });
    const readAccountToken = vi.fn<
      (input: { readonly session: typeof session; readonly signal: AbortSignal }) => Promise<string>
    >(() => Promise.resolve(accountToken));
    const client = createManagedRelayClient({
      relayOrigin: " https://Relay.Example.test/// ",
      readAccountToken,
      fetch: fetchImpl,
    });

    const challenge = await client.createLinkChallenge({
      session,
      payload: challengePayload,
    });
    const linked = await client.submitLink({ session, payload: linkPayload });
    const recovered = await client.recoverLink({
      session,
      requestId: linkPayload.requestId,
    });
    const listed = await client.listEnvironments({ session });
    const status = await client.getEnvironmentStatus({
      session,
      environmentId: challengePayload.environmentId,
    });

    expect(client.relayOrigin).toBe("https://relay.example.test");
    expect(challenge).not.toHaveProperty("responseSecret");
    expect(linked).not.toHaveProperty("environmentCredential");
    expect(linked.enrollment).not.toHaveProperty("connectorToken");
    expect(linked.enrollment).not.toHaveProperty("tunnelSecret");
    expect(recovered.environment).toEqual(environment);
    expect(listed).toEqual({ environments: [environment] });
    expect(status).toEqual({
      environmentId: environment.environmentId,
      endpoint,
      status: "online",
      checkedAt: "2026-07-30T18:01:00.000Z",
    });
    expectTypeOf(client).toEqualTypeOf<ManagedRelayClient<typeof session>>();

    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["https://relay.example.test/v1/link-challenges", "POST"],
      ["https://relay.example.test/v1/environments/link", "POST"],
      ["https://relay.example.test/v1/environment-links/link-1", "GET"],
      ["https://relay.example.test/v1/environments", "GET"],
      ["https://relay.example.test/v1/environments/environment-7zc4pk2m/status", "GET"],
    ]);
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(challengePayload));
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(linkPayload));
    fetchImpl.mock.calls.forEach(([, init]) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${accountToken}`);
      expect(new Headers(init?.headers).get("accept")).toBe("application/json");
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("error");
    });
    expect(readAccountToken).toHaveBeenCalledTimes(5);
    expect(readAccountToken.mock.calls.every(([input]) => input.session === session)).toBe(true);
  });

  it("keeps authorization, transport, HTTP, and decoding failures redacted", async () => {
    const authorizationClient = createManagedRelayClient({
      relayOrigin: "https://relay.example.test",
      readAccountToken: () => Promise.reject(new Error(`provider rejected ${accountToken}`)),
    });
    const authorizationError = await rejection(authorizationClient.listEnvironments({ session }));
    expect(authorizationError).toBeInstanceOf(ManagedRelayAuthorizationError);
    expect(redactedErrorText(authorizationError)).not.toContain(accountToken);
    expect(authorizationError).not.toHaveProperty("cause");

    const transportClient = createManagedRelayClient({
      relayOrigin: "https://relay.example.test",
      readAccountToken: () => Promise.resolve(accountToken),
      fetch: vi.fn<ManagedRelayFetch>(() =>
        Promise.reject(new Error(`network failed with ${accountToken}`)),
      ),
    });
    const transportError = await rejection(transportClient.listEnvironments({ session }));
    expect(transportError).toBeInstanceOf(ManagedRelayRequestFailedError);
    expect(redactedErrorText(transportError)).not.toContain(accountToken);
    expect(transportError).not.toHaveProperty("cause");

    const responseSecret = "relay-response-body-secret";
    const httpClient = createManagedRelayClient({
      relayOrigin: "https://relay.example.test",
      readAccountToken: () => Promise.resolve(accountToken),
      fetch: vi.fn<ManagedRelayFetch>(() =>
        Promise.resolve(new Response(responseSecret, { status: 403 })),
      ),
    });
    const httpError = await rejection(httpClient.listEnvironments({ session }));
    expect(httpError).toMatchObject({
      code: "http_error",
      operation: "list_environments",
      status: 403,
    });
    expect(httpError).toBeInstanceOf(ManagedRelayHttpError);
    expect(redactedErrorText(httpError)).not.toContain(responseSecret);
    expect(httpError).not.toHaveProperty("cause");

    const invalidClient = createManagedRelayClient({
      relayOrigin: "https://relay.example.test",
      readAccountToken: () => Promise.resolve(accountToken),
      fetch: vi.fn<ManagedRelayFetch>(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              environments: [{ responseSecret }],
            }),
            { status: 200 },
          ),
        ),
      ),
    });
    const invalidError = await rejection(invalidClient.listEnvironments({ session }));
    expect(invalidError).toBeInstanceOf(ManagedRelayResponseInvalidError);
    expect(redactedErrorText(invalidError)).not.toContain(responseSecret);
    expect(invalidError).not.toHaveProperty("cause");
  });

  it("times out while the successful response body is still pending", async () => {
    vi.useFakeTimers();
    const bodyStarted = deferred<void>();
    const response = new Response(null, { status: 200 });
    Object.defineProperty(response, "json", {
      value: () => {
        bodyStarted.resolve();
        return new Promise<never>(() => undefined);
      },
    });
    const client = createManagedRelayClient({
      relayOrigin: "https://relay.example.test",
      readAccountToken: () => Promise.resolve(accountToken),
      fetch: vi.fn<ManagedRelayFetch>(() => Promise.resolve(response)),
      timeoutMs: 100,
    });

    const pending = rejection(client.listEnvironments({ session }));
    await bodyStarted.promise;
    await vi.advanceTimersByTimeAsync(100);

    const error = await pending;
    expect(error).toMatchObject({
      code: "request_timed_out",
      operation: "list_environments",
      timeoutMs: 100,
    });
    expect(error).toBeInstanceOf(ManagedRelayRequestTimeoutError);
  });

  it("cancels a request immediately when its caller aborts", async () => {
    const authorizationStarted = deferred<void>();
    const observedSignal = deferred<AbortSignal>();
    const client = createManagedRelayClient({
      relayOrigin: "https://relay.example.test",
      readAccountToken: ({ signal }) => {
        observedSignal.resolve(signal);
        authorizationStarted.resolve();
        return new Promise<never>(() => undefined);
      },
    });
    const controller = new AbortController();
    const pending = client.listEnvironments({ session, signal: controller.signal });
    await authorizationStarted.promise;

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(ManagedRelayRequestAbortedError);
    expect((await observedSignal.promise).aborted).toBe(true);
  });
});

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolvePromise: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

function redactedErrorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return `${String(error)} ${error.stack ?? ""} ${JSON.stringify(error)}`;
}
