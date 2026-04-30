import { EnvironmentId } from "@multi/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/ws-rpc-client", () => ({
  getWsRpcClientForEnvironment: vi.fn(),
}));

vi.mock("./native-runtime-api", () => ({
  readNativeEnvironmentApi: vi.fn(),
  readNativeRuntimeApi: vi.fn(),
}));

import { getWsRpcClientForEnvironment } from "~/ws-rpc-client";
import { readNativeEnvironmentApi, readNativeRuntimeApi } from "./native-runtime-api";
import { readNativeGitApi } from "./native-git-api";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");

function makeGitClient() {
  return {
    refreshStatus: vi.fn(),
    onStatus: vi.fn(),
    init: vi.fn(),
    discardPaths: vi.fn(),
    getFilePatch: vi.fn(),
    runStackedAction: vi.fn(),
    listBranches: vi.fn(),
    checkout: vi.fn(),
    pull: vi.fn(),
    preparePullRequestThread: vi.fn(),
  };
}

describe("readNativeGitApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readNativeRuntimeApi).mockReturnValue(undefined);
    vi.mocked(readNativeEnvironmentApi).mockReturnValue(undefined);
  });

  it("returns null for an explicit missing environment instead of using another client", () => {
    vi.mocked(getWsRpcClientForEnvironment).mockImplementation((environmentId) => {
      throw new Error(`Environment API not found for environment ${environmentId}`);
    });

    expect(readNativeGitApi(ENVIRONMENT_ID)).toBeNull();
    expect(getWsRpcClientForEnvironment).toHaveBeenCalledWith(ENVIRONMENT_ID);
  });

  it("uses the selected environment websocket git client for patch and discard operations", async () => {
    const git = makeGitClient();
    git.getFilePatch.mockResolvedValue({ unifiedDiff: "diff --git a/a b/a\n" });
    git.discardPaths.mockResolvedValue(undefined);
    vi.mocked(getWsRpcClientForEnvironment).mockReturnValue({ git } as never);

    const api = readNativeGitApi(ENVIRONMENT_ID);

    await expect(api?.getFilePatch({ cwd: "/repo", path: "a" })).resolves.toEqual({
      unifiedDiff: "diff --git a/a b/a\n",
    });
    await expect(api?.discardPaths({ cwd: "/repo", paths: ["a"] })).resolves.toBeUndefined();
    expect(git.getFilePatch).toHaveBeenCalledWith({ cwd: "/repo", path: "a" });
    expect(git.discardPaths).toHaveBeenCalledWith({ cwd: "/repo", paths: ["a"] });
  });
});
