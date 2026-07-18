import { describe, expect, it, vi } from "vitest";

import { createHonkDesktopExtensionHost } from "../sdk";
import { keepAwakeExtension } from "./extension";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function createHost(
  setKeepAwake: (enabled: boolean) => Promise<boolean>,
  storage = createStorage(),
) {
  return createHonkDesktopExtensionHost({
    storage,
    tabs: {
      getSnapshot: () => ({ tabs: [], activeKey: "home" }),
      subscribe: () => () => {},
      activate: () => {},
      close: () => {},
      create: () => {},
      openDraft: () => {},
    },
    opencode: { client: () => null },
    power: { setKeepAwake },
  });
}

describe("keepAwakeExtension", () => {
  it("shares one global persisted cell across every contribution", async () => {
    const setKeepAwake = vi.fn(async (enabled: boolean) => enabled);
    const storage = createStorage();
    const host = createHost(setKeepAwake, storage);

    host.register(keepAwakeExtension);

    const setting = host.getSettingsSnapshot().at(0);
    const newSession = host.getNewSessionSnapshot().at(0);
    const titlebar = host.getTitlebarTogglesSnapshot().at(0);
    expect(setting).toBeDefined();
    expect(newSession).toBeDefined();
    expect(titlebar).toBeDefined();
    if (setting === undefined || newSession === undefined || titlebar === undefined) {
      throw new Error("Keep Awake contributions were not registered.");
    }

    expect(newSession.value).toBe(setting.value);
    expect(titlebar.value).toBe(setting.value);

    titlebar.value.set(true);

    await vi.waitFor(() => {
      expect(setKeepAwake).toHaveBeenCalledWith(true);
    });
    expect(setting.value.get()).toBe(true);
    expect(newSession.value.get()).toBe(true);
    expect(storage.getItem("honk.desktop.extension.keep-awake.enabled")).toBe("true");

    host.dispose();

    const restoredHost = createHost(setKeepAwake, storage);
    restoredHost.register(keepAwakeExtension);
    expect(restoredHost.getSettingsSnapshot().at(0)?.value.get()).toBe(true);
    restoredHost.dispose();
  });

  it("restores the global cell when Electron rejects the requested state", async () => {
    const setKeepAwake = vi.fn(async () => false);
    const host = createHost(setKeepAwake);

    host.register(keepAwakeExtension);
    const setting = host.getSettingsSnapshot().at(0);
    expect(setting).toBeDefined();
    if (setting === undefined) {
      throw new Error("Keep Awake settings contribution was not registered.");
    }

    setting.value.set(true);

    await vi.waitFor(() => {
      expect(setKeepAwake).toHaveBeenCalledWith(true);
      expect(setting.value.get()).toBe(false);
    });

    host.dispose();
  });
});
