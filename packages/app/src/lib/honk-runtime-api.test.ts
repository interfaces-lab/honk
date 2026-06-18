import {
  TurnId,
  type LocalApi,
  type HonkRuntimeApi,
  type HonkRuntimeHostSnapshot,
} from "@honk/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetLocalApiForTests } from "../local-api";
import {
  assertRuntimeHostAvailable,
  createEmptyRuntimeHostSnapshot,
  isDesktopRuntimeApiAvailable,
  readHonkRuntimeApi,
} from "./honk-runtime-api";

async function notCalled(): Promise<never> {
  throw new Error("Unexpected local API call.");
}

function createRuntimeApi(snapshot: HonkRuntimeHostSnapshot): HonkRuntimeApi {
  return {
    getHostSnapshot: async () => snapshot,
    getPreferences: async () => snapshot.preferences,
    updatePreferences: async () => snapshot.preferences,
    configureCredential: async () => snapshot,
    hydrateThread: async () => undefined,
    cloneThread: async () => undefined,
    setThreadFocus: async () => undefined,
    sendTurn: async (input) => TurnId.make(`test:${input.threadId}`),
    enqueueFollowUp: async () => undefined,
    updateQueuedFollowUp: async () => undefined,
    removeQueuedFollowUp: async () => undefined,
    reorderQueuedFollowUp: async () => undefined,
    sendQueuedFollowUpNow: async () => undefined,
    compactThread: async () => undefined,
    abort: async () => undefined,
    respondToExtensionUiRequest: async () => undefined,
    listSkills: async () => ({ skills: [] }),
    getThreadSessionFile: async () => ({ path: null }),
    onHostEvent: () => () => undefined,
  };
}

function createLocalApi(runtime: HonkRuntimeApi): LocalApi {
  return {
    runtime,
    dialogs: {
      pickFolder: async () => null,
      confirm: async () => false,
    },
    shell: {
      openInEditor: async () => notCalled(),
      openExternal: async () => undefined,
      showItemInFolder: async () => undefined,
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

describe("readHonkRuntimeApi", () => {
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

    await expect(readHonkRuntimeApi().getHostSnapshot()).resolves.toEqual(snapshot);
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

    await expect(readHonkRuntimeApi().getHostSnapshot()).resolves.toEqual(snapshot);
    expect(isDesktopRuntimeApiAvailable()).toBe(true);
    await expect(assertRuntimeHostAvailable()).resolves.toBeUndefined();
  });

  it("returns canonical runtime snapshots from bridge data", async () => {
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      models: undefined,
      preferences: {
        ...createEmptyRuntimeHostSnapshot().preferences,
        modelSettingsByModelId: undefined,
      },
    } as unknown as HonkRuntimeHostSnapshot;
    vi.stubGlobal("window", {
      desktopBridge: {
        runtime: createRuntimeApi(snapshot),
      },
    });

    const canonicalSnapshot = await readHonkRuntimeApi().getHostSnapshot();

    expect(canonicalSnapshot.models).toEqual([]);
    expect(canonicalSnapshot.preferences.modelSettingsByModelId).toEqual({});
  });

  it("rejects when no runtime bridge is available", async () => {
    vi.stubGlobal("window", {});

    expect(isDesktopRuntimeApiAvailable()).toBe(false);
    expect(() => readHonkRuntimeApi()).toThrow("Runtime host unavailable.");
    await expect(assertRuntimeHostAvailable()).rejects.toThrow("Runtime host unavailable.");
  });
});
