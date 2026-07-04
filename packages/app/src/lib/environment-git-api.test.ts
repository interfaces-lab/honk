import type { GitStatusResult } from "@honk/shared/git";
import { EnvironmentId } from "@honk/shared/environment";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EnvironmentApi } from "~/desktop-bridge";
import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "~/environment-api";
import { readEnvironmentGitApi } from "./environment-git-api";

const environmentId = EnvironmentId.make("environment:test");

function unusedGitMethod(): never {
  throw new Error("Unexpected Git API call in resolver test.");
}

describe("readEnvironmentGitApi", () => {
  afterEach(() => {
    __resetEnvironmentApiOverridesForTests();
    vi.unstubAllGlobals();
  });

  it("returns null when no environment API exists", () => {
    expect(readEnvironmentGitApi(environmentId)).toBeNull();
  });

  it("resolves Git from the selected environment API", async () => {
    vi.stubGlobal("window", {});
    const status: GitStatusResult = {
      isRepo: true,
      hasOriginRemote: false,
      isDefaultBranch: false,
      branch: "main",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };
    const refreshStatus = vi.fn(async () => status);
    const git: EnvironmentApi["git"] = {
      listBranches: async () => unusedGitMethod(),
      createWorktree: async () => unusedGitMethod(),
      removeWorktree: async () => unusedGitMethod(),
      createBranch: async () => unusedGitMethod(),
      checkout: async () => unusedGitMethod(),
      init: async () => unusedGitMethod(),
      resolvePullRequest: async () => unusedGitMethod(),
      preparePullRequestThread: async () => unusedGitMethod(),
      pull: async () => unusedGitMethod(),
      discardPaths: async () => unusedGitMethod(),
      getFilePatch: async () => unusedGitMethod(),
      getFileImage: async () => unusedGitMethod(),
      refreshStatus,
      onStatus: () => () => undefined,
    };

    __setEnvironmentApiOverrideForTests(environmentId, { git } as EnvironmentApi);

    await expect(
      readEnvironmentGitApi(environmentId)?.refreshStatus({ cwd: "/repo" }),
    ).resolves.toMatchObject({
      isRepo: true,
      branch: "main",
    });
    expect(refreshStatus).toHaveBeenCalledWith({ cwd: "/repo" });
  });
});
