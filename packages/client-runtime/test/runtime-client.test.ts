import {
  AuthProviderId,
  ThreadId,
  TurnId,
  type LocalApi,
  type HonkRuntimeApi,
  type HonkRuntimeHostSnapshot,
} from "@honk/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertRuntimeHostAvailable,
  configureRuntimeClientBootstrap,
  createEmptyRuntimeHostSnapshot,
  isDesktopRuntimeApiAvailable,
  readLocalApi,
  readHonkRuntimeApi,
  registerRuntimeApiResolver,
  resetLocalApiForTests,
  resetRuntimeApiResolverForTests,
  resetRuntimeClientBootstrapForTests,
} from "../src/index";

async function notCalled(): Promise<never> {
  throw new Error("Unexpected local API call.");
}

function createRuntimeApi(
  snapshot: HonkRuntimeHostSnapshot,
  overrides: Partial<HonkRuntimeApi> = {},
): HonkRuntimeApi {
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
    ...overrides,
  };
}

function createTestLocalApi(runtime: HonkRuntimeApi): LocalApi {
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
      return window.desktopBridge?.runtime ?? window.honkRuntime;
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

    await expect(readHonkRuntimeApi().getHostSnapshot()).resolves.toStrictEqual(snapshot);
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

    await expect(readHonkRuntimeApi().getHostSnapshot()).resolves.toStrictEqual(snapshot);
    expect(isDesktopRuntimeApiAvailable()).toBe(true);
  });

  it("asserts runtime host availability without fetching a full snapshot", async () => {
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    const getHostSnapshot = vi.fn(async () => snapshot);
    vi.stubGlobal("window", {
      desktopBridge: {
        runtime: createRuntimeApi(snapshot, { getHostSnapshot }),
      },
    });

    await expect(assertRuntimeHostAvailable()).resolves.toBeUndefined();

    expect(getHostSnapshot).not.toHaveBeenCalled();
  });

  it("forwards thread focus updates through the runtime client", async () => {
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    const setThreadFocus = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      desktopBridge: {
        runtime: createRuntimeApi(snapshot, { setThreadFocus }),
      },
    });

    await readHonkRuntimeApi().setThreadFocus({
      threadId: ThreadId.make("thread:client-focus"),
      focused: true,
    });

    expect(setThreadFocus).toHaveBeenCalledWith({
      threadId: ThreadId.make("thread:client-focus"),
      focused: true,
    });
  });

  it("decodes Codex credential snapshots", async () => {
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    vi.stubGlobal("window", {
      desktopBridge: {
        runtime: createRuntimeApi(snapshot),
      },
    });

    await expect(
      readHonkRuntimeApi().configureCredential({
        authProviderId: AuthProviderId.make("openai-codex"),
        method: "oauth",
        credentialKind: "codex-oauth",
      }),
    ).resolves.toMatchObject({
      preferences: {
        credentials: expect.arrayContaining([
          expect.objectContaining({
            kind: "codex-oauth",
            authProviderId: "openai-codex",
          }),
        ]),
      },
    });
  });

  it("rejects when no runtime bridge is available", () => {
    vi.stubGlobal("window", {});

    expect(isDesktopRuntimeApiAvailable()).toBe(false);
    expect(() => readHonkRuntimeApi()).toThrow("Runtime host unavailable.");
  });

  it("degrades listSkills and getThreadSessionFile when the bridge lacks them", async () => {
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    const legacyRuntime: Partial<HonkRuntimeApi> = createRuntimeApi(snapshot);
    delete legacyRuntime.listSkills;
    delete legacyRuntime.getThreadSessionFile;
    vi.stubGlobal("window", {
      desktopBridge: {
        runtime: legacyRuntime,
      },
    });

    await expect(readHonkRuntimeApi().listSkills({ cwd: "/tmp/project" })).resolves.toEqual({
      skills: [],
    });
    await expect(
      readHonkRuntimeApi().getThreadSessionFile({ threadId: ThreadId.make("thread:legacy") }),
    ).resolves.toEqual({ path: null });
  });
});
