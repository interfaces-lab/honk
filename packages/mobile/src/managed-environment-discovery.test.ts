import {
  canonicalManagedEnvironmentSummary,
  type ManagedEnvironmentId,
  type ManagedEnvironmentStatus,
  type ManagedEnvironmentSummary,
} from "@honk/shared/managed-remote-access";
import { describe, expect, it, vi } from "vitest";

import {
  createManagedEnvironmentDiscovery,
  type ManagedEnvironmentDiscovery,
  type ManagedEnvironmentDiscoveryState,
} from "./managed-environment-discovery";

const relayZone = "remote.honk.example";

function environment(id: string, label: string): ManagedEnvironmentSummary {
  const decoded = canonicalManagedEnvironmentSummary(
    {
      environmentId: id,
      label,
      endpoint: {
        providerKind: "cloudflare_tunnel",
        httpBaseUrl: `https://${id}.remote.honk.example/`,
        wsBaseUrl: `wss://${id}.remote.honk.example/`,
      },
      status: "unknown",
    },
    relayZone,
  );
  if (decoded === null) throw new Error("The test environment is invalid.");
  return decoded;
}

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (cause: unknown) => void;
} {
  let resolvePromise: (value: Value) => void = () => undefined;
  let rejectPromise: (cause: unknown) => void = () => undefined;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function waitForState<Account>(
  discovery: ManagedEnvironmentDiscovery<Account>,
  predicate: (state: ManagedEnvironmentDiscoveryState) => boolean,
): Promise<ManagedEnvironmentDiscoveryState> {
  const current = discovery.getState();
  if (predicate(current)) return Promise.resolve(current);
  return new Promise((resolve) => {
    const unsubscribe = discovery.subscribe(() => {
      const state = discovery.getState();
      if (!predicate(state)) return;
      unsubscribe();
      resolve(state);
    });
  });
}

const studio = environment("studio", "Studio");
const laptop = environment("laptop", "Laptop");

describe("managed environment discovery", () => {
  it("publishes listed rows as checking, then resolves them concurrently and progressively", async () => {
    const requests = new Map(
      [studio, laptop].map((candidate) => [
        candidate.environmentId,
        deferred<ManagedEnvironmentStatus>(),
      ]),
    );
    const statusCalls: ManagedEnvironmentId[] = [];
    const discovery = createManagedEnvironmentDiscovery<string>({
      list: () => Promise.resolve([studio, laptop]),
      resolveStatus: ({ environment: candidate }) => {
        statusCalls.push(candidate.environmentId);
        const request = requests.get(candidate.environmentId);
        if (request === undefined) throw new Error("Missing status request.");
        return request.promise;
      },
    });

    const refresh = discovery.setAccount("account-one");
    const checking = await waitForState(discovery, (state) => state.environments.size === 2);
    expect([...checking.environments.values()].map((row) => row.availability)).toEqual([
      "checking",
      "checking",
    ]);
    await Promise.resolve();
    expect(statusCalls).toEqual([studio.environmentId, laptop.environmentId]);

    requests.get(laptop.environmentId)?.resolve("online");
    const partial = await waitForState(
      discovery,
      (state) => state.environments.get(laptop.environmentId)?.availability === "online",
    );
    expect(partial.environments.get(studio.environmentId)?.availability).toBe("checking");
    expect(partial.refreshing).toBe(true);

    requests.get(studio.environmentId)?.resolve("offline");
    await refresh;
    expect(discovery.getState()).toMatchObject({ refreshing: false, offline: false, error: null });
    expect(discovery.getState().environments.get(studio.environmentId)?.availability).toBe(
      "offline",
    );
  });

  it("keeps a row when its status request fails", async () => {
    const cause = new Error("status endpoint unavailable");
    const discovery = createManagedEnvironmentDiscovery<string>({
      list: () => Promise.resolve([studio, laptop]),
      resolveStatus: ({ environment: candidate }) => {
        if (candidate.environmentId === studio.environmentId) throw cause;
        return Promise.resolve("online");
      },
    });

    await discovery.setAccount("account-one");

    expect(discovery.getState().environments).toHaveLength(2);
    expect(discovery.getState().environments.get(studio.environmentId)).toMatchObject({
      environment: studio,
      availability: "error",
      error: {
        message: "Honk could not check this linked computer.",
        cause,
      },
    });
    expect(discovery.getState().environments.get(laptop.environmentId)?.availability).toBe(
      "online",
    );
  });

  it("retains resolved rows while offline and refreshes when connectivity returns", async () => {
    const list = vi.fn(() => Promise.resolve([studio]));
    const resolveStatus = vi.fn(() => Promise.resolve<ManagedEnvironmentStatus>("online"));
    const discovery = createManagedEnvironmentDiscovery<string>({ list, resolveStatus });
    await discovery.setAccount("account-one");

    await discovery.setNetworkStatus("offline");
    expect(discovery.getState()).toMatchObject({
      refreshing: false,
      offline: true,
    });
    expect(discovery.getState().environments.get(studio.environmentId)?.availability).toBe(
      "online",
    );
    await discovery.refresh();
    expect(list).toHaveBeenCalledTimes(1);

    await discovery.setNetworkStatus("online");
    expect(list).toHaveBeenCalledTimes(2);
    expect(resolveStatus).toHaveBeenCalledTimes(2);
    expect(discovery.getState().environments.get(studio.environmentId)?.availability).toBe(
      "online",
    );
  });

  it("does not let an in-flight status result overwrite an offline transition", async () => {
    const request = deferred<ManagedEnvironmentStatus>();
    const discovery = createManagedEnvironmentDiscovery<string>({
      list: () => Promise.resolve([studio]),
      resolveStatus: () => request.promise,
    });
    const refresh = discovery.setAccount("account-one");
    await waitForState(
      discovery,
      (state) => state.environments.get(studio.environmentId)?.availability === "checking",
    );

    await discovery.setNetworkStatus("offline");
    request.resolve("online");
    await refresh;

    expect(discovery.getState().offline).toBe(true);
    expect(discovery.getState().environments.get(studio.environmentId)?.availability).toBe(
      "checking",
    );
  });

  it("clears on sign-out and suppresses a late status from the old account", async () => {
    const request = deferred<ManagedEnvironmentStatus>();
    const discovery = createManagedEnvironmentDiscovery<string>({
      list: () => Promise.resolve([studio]),
      resolveStatus: () => request.promise,
    });
    const oldRefresh = discovery.setAccount("account-one");
    await waitForState(
      discovery,
      (state) => state.environments.get(studio.environmentId)?.availability === "checking",
    );

    await discovery.setAccount(null);
    request.resolve("online");
    await oldRefresh;

    expect(discovery.getState()).toMatchObject({
      refreshing: false,
      offline: false,
      error: null,
    });
    expect(discovery.getState().environments.size).toBe(0);
  });

  it("suppresses a late listing after the account changes", async () => {
    const oldList = deferred<readonly ManagedEnvironmentSummary[]>();
    const discovery = createManagedEnvironmentDiscovery<string>({
      list: ({ account }) =>
        account === "account-one" ? oldList.promise : Promise.resolve([laptop]),
      resolveStatus: () => Promise.resolve("online"),
    });

    const oldRefresh = discovery.setAccount("account-one");
    await discovery.setAccount("account-two");
    expect([...discovery.getState().environments.keys()]).toEqual([laptop.environmentId]);

    oldList.resolve([studio]);
    await oldRefresh;
    expect([...discovery.getState().environments.keys()]).toEqual([laptop.environmentId]);
  });

  it("keeps the last resolved rows when a later listing fails", async () => {
    const cause = new Error("relay timed out");
    const list = vi
      .fn<() => Promise<readonly ManagedEnvironmentSummary[]>>()
      .mockResolvedValueOnce([studio])
      .mockRejectedValueOnce(cause);
    const discovery = createManagedEnvironmentDiscovery<string>({
      list,
      resolveStatus: () => Promise.resolve("online"),
    });
    await discovery.setAccount("account-one");

    await discovery.refresh();

    expect(discovery.getState().environments.get(studio.environmentId)?.availability).toBe(
      "online",
    );
    expect(discovery.getState()).toMatchObject({
      refreshing: false,
      error: {
        message: "Honk could not refresh your linked computers.",
        cause,
      },
    });
  });

  it("refreshes an established account on demand", async () => {
    const resolveStatus = vi
      .fn<() => Promise<ManagedEnvironmentStatus>>()
      .mockResolvedValueOnce("online")
      .mockResolvedValueOnce("offline");
    const discovery = createManagedEnvironmentDiscovery<string>({
      list: () => Promise.resolve([studio]),
      resolveStatus,
    });
    await discovery.setAccount("account-one");

    await discovery.refresh();

    expect(resolveStatus).toHaveBeenCalledTimes(2);
    expect(discovery.getState().environments.get(studio.environmentId)?.availability).toBe(
      "offline",
    );
  });
});
