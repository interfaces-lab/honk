import type { EnvironmentApi, LocalApi } from "@multi/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../local-api", () => ({
  readLocalApi: vi.fn(),
}));

vi.mock("../environment-api", () => ({
  createEnvironmentApi: vi.fn(),
  readEnvironmentApi: vi.fn(),
}));

vi.mock("../ws-rpc-client", () => ({
  getWsRpcClientForEnvironment: vi.fn(),
}));

import { createEnvironmentApi, readEnvironmentApi } from "../environment-api";
import { readLocalApi } from "../local-api";
import { getWsRpcClientForEnvironment } from "../ws-rpc-client";

import {
  ensureNativeEnvironmentApi,
  readNativeEnvironmentApi,
  readNativeRuntimeApi,
} from "./native-runtime-api";

const localApi = {
  dialogs: { pickFolder: vi.fn(), confirm: vi.fn() },
  shell: { openInEditor: vi.fn(), openExternal: vi.fn() },
  contextMenu: { show: vi.fn() },
  persistence: {
    getClientSettings: vi.fn(),
    setClientSettings: vi.fn(),
    getSavedEnvironmentRegistry: vi.fn(),
    setSavedEnvironmentRegistry: vi.fn(),
    getSavedEnvironmentSecret: vi.fn(),
    setSavedEnvironmentSecret: vi.fn(),
    removeSavedEnvironmentSecret: vi.fn(),
  },
  server: {
    getConfig: vi.fn(),
    refreshProviders: vi.fn(),
    upsertKeybinding: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  },
} as unknown as LocalApi;

const environmentApi = {
  terminal: {} as EnvironmentApi["terminal"],
  projects: {} as EnvironmentApi["projects"],
  filesystem: {} as EnvironmentApi["filesystem"],
  git: {} as EnvironmentApi["git"],
  orchestration: {} as EnvironmentApi["orchestration"],
} as EnvironmentApi;

describe("native-runtime-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns local api when environment api is unavailable", () => {
    vi.mocked(readLocalApi).mockReturnValue(localApi);
    vi.mocked(readEnvironmentApi).mockReturnValue(undefined);

    const result = readNativeRuntimeApi("env-a" as never);
    expect(result).toBe(localApi);
  });

  it("merges local and environment capabilities when both are available", () => {
    vi.mocked(readLocalApi).mockReturnValue(localApi);
    vi.mocked(readEnvironmentApi).mockReturnValue(environmentApi);

    const result = readNativeRuntimeApi("env-a" as never);
    expect(result).toMatchObject({
      dialogs: localApi.dialogs,
      server: localApi.server,
      git: environmentApi.git,
      terminal: environmentApi.terminal,
      projects: environmentApi.projects,
      orchestration: environmentApi.orchestration,
    });
  });

  it("can fallback to primary environment when no environment id is provided", () => {
    vi.mocked(readLocalApi).mockReturnValue(localApi);
    vi.mocked(readEnvironmentApi).mockReturnValue(undefined);
    vi.mocked(getWsRpcClientForEnvironment).mockReturnValue({} as never);
    vi.mocked(createEnvironmentApi).mockReturnValue(environmentApi);

    const result = readNativeRuntimeApi(null, { allowPrimaryEnvironmentFallback: true });
    expect(getWsRpcClientForEnvironment).toHaveBeenCalledWith(null);
    expect(createEnvironmentApi).toHaveBeenCalledTimes(1);
    expect(result?.git).toBe(environmentApi.git);
  });

  it("throws when ensureNativeEnvironmentApi cannot resolve an environment api", () => {
    vi.mocked(readEnvironmentApi).mockReturnValue(undefined);
    expect(() => ensureNativeEnvironmentApi("env-a" as never)).toThrow(
      "Environment API not found for environment env-a",
    );
  });

  it("returns fallback environment api when enabled", () => {
    vi.mocked(readEnvironmentApi).mockReturnValue(undefined);
    vi.mocked(getWsRpcClientForEnvironment).mockReturnValue({} as never);
    vi.mocked(createEnvironmentApi).mockReturnValue(environmentApi);

    const result = readNativeEnvironmentApi(undefined, { allowPrimaryEnvironmentFallback: true });
    expect(result).toBe(environmentApi);
  });
});
