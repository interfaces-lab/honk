import {
  HonkPairingRequestError,
  type OpenCodeConnection,
  type OpenCodeFetch,
} from "@honk/opencode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const opencodeMocks = vi.hoisted(() => ({
  cancelPairing: vi.fn(),
  closeClient: vi.fn(),
  confirmPairing: vi.fn(),
  disconnectClient: vi.fn(),
  exchangePairing: vi.fn(),
  previewPairing: vi.fn(),
  registerClient: vi.fn(),
  revokeConnection: vi.fn(),
}));

vi.mock("@honk/opencode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@honk/opencode")>();
  return {
    ...actual,
    createOpenCodeClient: vi.fn((server: { readonly key: string; readonly origin: string }) => ({
      server,
      close: opencodeMocks.closeClient,
    })),
    createOpenCodeRegistry: vi.fn(() => ({
      register: opencodeMocks.registerClient,
      disconnect: opencodeMocks.disconnectClient,
    })),
    cancelHonkPairing: opencodeMocks.cancelPairing,
    confirmHonkPairing: opencodeMocks.confirmPairing,
    exchangeHonkPairing: opencodeMocks.exchangePairing,
    previewHonkPairing: opencodeMocks.previewPairing,
    revokeHonkConnection: opencodeMocks.revokeConnection,
  };
});

vi.mock("./provider-auth", () => ({ bindProviderAuthClient: vi.fn() }));
vi.mock("./watch-registry", () => ({ bindOpenCodeClient: vi.fn() }));

const HOST_ORIGIN = "https://studio.example.test";
const PAIRING_TOKEN = "pairing-token";
const PAIRING_LINK = `https://browser.example.test/?origin=${encodeURIComponent(HOST_ORIGIN)}#pairing=${PAIRING_TOKEN}`;
const LEGACY_PAIRING_LINK = `https://browser.example.test/pair?origin=${encodeURIComponent(HOST_ORIGIN)}#pairing=${PAIRING_TOKEN}`;
const PAIRING_PREVIEW = {
  name: "Studio Mac",
  origin: HOST_ORIGIN,
  expiresAt: "2026-07-20T18:10:00.000Z",
};
const PROVISIONAL_CONNECTION = {
  origin: HOST_ORIGIN,
  password: "device-password",
  requestId: "019f81b3-e756-7740-943d-c647307d40d9",
  expiresAt: "2026-07-20T18:10:00.000Z",
};

beforeEach(() => {
  vi.resetModules();
  Object.values(opencodeMocks).forEach((mock) => mock.mockReset());
  opencodeMocks.previewPairing.mockResolvedValue(PAIRING_PREVIEW);
  opencodeMocks.exchangePairing.mockImplementation(
    async (_origin: string, _token: string, options: { readonly requestId: string }) => ({
      ...PROVISIONAL_CONNECTION,
      requestId: options.requestId,
    }),
  );
  opencodeMocks.confirmPairing.mockImplementation(async (provisional) => ({
    origin: provisional.origin,
    password: provisional.password,
  }));
  opencodeMocks.cancelPairing.mockResolvedValue(undefined);
  opencodeMocks.revokeConnection.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function installBrowserPage(value: string, storage = new Map<string, string>()) {
  let pageUrl = new URL(value);
  const replaceState = vi.fn((_state: unknown, _title: string, next: string | URL | null) => {
    if (next !== null) pageUrl = new URL(next.toString(), pageUrl);
  });
  const dispatchEvent = vi.fn(() => true);
  vi.stubGlobal("window", {
    get location() {
      return pageUrl;
    },
    history: { state: null, replaceState },
    dispatchEvent,
  });
  vi.stubGlobal(
    "PopStateEvent",
    class {
      readonly type: string;
      readonly state: unknown;

      constructor(type: string, init: { readonly state: unknown }) {
        this.type = type;
        this.state = init.state;
      }
    },
  );
  vi.stubGlobal("document", { title: "Honk" });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, next: string) => storage.set(key, next),
  });
  const fetch = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return { dispatchEvent, fetch, href: () => pageUrl.toString(), replaceState, storage };
}

