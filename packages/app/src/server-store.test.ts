import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
  cancelPairing: vi.fn(),
  canPersist: true,
  clients: [] as Array<{
    readonly close: ReturnType<typeof vi.fn>;
    readonly health: ReturnType<typeof vi.fn>;
    readonly server: { readonly key: string; readonly origin: string };
  }>,
  confirmPairing: vi.fn(),
  createClient: vi.fn(),
  exchangePairing: vi.fn(),
  getClient: vi.fn(),
  health: vi.fn(),
  protectCredential: vi.fn(),
  registerClient: vi.fn(),
  removeServer: vi.fn(),
  revealCredential: vi.fn(),
  revokeConnection: vi.fn(),
  selectServer: vi.fn(),
  storageFailAt: null as number | null,
  storageValue: null as string | null,
  storageWrites: 0,
  unregisterClient: vi.fn(),
  watchedServers: [] as Array<{
    readonly server: {
      readonly key: string;
      readonly label: string;
      readonly origin: string;
      readonly kind: "remote";
    };
    readonly selected: boolean;
    readonly status: "live";
  }>,
}));

vi.mock("@honk/opencode", () => ({
  cancelHonkPairing: controls.cancelPairing,
  confirmHonkPairing: controls.confirmPairing,
  createOpenCodeClient: controls.createClient,
  createOpenCodeServer: ({
    origin,
    label,
  }: {
    readonly origin: string;
    readonly label?: string;
  }) => ({
    key: origin,
    label: label ?? "Remote computer",
    origin,
    kind: "remote",
  }),
  exchangeHonkPairing: controls.exchangePairing,
  normalizeRemoteOpenCodeOrigin: (origin: string) => origin.replace(/\/+$/, ""),
  parseOpenCodeConnection: (credential: string, origin: string) => ({
    origin,
    credential: credential.startsWith("password:")
      ? { type: "password", value: credential.slice("password:".length) }
      : { type: "pairing", value: credential },
  }),
  revokeHonkConnection: controls.revokeConnection,
}));

vi.mock("./connection-store", () => ({
  getSnapshot: () => ({ status: "authenticated" }),
  subscribe: () => () => undefined,
}));

vi.mock("./desktop-bridge", () => ({
  canPersistRemoteCredential: () => controls.canPersist,
  protectRemoteCredential: controls.protectCredential,
  revealRemoteCredential: controls.revealCredential,
}));

vi.mock("./tab-store", () => ({
  actions: {
    registerServer: vi.fn(),
    removeServer: controls.removeServer,
  },
}));

vi.mock("./watch-registry", () => ({
  getOpenCodeClient: controls.getClient,
  getOpenCodeServersSnapshot: () => ({ servers: controls.watchedServers }),
  registerOpenCodeClient: controls.registerClient,
  selectOpenCodeServer: controls.selectServer,
  subscribeOpenCodeServers: () => () => undefined,
  unregisterOpenCodeClient: controls.unregisterClient,
}));

type ServerStore = typeof import("./server-store");

const ORIGIN = "https://computer.example.com";
const PAIRING_CODE = "one-time-code";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly reject: (cause: unknown) => void;
  readonly resolve: (value: T) => void;
} {
  let rejectPromise: ((cause: unknown) => void) | undefined;
  let resolvePromise: ((value: T) => void) | undefined;
  return {
    promise: new Promise<T>((resolve, reject) => {
      rejectPromise = reject;
      resolvePromise = resolve;
    }),
    reject: (cause) => rejectPromise?.(cause),
    resolve: (value) => resolvePromise?.(value),
  };
}

function storedRegistry(): {
  readonly selectedRemoteOrigin: string | null;
  readonly servers: ReadonlyArray<{
    readonly origin: string;
    readonly paired?: boolean;
    readonly pendingPairing?: {
      readonly expiresAt?: string;
      readonly phase: "confirm" | "exchange";
      readonly protectedCredential: string | null;
      readonly requestId: string;
    } | null;
    readonly protectedCredential: string | null;
    readonly removing?: boolean;
  }>;
} {
  if (controls.storageValue === null) throw new Error("The server registry was not saved.");
  return JSON.parse(controls.storageValue) as ReturnType<typeof storedRegistry>;
}

