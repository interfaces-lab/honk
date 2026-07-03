import { EnvironmentId } from "@honk/shared/environment";
import type { GitStatusResult } from "@honk/shared/git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshGitStatus, resetGitStatusStateForTests } from "./git-status-state";

const environmentId = EnvironmentId.make("environment:git-status-state");
const target = { environmentId, cwd: "/repo" };

function createStatus(branch: string): GitStatusResult {
  return {
    isRepo: true,
    hasOriginRemote: false,
    isDefaultBranch: false,
    branch,
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: false,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
  };
}

describe("refreshGitStatus", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      setTimeout: vi.fn(() => 0),
    });
  });

  afterEach(() => {
    resetGitStatusStateForTests();
    vi.unstubAllGlobals();
  });

  it("forwards a local refresh scope to the Git API", async () => {
    const refreshStatus = vi.fn(async () => createStatus("main"));

    await refreshGitStatus(target, { refreshStatus }, { force: true, scope: "local" });

    expect(refreshStatus).toHaveBeenCalledWith({ cwd: "/repo", scope: "local" });
  });

  it("preserves local scope for a queued forced refresh", async () => {
    let resolveFirstRefresh: (status: GitStatusResult) => void = () => undefined;
    const firstRefresh = new Promise<GitStatusResult>((resolve) => {
      resolveFirstRefresh = resolve;
    });
    const refreshStatus = vi
      .fn<() => Promise<GitStatusResult>>()
      .mockReturnValueOnce(firstRefresh)
      .mockResolvedValueOnce(createStatus("feature"));

    const firstResult = refreshGitStatus(target, { refreshStatus }, { force: true });
    const queuedResult = refreshGitStatus(
      target,
      { refreshStatus },
      { force: true, scope: "local" },
    );

    expect(refreshStatus).toHaveBeenCalledTimes(1);

    resolveFirstRefresh(createStatus("main"));
    await firstResult;
    await queuedResult;

    expect(refreshStatus).toHaveBeenNthCalledWith(2, { cwd: "/repo", scope: "local" });
  });
});