function createControlledExchange() {
  const control: {
    finish: (connection: typeof PROVISIONAL_CONNECTION) => void;
  } = {
    finish: () => {
      throw new Error("The exchange request has not started.");
    },
  };
  const request = new Promise<typeof PROVISIONAL_CONNECTION>((resolve) => {
    control.finish = resolve;
  });
  return { control, request };
}

describe("browser pairing confirmation", () => {
  it("previews a pairing URL and exchanges it only after confirmation", async () => {
    const browser = installBrowserPage(LEGACY_PAIRING_LINK);
    const store = await import("./connection-store");

    store.startConnection();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    expect(opencodeMocks.previewPairing).toHaveBeenCalledWith(HOST_ORIGIN, PAIRING_TOKEN);
    expect(opencodeMocks.exchangePairing).not.toHaveBeenCalled();
    expect(browser.href()).toContain(`pairing=${PAIRING_TOKEN}`);

    store.actions.confirmPairing();

    expect(browser.href()).toContain(`pairing=${PAIRING_TOKEN}`);
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("authenticated"));
    expect(browser.href()).not.toContain(PAIRING_TOKEN);
    expect(new URL(browser.href()).pathname).toBe("/");
    expect(browser.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "popstate" }),
    );
    expect(opencodeMocks.exchangePairing).toHaveBeenCalledOnce();
    expect(opencodeMocks.confirmPairing).toHaveBeenCalledOnce();
    expect(opencodeMocks.confirmPairing.mock.invocationCallOrder[0]).toBeGreaterThan(
      opencodeMocks.exchangePairing.mock.invocationCallOrder[0] ?? 0,
    );
    expect(browser.storage.size).toBe(0);
    expect(browser.fetch).toHaveBeenCalledWith(
      `${HOST_ORIGIN}/global/health`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("cancels a pasted pairing claim without granting access", async () => {
    const browser = installBrowserPage("https://browser.example.test/");
    const store = await import("./connection-store");

    store.actions.submitToken(PAIRING_LINK);

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    expect(opencodeMocks.previewPairing).toHaveBeenCalledOnce();
    expect(opencodeMocks.exchangePairing).not.toHaveBeenCalled();

    browser.fetch.mockImplementation(async () => new Response(null, { status: 401 }));
    store.actions.cancelPairing();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("requires-auth"));
    await vi.waitFor(() => expect(opencodeMocks.cancelPairing).toHaveBeenCalledOnce());
    expect(opencodeMocks.exchangePairing).toHaveBeenCalledOnce();
    expect(opencodeMocks.confirmPairing).not.toHaveBeenCalled();
  });

  it("returns a canceled legacy pairing URL to the home path", async () => {
    const browser = installBrowserPage(LEGACY_PAIRING_LINK);
    const store = await import("./connection-store");

    store.startConnection();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));

    browser.fetch.mockImplementation(async () => new Response(null, { status: 401 }));
    store.actions.cancelPairing();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("requires-auth"));
    expect(new URL(browser.href()).pathname).toBe("/");
    expect(browser.href()).not.toContain(PAIRING_TOKEN);
    expect(browser.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "popstate" }),
    );
    await vi.waitFor(() => expect(opencodeMocks.cancelPairing).toHaveBeenCalledOnce());
    expect(opencodeMocks.exchangePairing).toHaveBeenCalledOnce();
    expect(opencodeMocks.confirmPairing).not.toHaveBeenCalled();
  });

  it("uses a pasted password directly without treating it as a pairing request", async () => {
    installBrowserPage("https://browser.example.test/");
    const store = await import("./connection-store");

    store.actions.submitToken("browser-password");

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("authenticated"));
    expect(opencodeMocks.previewPairing).not.toHaveBeenCalled();
    expect(opencodeMocks.exchangePairing).not.toHaveBeenCalled();
  });

  it("ignores a preview that finishes after a newer connection attempt", async () => {
    installBrowserPage(PAIRING_LINK);
    const previewRequestControl: { finish: (preview: typeof PAIRING_PREVIEW) => void } = {
      finish: () => {
        throw new Error("The preview request has not started.");
      },
    };
    const previewRequest = new Promise<typeof PAIRING_PREVIEW>((resolve) => {
      previewRequestControl.finish = resolve;
    });
    opencodeMocks.previewPairing.mockReturnValue(previewRequest);
    const store = await import("./connection-store");
    const statuses: string[] = [];
    const unsubscribe = store.subscribe(() => statuses.push(store.getSnapshot().status));

    store.startConnection();
    await vi.waitFor(() => expect(opencodeMocks.previewPairing).toHaveBeenCalledOnce());

    store.actions.submitToken("newer-password");
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("authenticated"));

    previewRequestControl.finish(PAIRING_PREVIEW);
    await previewRequest;
    await Promise.resolve();

    expect(store.getSnapshot().status).toBe("authenticated");
    expect(statuses).not.toContain("confirm-pairing");
    expect(opencodeMocks.exchangePairing).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("cancels a pairing claim when a newer attempt supersedes it", async () => {
    installBrowserPage(PAIRING_LINK);
    const store = await import("./connection-store");

    store.startConnection();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));

    store.actions.confirmPairing();
    store.actions.submitToken("newer-password");

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("authenticated"));
    await vi.waitFor(() => expect(opencodeMocks.cancelPairing).toHaveBeenCalledOnce());
    expect(opencodeMocks.exchangePairing).toHaveBeenCalledOnce();
    expect(opencodeMocks.confirmPairing).not.toHaveBeenCalled();
  });

  it("revokes an exchange that finishes after a newer connection wins", async () => {
    const browser = installBrowserPage(PAIRING_LINK);
    const exchange = createControlledExchange();
    opencodeMocks.exchangePairing.mockReturnValue(exchange.request);
    opencodeMocks.cancelPairing.mockImplementationOnce(
      async (_connection: OpenCodeConnection, fetchImpl: OpenCodeFetch) => {
        await fetchImpl(`${HOST_ORIGIN}/honk/pair/cancel`, {
          method: "POST",
          headers: { Authorization: "Basic superseded" },
        });
      },
    );
    const store = await import("./connection-store");

    store.startConnection();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    store.actions.confirmPairing();
    await vi.waitFor(() => expect(opencodeMocks.exchangePairing).toHaveBeenCalledOnce());

    store.actions.submitToken("newer-password");
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("authenticated"));

    exchange.control.finish({ ...PROVISIONAL_CONNECTION, password: "superseded-password" });
    await exchange.request;
    await vi.waitFor(() =>
      expect(opencodeMocks.cancelPairing).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: HOST_ORIGIN,
          password: "superseded-password",
        }),
        expect.any(Function),
      ),
    );
    expect(opencodeMocks.exchangePairing).toHaveBeenCalledTimes(2);

    expect(browser.fetch).toHaveBeenCalledWith(`${HOST_ORIGIN}/honk/pair/cancel`, {
      method: "POST",
      headers: { Authorization: "Basic superseded" },
      credentials: "omit",
    });
    expect(store.getAuthenticatedBearer()).toBe("newer-password");
    expect(store.getSnapshot().status).toBe("authenticated");
  });

  it("revokes an in-flight exchange when the connection is canceled", async () => {
    const browser = installBrowserPage(PAIRING_LINK);
    const exchange = createControlledExchange();
    opencodeMocks.exchangePairing.mockReturnValue(exchange.request);
    const store = await import("./connection-store");

    store.startConnection();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    store.actions.confirmPairing();
    await vi.waitFor(() => expect(opencodeMocks.exchangePairing).toHaveBeenCalledOnce());

    browser.fetch.mockImplementation(async () => new Response(null, { status: 401 }));
    store.actions.cancelPairing();
    expect(store.getSnapshot().status).toBe("connecting");

    exchange.control.finish({ ...PROVISIONAL_CONNECTION, password: "canceled-password" });
    await exchange.request;
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("requires-auth"));
    await vi.waitFor(() =>
      expect(opencodeMocks.cancelPairing).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: HOST_ORIGIN,
          password: "canceled-password",
        }),
        expect.any(Function),
      ),
    );

    expect(browser.href()).not.toContain(PAIRING_TOKEN);
    expect(store.getAuthenticatedBearer()).toBeNull();
  });

  it("keeps a pairing URL when preview has a retryable connection failure", async () => {
    const browser = installBrowserPage(PAIRING_LINK);
    opencodeMocks.previewPairing
      .mockRejectedValueOnce(
        new HonkPairingRequestError("retryable", "Could not check this connection code."),
      )
      .mockResolvedValueOnce(PAIRING_PREVIEW);
    const store = await import("./connection-store");

    store.startConnection();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("unreachable"));
    expect(browser.href()).toContain(`pairing=${PAIRING_TOKEN}`);

    store.actions.retry();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    expect(opencodeMocks.previewPairing).toHaveBeenCalledTimes(2);
    expect(opencodeMocks.exchangePairing).not.toHaveBeenCalled();
  });

  it("retries a pasted pairing link after preview temporarily fails", async () => {
    installBrowserPage("https://browser.example.test/");
    opencodeMocks.previewPairing
      .mockRejectedValueOnce(
        new HonkPairingRequestError("retryable", "Could not check this connection code."),
      )
      .mockResolvedValueOnce(PAIRING_PREVIEW);
    const store = await import("./connection-store");

    store.actions.submitToken(PAIRING_LINK);

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("unreachable"));
    store.actions.retry();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    expect(opencodeMocks.previewPairing).toHaveBeenCalledTimes(2);
    expect(opencodeMocks.exchangePairing).not.toHaveBeenCalled();
  });

  it("retries a password removed from the address bar after a temporary network failure", async () => {
    const password = "browser-password";
    const browser = installBrowserPage(
      `https://browser.example.test/?origin=${encodeURIComponent(HOST_ORIGIN)}#password=${password}`,
    );
    browser.fetch
      .mockRejectedValueOnce(new TypeError("The computer is temporarily unavailable."))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const store = await import("./connection-store");

    store.startConnection();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("unreachable"));
    expect(browser.href()).not.toContain(password);

    store.actions.retry();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("authenticated"));
    expect(store.getAuthenticatedBearer()).toBe(password);
    expect(browser.fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a pairing URL available when exchange cannot reach the computer", async () => {
    const browser = installBrowserPage(PAIRING_LINK);
    opencodeMocks.exchangePairing
      .mockRejectedValueOnce(
        new HonkPairingRequestError("retryable", "Could not finish connecting."),
      )
      .mockResolvedValueOnce(PROVISIONAL_CONNECTION);
    const store = await import("./connection-store");

    store.startConnection();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    store.actions.confirmPairing();

    await vi.waitFor(() =>
      expect(store.getSnapshot()).toMatchObject({
        status: "confirm-pairing",
        errorMessage:
          "Could not finish connecting. Check that Honk is running on this computer, then try again.",
      }),
    );
    expect(browser.href()).toContain(`pairing=${PAIRING_TOKEN}`);

    store.actions.confirmPairing();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("authenticated"));
    expect(opencodeMocks.exchangePairing).toHaveBeenCalledTimes(2);
    expect(opencodeMocks.exchangePairing.mock.calls[0]?.[2]).toMatchObject({
      requestId: opencodeMocks.exchangePairing.mock.calls[1]?.[2]?.requestId,
    });
    expect(opencodeMocks.confirmPairing).toHaveBeenCalledOnce();
    expect(browser.href()).not.toContain(PAIRING_TOKEN);
  });

  it("replays and cancels a provisional claim after the exchange response is lost", async () => {
    const browser = installBrowserPage(PAIRING_LINK);
    opencodeMocks.exchangePairing
      .mockRejectedValueOnce(
        new HonkPairingRequestError("retryable", "The exchange response was lost."),
      )
      .mockImplementationOnce(
        async (_origin: string, _token: string, options: { readonly requestId: string }) => ({
          ...PROVISIONAL_CONNECTION,
          requestId: options.requestId,
        }),
      );
    const store = await import("./connection-store");

    store.startConnection();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    store.actions.confirmPairing();
    await vi.waitFor(() =>
      expect(store.getSnapshot()).toMatchObject({
        status: "confirm-pairing",
        errorMessage:
          "Could not finish connecting. Check that Honk is running on this computer, then try again.",
      }),
    );

    browser.fetch.mockImplementation(async () => new Response(null, { status: 401 }));
    store.actions.cancelPairing();

    await vi.waitFor(() => expect(opencodeMocks.cancelPairing).toHaveBeenCalledOnce());
    expect(opencodeMocks.exchangePairing).toHaveBeenCalledTimes(2);
    expect(opencodeMocks.exchangePairing.mock.calls[0]?.[2]?.requestId).toBe(
      opencodeMocks.exchangePairing.mock.calls[1]?.[2]?.requestId,
    );
    expect(opencodeMocks.confirmPairing).not.toHaveBeenCalled();
    expect(browser.href()).not.toContain(PAIRING_TOKEN);
    expect(browser.storage.size).toBe(0);
  });

  it("keeps pairing ownership when cancellation cannot reach the computer", async () => {
    const browser = installBrowserPage(PAIRING_LINK);
    opencodeMocks.confirmPairing.mockRejectedValue(
      new HonkPairingRequestError("retryable", "The confirmation response was lost."),
    );
    opencodeMocks.cancelPairing
      .mockRejectedValueOnce(
        new HonkPairingRequestError("retryable", "The cancellation response was lost."),
      )
      .mockResolvedValue(undefined);
    const store = await import("./connection-store");

    store.startConnection();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    store.actions.confirmPairing();
    await vi.waitFor(() =>
      expect(store.getSnapshot()).toMatchObject({
        status: "confirm-pairing",
        errorMessage:
          "Could not finish connecting. Check that Honk is running on this computer, then try again.",
      }),
    );

    store.actions.cancelPairing();
    await vi.waitFor(() =>
      expect(store.getSnapshot()).toMatchObject({
        status: "confirm-pairing",
        errorMessage:
          "Could not cancel this connection. Check that Honk is running on this computer, then try again.",
      }),
    );
    expect(browser.href()).toContain(`pairing=${PAIRING_TOKEN}`);
    expect(browser.storage.size).toBe(1);

    browser.fetch.mockResolvedValue(new Response(null, { status: 401 }));
    store.actions.cancelPairing();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("requires-auth"));
    expect(opencodeMocks.cancelPairing).toHaveBeenCalledTimes(2);
    expect(browser.href()).not.toContain(PAIRING_TOKEN);
    expect(browser.storage.size).toBe(0);
  });

  it("keeps a pasted pairing link available when exchange needs a retry", async () => {
    installBrowserPage("https://browser.example.test/");
    opencodeMocks.exchangePairing
      .mockRejectedValueOnce(
        new HonkPairingRequestError("retryable", "Could not finish connecting."),
      )
      .mockResolvedValueOnce(PROVISIONAL_CONNECTION);
    const store = await import("./connection-store");

    store.actions.submitToken(PAIRING_LINK);
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    store.actions.confirmPairing();

    await vi.waitFor(() =>
      expect(store.getSnapshot()).toMatchObject({
        status: "confirm-pairing",
        errorMessage:
          "Could not finish connecting. Check that Honk is running on this computer, then try again.",
        pairing: { token: PAIRING_TOKEN },
      }),
    );

    store.actions.confirmPairing();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("authenticated"));
    expect(opencodeMocks.previewPairing).toHaveBeenCalledOnce();
    expect(opencodeMocks.exchangePairing).toHaveBeenCalledTimes(2);
    expect(opencodeMocks.exchangePairing.mock.calls[0]?.[2]?.requestId).toBe(
      opencodeMocks.exchangePairing.mock.calls[1]?.[2]?.requestId,
    );
  });

  it("retries confirmation with the same provisional password after its response is lost", async () => {
    const browser = installBrowserPage(PAIRING_LINK);
    opencodeMocks.confirmPairing
      .mockRejectedValueOnce(
        new HonkPairingRequestError("retryable", "The confirmation response was lost."),
      )
      .mockResolvedValueOnce({ origin: HOST_ORIGIN, password: "device-password" });
    const store = await import("./connection-store");

    store.startConnection();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    store.actions.confirmPairing();

    await vi.waitFor(() =>
      expect(store.getSnapshot()).toMatchObject({
        status: "confirm-pairing",
        errorMessage:
          "Could not finish connecting. Check that Honk is running on this computer, then try again.",
      }),
    );
    expect(browser.href()).toContain(`pairing=${PAIRING_TOKEN}`);
    expect(opencodeMocks.exchangePairing).toHaveBeenCalledOnce();
    expect(opencodeMocks.confirmPairing).toHaveBeenCalledOnce();

    store.actions.confirmPairing();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("authenticated"));
    expect(opencodeMocks.exchangePairing).toHaveBeenCalledOnce();
    expect(opencodeMocks.confirmPairing).toHaveBeenCalledTimes(2);
    expect(opencodeMocks.confirmPairing.mock.calls[0]?.[0]).toEqual(
      opencodeMocks.confirmPairing.mock.calls[1]?.[0],
    );
    expect(browser.href()).not.toContain(PAIRING_TOKEN);
  });

  it("replays the same exchange identity after a reload loses the provisional response", async () => {
    const browser = installBrowserPage(PAIRING_LINK);
    opencodeMocks.exchangePairing.mockRejectedValueOnce(
      new HonkPairingRequestError("retryable", "The exchange response was lost."),
    );
    const store = await import("./connection-store");

    store.startConnection();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    store.actions.confirmPairing();
    await vi.waitFor(() =>
      expect(store.getSnapshot()).toMatchObject({
        status: "confirm-pairing",
        errorMessage:
          "Could not finish connecting. Check that Honk is running on this computer, then try again.",
      }),
    );
    const requestId = opencodeMocks.exchangePairing.mock.calls[0]?.[2]?.requestId;
    expect(requestId).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(browser.storage.size).toBe(1);

    vi.resetModules();
    installBrowserPage(PAIRING_LINK, browser.storage);
    opencodeMocks.exchangePairing.mockImplementation(
      async (_origin: string, _token: string, options: { readonly requestId: string }) => ({
        ...PROVISIONAL_CONNECTION,
        requestId: options.requestId,
      }),
    );
    const reloadedStore = await import("./connection-store");
    reloadedStore.startConnection();
    await vi.waitFor(() => expect(reloadedStore.getSnapshot().status).toBe("confirm-pairing"));
    reloadedStore.actions.confirmPairing();

    await vi.waitFor(() => expect(reloadedStore.getSnapshot().status).toBe("authenticated"));
    expect(opencodeMocks.exchangePairing).toHaveBeenCalledTimes(2);
    expect(opencodeMocks.exchangePairing.mock.calls[1]?.[2]?.requestId).toBe(requestId);
    expect(browser.storage.size).toBe(0);
  });

  it("revokes access when confirmation finishes after a newer connection wins", async () => {
    const browser = installBrowserPage(PAIRING_LINK);
    const confirmationControl: {
      finish: (connection: OpenCodeConnection) => void;
    } = {
      finish: () => {
        throw new Error("The confirmation request has not started.");
      },
    };
    const confirmation = new Promise<OpenCodeConnection>((resolve) => {
      confirmationControl.finish = resolve;
    });
    opencodeMocks.confirmPairing.mockReturnValue(confirmation);
    opencodeMocks.revokeConnection.mockImplementation(
      async (_connection: OpenCodeConnection, fetchImpl: OpenCodeFetch) => {
        await fetchImpl(`${HOST_ORIGIN}/honk/sign-out`, {
          method: "POST",
          headers: { Authorization: "Basic stale" },
        });
      },
    );
    const store = await import("./connection-store");

    store.startConnection();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    store.actions.confirmPairing();
    await vi.waitFor(() => expect(opencodeMocks.confirmPairing).toHaveBeenCalledOnce());

    store.actions.submitToken("newer-password");
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("authenticated"));
    confirmationControl.finish({ origin: HOST_ORIGIN, password: "device-password" });
    await confirmation;
    await vi.waitFor(() => expect(opencodeMocks.revokeConnection).toHaveBeenCalled());

    expect(browser.fetch).toHaveBeenCalledWith(`${HOST_ORIGIN}/honk/sign-out`, {
      method: "POST",
      headers: { Authorization: "Basic stale" },
      credentials: "omit",
    });
    expect(store.getAuthenticatedBearer()).toBe("newer-password");
    expect(store.getSnapshot().status).toBe("authenticated");
  });

  it("revokes confirmed access when a newer connection wins during its health probe", async () => {
    const browser = installBrowserPage(PAIRING_LINK);
    const healthControl: { finish: (response: Response) => void } = {
      finish: () => {
        throw new Error("The health request has not started.");
      },
    };
    const health = new Promise<Response>((resolve) => {
      healthControl.finish = resolve;
    });
    browser.fetch
      .mockReturnValueOnce(health)
      .mockResolvedValue(new Response(null, { status: 200 }));
    const store = await import("./connection-store");

    store.startConnection();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    store.actions.confirmPairing();
    await vi.waitFor(() => expect(browser.fetch).toHaveBeenCalledOnce());

    store.actions.submitToken("newer-password");
    await vi.waitFor(() => expect(store.getAuthenticatedBearer()).toBe("newer-password"));
    healthControl.finish(new Response(null, { status: 200 }));
    await vi.waitFor(() =>
      expect(opencodeMocks.revokeConnection).toHaveBeenCalledWith(
        { origin: HOST_ORIGIN, password: "device-password" },
        expect.any(Function),
      ),
    );

    expect(store.getAuthenticatedBearer()).toBe("newer-password");
    expect(store.getSnapshot().status).toBe("authenticated");
  });

  it("recovers a committed pairing from same-origin cookies after its response is lost", async () => {
    const browser = installBrowserPage(`${HOST_ORIGIN}/#pairing=${PAIRING_TOKEN}`);
    opencodeMocks.previewPairing.mockRejectedValue(
      new HonkPairingRequestError("invalid", "This connection code was already used."),
    );
    browser.fetch
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValue(new Response(null, { status: 200 }));
    const store = await import("./connection-store");

    store.startConnection();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("authenticated"));
    expect(browser.fetch).toHaveBeenNthCalledWith(2, `${HOST_ORIGIN}/honk/pair/confirm`, {
      method: "POST",
      credentials: "include",
    });
    expect(browser.href()).not.toContain(PAIRING_TOKEN);
    expect(opencodeMocks.exchangePairing).not.toHaveBeenCalled();
  });

  it("keeps a committed pairing link when cookie recovery cannot reach the computer", async () => {
    const browser = installBrowserPage(`${HOST_ORIGIN}/#pairing=${PAIRING_TOKEN}`);
    opencodeMocks.previewPairing.mockRejectedValue(
      new HonkPairingRequestError("invalid", "This connection code was already used."),
    );
    browser.fetch
      .mockRejectedValueOnce(new TypeError("The computer is temporarily unavailable."))
      .mockResolvedValue(new Response(null, { status: 200 }));
    const store = await import("./connection-store");

    store.startConnection();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("unreachable"));
    expect(browser.href()).toContain(`pairing=${PAIRING_TOKEN}`);

    store.actions.retry();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("authenticated"));
    expect(browser.href()).not.toContain(PAIRING_TOKEN);
    expect(opencodeMocks.exchangePairing).not.toHaveBeenCalled();
  });

  it("keeps old browser access when a replacement is canceled during confirmation", async () => {
    const browser = installBrowserPage("https://browser.example.test/");
    const confirmationControl: { reject: (error: Error) => void } = {
      reject: () => {
        throw new Error("The confirmation request has not started.");
      },
    };
    opencodeMocks.confirmPairing.mockReturnValue(
      new Promise((_resolve, reject) => {
        confirmationControl.reject = reject;
      }),
    );
    const store = await import("./connection-store");

    store.actions.submitToken(
      `https://browser.example.test/?origin=${encodeURIComponent(HOST_ORIGIN)}#password=old-password`,
    );
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("authenticated"));
    store.actions.submitToken(PAIRING_LINK);
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    store.actions.confirmPairing();
    await vi.waitFor(() => expect(opencodeMocks.confirmPairing).toHaveBeenCalledOnce());

    expect(opencodeMocks.exchangePairing.mock.calls[0]?.[2]).toMatchObject({
      replacePassword: "old-password",
    });
    store.actions.cancelPairing();
    confirmationControl.reject(new HonkPairingRequestError("invalid", "Pairing canceled."));

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("authenticated"));
    expect(store.getAuthenticatedBearer()).toBe("old-password");
    expect(opencodeMocks.cancelPairing).toHaveBeenCalledWith(
      expect.objectContaining({ password: "device-password" }),
      expect.any(Function),
    );
    expect(browser.storage.size).toBe(0);
  });

  it("explains when another device already claimed the code", async () => {
    const browser = installBrowserPage(PAIRING_LINK);
    opencodeMocks.exchangePairing.mockRejectedValue(
      new HonkPairingRequestError(
        "invalid",
        "Another device already started using this connection code. Ask for a new code and try again.",
      ),
    );
    const store = await import("./connection-store");

    store.startConnection();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    store.actions.confirmPairing();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("requires-auth"));
    expect(store.getSnapshot().errorMessage).toBe(
      "Another device already started using this connection code. Ask for a new code and try again.",
    );
    expect(browser.href()).not.toContain(PAIRING_TOKEN);
    expect(browser.storage.size).toBe(0);
  });

  it("discards a pairing URL after exchange reports that its code is invalid", async () => {
    const browser = installBrowserPage(PAIRING_LINK);
    opencodeMocks.exchangePairing.mockRejectedValue(
      new HonkPairingRequestError("invalid", "This connection code expired."),
    );
    const store = await import("./connection-store");

    store.startConnection();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("confirm-pairing"));
    store.actions.confirmPairing();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("requires-auth"));
    expect(store.getSnapshot().errorMessage).toBe("This connection code expired.");
    expect(browser.href()).not.toContain(PAIRING_TOKEN);
    expect(browser.storage.size).toBe(0);
    expect(opencodeMocks.exchangePairing).toHaveBeenCalledOnce();
  });

  it("returns an expired pairing link to the connection form", async () => {
    const browser = installBrowserPage(PAIRING_LINK);
    opencodeMocks.previewPairing.mockRejectedValue(
      new HonkPairingRequestError("invalid", "This connection code expired."),
    );
    const store = await import("./connection-store");

    store.startConnection();

    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("requires-auth"));
    expect(store.getSnapshot().errorMessage).toBe("This connection code expired.");
    expect(browser.href()).not.toContain(PAIRING_TOKEN);
    expect(opencodeMocks.exchangePairing).not.toHaveBeenCalled();
  });
});
