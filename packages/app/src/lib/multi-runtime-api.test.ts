import {
  TurnId,
  type LocalApi,
  type MultiRuntimeApi,
  type MultiRuntimeHostSnapshot,
} from "@multi/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetLocalApiForTests } from "../local-api";
import {
  assertRuntimeHostAvailable,
  createEmptyRuntimeHostSnapshot,
  isDesktopRuntimeApiAvailable,
  readMultiRuntimeApi,
} from "./multi-runtime-api";

async function notCalled(): Promise<never> {
  throw new Error("Unexpected local API call.");
}

function createRuntimeApi(snapshot: MultiRuntimeHostSnapshot): MultiRuntimeApi {
  return {
    getHostSnapshot: async () => snapshot,
    getPreferences: async () => snapshot.preferences,
    updatePreferences: async () => snapshot.preferences,
    configureCredential: async () => snapshot,
    hydrateThread: async () => undefined,
    sendTurn: async (input) => TurnId.make(`test:${input.threadId}`),
    abort: async () => undefined,
    respondToExtensionUiRequest: async () => undefined,
    onHostEvent: () => () => undefined,
  };
}

function createLocalApi(runtime: MultiRuntimeApi): LocalApi {
  return {
    runtime,
    dialogs: {
      pickFolder: async () => null,
      confirm: async () => false,
    },
    shell: {
      openInEditor: async () => notCalled(),
      openExternal: async () => undefined,
    },
    contextMenu: {
      show: async () => null,
    },
    persistence: {
      getClientSettings: async () => null,
      setClientSettings: async () => undefined,
    },
    server: {
      getConfig: async () => notCalled(),
      upsertKeybinding: async () => notCalled(),
      getSettings: async () => notCalled(),
      updateSettings: async () => notCalled(),
    },
  };
}

describe("readMultiRuntimeApi", () => {
  beforeEach(async () => {
    await __resetLocalApiForTests();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await __resetLocalApiForTests();
  });

  it("uses the runtime exposed through localApi", async () => {
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(createRuntimeApi(snapshot)),
    });

    await expect(readMultiRuntimeApi().getHostSnapshot()).resolves.toBe(snapshot);
    expect(isDesktopRuntimeApiAvailable()).toBe(true);
    await expect(assertRuntimeHostAvailable()).resolves.toBeUndefined();
  });

  it("uses the runtime attached to desktopBridge through localApi", async () => {
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    vi.stubGlobal("window", {
      desktopBridge: {
        runtime: createRuntimeApi(snapshot),
      },
    });

    await expect(readMultiRuntimeApi().getHostSnapshot()).resolves.toBe(snapshot);
    expect(isDesktopRuntimeApiAvailable()).toBe(true);
    await expect(assertRuntimeHostAvailable()).resolves.toBeUndefined();
  });

  it("rejects when no runtime bridge is available", async () => {
    vi.stubGlobal("window", {});

    expect(isDesktopRuntimeApiAvailable()).toBe(false);
    expect(() => readMultiRuntimeApi()).toThrow("Runtime host unavailable.");
    await expect(assertRuntimeHostAvailable()).rejects.toThrow("Runtime host unavailable.");
  });
});