async function loadStore(
  servers: readonly object[] = [],
  selectedRemoteOrigin: string | null = null,
): Promise<ServerStore> {
  controls.storageValue = JSON.stringify({
    version: 1,
    selectedRemoteOrigin,
    servers,
  });
  return import("./server-store");
}

beforeAll(() => {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: () => controls.storageValue,
      setItem: (_key: string, value: string) => {
        controls.storageWrites += 1;
        if (controls.storageFailAt === controls.storageWrites) throw new Error("Storage is full.");
        controls.storageValue = value;
      },
    },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  controls.canPersist = true;
  controls.clients.length = 0;
  controls.storageFailAt = null;
  controls.storageValue = null;
  controls.storageWrites = 0;
  controls.watchedServers.length = 0;
  controls.getClient.mockReturnValue(null);
  controls.health.mockResolvedValue(undefined);
  controls.cancelPairing.mockResolvedValue(undefined);
  controls.revokeConnection.mockResolvedValue(undefined);
  controls.protectCredential.mockImplementation(
    async (credential: string) => `protected:${credential}`,
  );
  controls.revealCredential.mockImplementation(async (credential: string) =>
    credential.replace(/^protected:/, ""),
  );
  controls.exchangePairing.mockImplementation(
    async (origin: string, _token: string, options: { readonly requestId: string }) => ({
      origin,
      password: "provisional-password",
      requestId: options.requestId,
      expiresAt: "2026-07-20T18:10:00.000Z",
    }),
  );
  controls.confirmPairing.mockImplementation(
    async (provisional: { readonly origin: string; readonly password: string }) => ({
      origin: provisional.origin,
      password: provisional.password,
    }),
  );
  controls.createClient.mockImplementation(
    (server: { readonly key: string; readonly origin: string }) => {
      const client = {
        server,
        health: vi.fn(() => controls.health()),
        close: vi.fn(),
      };
      controls.clients.push(client);
      return client;
    },
  );
  controls.selectServer.mockReturnValue(true);
});

