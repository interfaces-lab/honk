import { describe, expect, it, vi } from "vitest";

import {
  createManagedAccountSessionStore,
  ManagedAccountSessionInvalidError,
} from "./managed-account-session";

describe("managed account session", () => {
  it("starts inactive and exposes an activated opaque account", async () => {
    const readAccessToken = vi.fn(() => Promise.resolve<string | null>("access-token"));
    const store = createManagedAccountSessionStore();

    expect(store.getSnapshot()).toBeNull();
    store.activate({ accountId: "acct:/opaque value", readAccessToken });

    const session = store.getSnapshot();
    expect(session?.accountId).toBe("acct:/opaque value");
    expect(readAccessToken).not.toHaveBeenCalled();
    await expect(session?.readAccessToken()).resolves.toBe("access-token");
    expect(readAccessToken).toHaveBeenCalledOnce();
  });

  it("updates and publishes a changed token reader for the same account", async () => {
    const firstReader = () => Promise.resolve<string | null>("first");
    const secondReader = () => Promise.resolve<string | null>("second");
    const listener = vi.fn();
    const store = createManagedAccountSessionStore();
    store.subscribe(listener);
    store.activate({ accountId: "account-one", readAccessToken: firstReader });
    const firstSnapshot = store.getSnapshot();

    store.activate({ accountId: "account-one", readAccessToken: secondReader });

    const secondSnapshot = store.getSnapshot();
    expect(secondSnapshot).not.toBe(firstSnapshot);
    expect(listener).toHaveBeenCalledTimes(2);
    await expect(firstSnapshot?.readAccessToken()).resolves.toBe("second");
    await expect(secondSnapshot?.readAccessToken()).resolves.toBe("second");
  });

  it("keeps an exact repeated activation quiet", () => {
    const readAccessToken = () => Promise.resolve<string | null>("access-token");
    const listener = vi.fn();
    const store = createManagedAccountSessionStore();
    store.subscribe(listener);
    store.activate({ accountId: "account-one", readAccessToken });
    const snapshot = store.getSnapshot();

    store.activate({ accountId: "account-one", readAccessToken });

    expect(store.getSnapshot()).toBe(snapshot);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("publishes account replacement and leaves an old account session isolated", async () => {
    const listener = vi.fn();
    const store = createManagedAccountSessionStore();
    store.subscribe(listener);
    store.activate({
      accountId: "account-one",
      readAccessToken: () => Promise.resolve("account-one-token"),
    });
    const firstSession = store.getSnapshot();

    store.activate({
      accountId: "account-two",
      readAccessToken: () => Promise.resolve("account-two-token"),
    });

    expect(store.getSnapshot()?.accountId).toBe("account-two");
    await expect(firstSession?.readAccessToken()).resolves.toBe("account-one-token");
    await expect(store.getSnapshot()?.readAccessToken()).resolves.toBe("account-two-token");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("publishes deactivation once and supports unsubscription", () => {
    const listener = vi.fn();
    const store = createManagedAccountSessionStore();
    const unsubscribe = store.subscribe(listener);
    store.activate({
      accountId: "account-one",
      readAccessToken: () => Promise.resolve(null),
    });
    store.deactivate();
    store.deactivate();
    unsubscribe();
    store.activate({
      accountId: "account-two",
      readAccessToken: () => Promise.resolve(null),
    });

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("forwards token-reader failures without retaining token material", async () => {
    const cause = new Error("provider unavailable");
    const store = createManagedAccountSessionStore();
    store.activate({
      accountId: "account-one",
      readAccessToken: () => Promise.reject(cause),
    });

    await expect(store.getSnapshot()?.readAccessToken()).rejects.toBe(cause);
    expect(store.getSnapshot()).toEqual({
      accountId: "account-one",
      readAccessToken: expect.any(Function),
    });
  });

  it.each(["", " ", "\taccount-one", "account-one\n"])(
    "rejects non-canonical account ID %j without changing the active account",
    (accountId) => {
      const listener = vi.fn();
      const store = createManagedAccountSessionStore();
      store.subscribe(listener);
      store.activate({
        accountId: "account-one",
        readAccessToken: () => Promise.resolve("access-token"),
      });
      const snapshot = store.getSnapshot();

      expect(() =>
        store.activate({
          accountId,
          readAccessToken: () => Promise.resolve("other-token"),
        }),
      ).toThrow(ManagedAccountSessionInvalidError);
      expect(store.getSnapshot()).toBe(snapshot);
      expect(listener).toHaveBeenCalledOnce();
    },
  );
});
