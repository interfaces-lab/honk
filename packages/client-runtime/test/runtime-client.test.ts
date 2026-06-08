import {
  TurnId,
  type LocalApi,
  type MultiRuntimeApi,
  type MultiRuntimeHostSnapshot,
} from "@multi/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  configureRuntimeClientBootstrap,
  createEmptyRuntimeHostSnapshot,
  isDesktopRuntimeApiAvailable,
  readLocalApi,
  readMultiRuntimeApi,
  registerRuntimeApiResolver,
  resetLocalApiForTests,
  resetRuntimeApiResolverForTests,
  resetRuntimeClientBootstrapForTests,
} from "../src/index";

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

function createTestLocalApi(runtime: MultiRuntimeApi): LocalApi {
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
  beforeEach(() => {
    resetLocalApiForTests();
    resetRuntimeApiResolverForTests();
    resetRuntimeClientBootstrapForTests();
    vi.unstubAllGlobals();

    registerRuntimeApiResolver(() => {
      if (typeof window === "undefined") {
        return undefined;
      }
      const localApi = readLocalApi();
      if (localApi?.runtime) {
        return localApi.runtime;
      }
      if (window.nativeApi?.runtime) {
        return window.nativeApi.runtime;
      }
      return window.desktopBridge?.runtime ?? window.multiRuntime;
    });
    configureRuntimeClientBootstrap({ readLocalApi });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetLocalApiForTests();
    resetRuntimeApiResolverForTests();
    resetRuntimeClientBootstrapForTests();
  });

  it("uses the runtime exposed through localApi", async () => {
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    vi.stubGlobal("window", {
      nativeApi: createTestLocalApi(createRuntimeApi(snapshot)),
    });

    await expect(readMultiRuntimeApi().getHostSnapshot()).resolves.toBe(snapshot);
    expect(isDesktopRuntimeApiAvailable()).toBe(true);
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
  });

  it("rejects when no runtime bridge is available", () => {
    vi.stubGlobal("window", {});

    expect(isDesktopRuntimeApiAvailable()).toBe(false);
    expect(() => readMultiRuntimeApi()).toThrow("Runtime host unavailable.");
  });
});