describe("server store pairing", () => {
  it("does not consume a pairing code for a server already managed by this store", async () => {
    const store = await loadStore([
      {
        origin: ORIGIN,
        label: "Existing computer",
        protectedCredential: null,
      },
    ]);

    await expect(
      store.actions.connect({ origin: ORIGIN, credential: PAIRING_CODE }),
    ).rejects.toThrow("already connected");
    expect(controls.exchangePairing).not.toHaveBeenCalled();
  });

  it("does not consume a pairing code for a server managed elsewhere", async () => {
    const store = await loadStore();
    controls.getClient.mockReturnValue({ close: vi.fn() });

    await expect(
      store.actions.connect({ origin: ORIGIN, credential: PAIRING_CODE }),
    ).rejects.toThrow("already connected");
    expect(controls.exchangePairing).not.toHaveBeenCalled();
  });

  it("durably stages the request ID and provisional password before remote transitions", async () => {
    const store = await loadStore();
    controls.exchangePairing.mockImplementation(
      async (origin: string, token: string, options: { readonly requestId: string }) => {
        expect(token).toBe(PAIRING_CODE);
        expect(storedRegistry().servers[0]?.pendingPairing).toEqual({
          phase: "exchange",
          requestId: options.requestId,
          protectedCredential: `protected:${PAIRING_CODE}`,
        });
        return {
          origin,
          password: "provisional-password",
          requestId: options.requestId,
          expiresAt: "2026-07-20T18:10:00.000Z",
        };
      },
    );
    controls.confirmPairing.mockImplementation(
      async (provisional: { readonly origin: string; readonly password: string }) => {
        expect(storedRegistry().servers[0]?.pendingPairing).toMatchObject({
          phase: "confirm",
          protectedCredential: "protected:provisional-password",
        });
        return { origin: provisional.origin, password: provisional.password };
      },
    );

    await store.actions.connect({ origin: ORIGIN, credential: PAIRING_CODE });

    expect(storedRegistry()).toMatchObject({
      selectedRemoteOrigin: ORIGIN,
      servers: [
        {
          origin: ORIGIN,
          protectedCredential: "protected:provisional-password",
          pendingPairing: null,
        },
      ],
    });
    expect(store.getSnapshot().servers[0]).toMatchObject({ status: "live", persistent: true });
  });

  it("does not claim a code when the initial pending record cannot be saved", async () => {
    const store = await loadStore();
    controls.storageFailAt = 1;

    await expect(
      store.actions.connect({ origin: ORIGIN, credential: PAIRING_CODE }),
    ).rejects.toThrow("Storage is full");
    expect(controls.exchangePairing).not.toHaveBeenCalled();
    expect(store.getSnapshot().servers).toEqual([]);
  });

  it("retains a provisional credential when its confirmation record cannot be saved", async () => {
    const store = await loadStore();
    controls.storageFailAt = 2;

    await expect(
      store.actions.connect({ origin: ORIGIN, credential: PAIRING_CODE }),
    ).rejects.toThrow("Storage is full");
    expect(storedRegistry().servers[0]?.pendingPairing?.phase).toBe("exchange");
    expect(store.getSnapshot().servers[0]).toMatchObject({ status: "failed" });
    expect(controls.confirmPairing).not.toHaveBeenCalled();

    controls.storageFailAt = null;
    await store.actions.connect({ origin: ORIGIN, credential: PAIRING_CODE });
    expect(controls.exchangePairing).toHaveBeenCalledTimes(1);
    expect(controls.confirmPairing).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().servers[0]).toMatchObject({ status: "live" });
  });

  it("retains and retries the same provisional password after a lost confirmation response", async () => {
    const store = await loadStore();
    controls.confirmPairing
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockImplementationOnce(
        async (provisional: { readonly origin: string; readonly password: string }) => ({
          origin: provisional.origin,
          password: provisional.password,
        }),
      );

    await expect(
      store.actions.connect({ origin: ORIGIN, credential: PAIRING_CODE }),
    ).rejects.toThrow("response lost");
    const pending = storedRegistry().servers[0]?.pendingPairing;
    expect(pending).toMatchObject({
      phase: "confirm",
      protectedCredential: "protected:provisional-password",
    });
    expect(store.getSnapshot().servers[0]).toMatchObject({ status: "failed" });

    await store.actions.connect({ origin: ORIGIN, credential: PAIRING_CODE });
    expect(controls.exchangePairing).toHaveBeenCalledTimes(1);
    expect(controls.confirmPairing).toHaveBeenCalledTimes(2);
    expect(controls.confirmPairing.mock.calls[1]?.[0]).toMatchObject({
      password: "provisional-password",
      requestId: pending?.requestId,
    });
  });

  it("retains confirmed credentials when the first health probe fails", async () => {
    const store = await loadStore();
    controls.health.mockRejectedValueOnce(new Error("not ready")).mockResolvedValue(undefined);

    await expect(
      store.actions.connect({ origin: ORIGIN, credential: PAIRING_CODE }),
    ).rejects.toThrow("not ready");
    expect(storedRegistry().servers[0]).toMatchObject({
      protectedCredential: null,
      pendingPairing: {
        phase: "confirm",
        protectedCredential: "protected:provisional-password",
      },
    });
    expect(store.getSnapshot().servers[0]).toMatchObject({ status: "failed", persistent: true });

    const server = store.getSnapshot().servers[0]?.server.key;
    if (server === undefined) throw new Error("Missing failed server.");
    await store.actions.retry(server);
    expect(controls.exchangePairing).toHaveBeenCalledTimes(1);
    expect(controls.confirmPairing).toHaveBeenCalledTimes(2);
    expect(controls.health).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().servers[0]).toMatchObject({ status: "live" });
  });

  it("resumes a protected pending confirmation after relaunch", async () => {
    const store = await loadStore([
      {
        origin: ORIGIN,
        label: "Remote computer",
        protectedCredential: null,
        pendingPairing: {
          phase: "confirm",
          requestId: "request-0001",
          expiresAt: "2026-07-20T18:10:00.000Z",
          protectedCredential: "protected:provisional-password",
        },
      },
    ]);

    store.installRemoteServerRestore();
    await vi.waitFor(() => expect(store.getSnapshot().restoring).toBe(false));
    expect(controls.exchangePairing).not.toHaveBeenCalled();
    expect(controls.confirmPairing).toHaveBeenCalledWith(
      expect.objectContaining({
        password: "provisional-password",
        requestId: "request-0001",
      }),
    );
    expect(store.getSnapshot().servers[0]).toMatchObject({ status: "live" });
  });

  it("keeps the previous live client when a replacement health probe fails", async () => {
    const store = await loadStore();
    await store.actions.connect({ origin: ORIGIN, credential: "password:old-password" });
    const previous = controls.clients[0];
    controls.health.mockRejectedValueOnce(new Error("candidate failed"));

    await expect(
      store.actions.connect({ origin: ORIGIN, credential: "password:new-password" }),
    ).rejects.toThrow("candidate failed");
    expect(previous?.close).not.toHaveBeenCalled();
    expect(controls.unregisterClient).not.toHaveBeenCalled();
    expect(controls.clients[1]?.close).toHaveBeenCalledOnce();
    expect(store.getSnapshot().servers[0]).toMatchObject({ status: "live" });
  });

  it("clears a stale saved password when reconnect protection fails", async () => {
    const store = await loadStore();
    await store.actions.connect({ origin: ORIGIN, credential: "password:old-password" });
    controls.protectCredential.mockRejectedValueOnce(new Error("keychain unavailable"));

    await store.actions.connect({ origin: ORIGIN, credential: "password:new-password" });
    expect(storedRegistry().servers[0]).toMatchObject({ protectedCredential: null });
    expect(store.getSnapshot().servers[0]).toMatchObject({
      status: "live",
      persistent: false,
      error: "keychain unavailable",
    });
  });

  it("preserves a live client when removing its durable record fails", async () => {
    const store = await loadStore();
    await store.actions.connect({ origin: ORIGIN, credential: "password:password" });
    const client = controls.clients[0];
    controls.storageFailAt = controls.storageWrites + 1;

    const server = store.getSnapshot().servers[0]?.server.key;
    if (server === undefined) throw new Error("Missing connected server.");
    store.actions.remove(server);
    expect(client?.close).not.toHaveBeenCalled();
    expect(controls.removeServer).not.toHaveBeenCalled();
    expect(store.getSnapshot().servers[0]).toMatchObject({
      status: "live",
      error: "Storage is full.",
    });
  });

  it("does not resurrect a pairing removed while confirmation is in flight", async () => {
    const store = await loadStore();
    const confirmation = deferred<{ readonly origin: string; readonly password: string }>();
    controls.confirmPairing.mockReturnValue(confirmation.promise);
    const connection = store.actions.connect({ origin: ORIGIN, credential: PAIRING_CODE });
    await vi.waitFor(() => expect(controls.confirmPairing).toHaveBeenCalledOnce());

    const server = store.getSnapshot().servers[0]?.server.key;
    if (server === undefined) throw new Error("Missing pending server.");
    store.actions.remove(server);
    confirmation.resolve({ origin: ORIGIN, password: "provisional-password" });
    await expect(connection).resolves.toBeUndefined();

    expect(controls.cancelPairing).toHaveBeenCalledWith({
      origin: ORIGIN,
      password: "provisional-password",
      requestId: expect.any(String),
      expiresAt: "2026-07-20T18:10:00.000Z",
    });
    expect(controls.registerClient).not.toHaveBeenCalled();
    expect(store.getSnapshot().servers).toEqual([]);
  });

  it("retains failed cleanup across relaunch and retries it before forgetting access", async () => {
    const store = await loadStore();
    const confirmation = deferred<{ readonly origin: string; readonly password: string }>();
    controls.confirmPairing.mockReturnValue(confirmation.promise);
    controls.cancelPairing.mockRejectedValue(new Error("computer offline"));
    const connection = store.actions.connect({ origin: ORIGIN, credential: PAIRING_CODE });
    await vi.waitFor(() => expect(controls.confirmPairing).toHaveBeenCalledOnce());

    const server = store.getSnapshot().servers[0]?.server.key;
    if (server === undefined) throw new Error("Missing pending server.");
    store.actions.remove(server);
    confirmation.resolve({ origin: ORIGIN, password: "provisional-password" });
    await expect(connection).resolves.toBeUndefined();
    await vi.waitFor(() =>
      expect(store.getSnapshot().servers[0]).toMatchObject({
        removing: true,
        status: "failed",
        error: "computer offline",
      }),
    );
    expect(storedRegistry().servers[0]).toMatchObject({
      removing: true,
      pendingPairing: {
        phase: "confirm",
        protectedCredential: "protected:provisional-password",
      },
    });

    const savedServers = storedRegistry().servers;
    vi.resetModules();
    const relaunched = await loadStore(savedServers);
    relaunched.installRemoteServerRestore();
    await vi.waitFor(() => expect(relaunched.getSnapshot().restoring).toBe(false));
    expect(relaunched.getSnapshot().servers[0]).toMatchObject({ removing: true, status: "failed" });

    controls.cancelPairing.mockResolvedValue(undefined);
    const savedServer = relaunched.getSnapshot().servers[0]?.server.key;
    if (savedServer === undefined) throw new Error("Missing retained cleanup server.");
    await relaunched.actions.retry(savedServer);
    expect(relaunched.getSnapshot().servers).toEqual([]);
    expect(storedRegistry().servers).toEqual([]);
  });

  it("revokes completed pairing access before removing its saved server", async () => {
    const store = await loadStore();
    await store.actions.connect({ origin: ORIGIN, credential: PAIRING_CODE });

    const server = store.getSnapshot().servers[0]?.server.key;
    if (server === undefined) throw new Error("Missing paired server.");
    store.actions.remove(server);
    await vi.waitFor(() => expect(store.getSnapshot().servers).toEqual([]));

    expect(controls.revokeConnection).toHaveBeenCalledWith({
      origin: ORIGIN,
      password: "provisional-password",
    });
  });

  it("can explicitly forget an unrecoverable cleanup record locally", async () => {
    const store = await loadStore([
      {
        origin: ORIGIN,
        label: "Offline computer",
        protectedCredential: null,
        pendingPairing: null,
        paired: true,
        removing: true,
      },
    ]);

    const server = store.getSnapshot().servers[0]?.server.key;
    if (server === undefined) throw new Error("Missing cleanup server.");
    store.actions.forget(server);

    expect(store.getSnapshot().servers).toEqual([]);
    expect(storedRegistry().servers).toEqual([]);
    expect(controls.cancelPairing).not.toHaveBeenCalled();
    expect(controls.revokeConnection).not.toHaveBeenCalled();
  });

  it("does not resurrect a removed server when a retry probe finishes late", async () => {
    const store = await loadStore();
    await store.actions.connect({ origin: ORIGIN, credential: "password:password" });
    const server = store.getSnapshot().servers[0]?.server.key;
    if (server === undefined) throw new Error("Missing connected server.");
    const health = deferred<void>();
    controls.health.mockReturnValueOnce(health.promise);
    const retry = store.actions.retry(server);
    await vi.waitFor(() => expect(controls.health).toHaveBeenCalledTimes(2));

    store.actions.remove(server);
    health.resolve(undefined);
    await retry;

    expect(controls.clients[1]?.close).toHaveBeenCalledOnce();
    expect(store.getSnapshot().servers).toEqual([]);
  });

  it("does not change selection when the candidate registry cannot be saved", async () => {
    const store = await loadStore();
    await store.actions.connect({ origin: ORIGIN, credential: "password:password" });
    controls.watchedServers.push({
      server: { key: ORIGIN, label: "Remote computer", origin: ORIGIN, kind: "remote" },
      selected: false,
      status: "live",
    });
    controls.selectServer.mockClear();
    controls.storageFailAt = controls.storageWrites + 1;

    const server = store.getSnapshot().servers[0]?.server.key;
    if (server === undefined) throw new Error("Missing connected server.");
    store.actions.select(server);
    expect(controls.selectServer).not.toHaveBeenCalled();
    expect(store.getSnapshot().servers[0]?.error).toBe("Storage is full.");
  });
});
