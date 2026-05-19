import type { GitBranch, GitStatusRemoteResult, GitStatusResult } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import {
  applyGitStatusStreamEvent,
  buildTemporaryWorktreeBranchName,
  dedupeRemoteBranchesWithLocalMatches,
  deriveLocalBranchNameFromRemoteRef,
  isTemporaryWorktreeBranch,
  normalizeGitRemoteUrl,
  parseGitHubRepositoryNameWithOwnerFromRemoteUrl,
  WORKTREE_BRANCH_PREFIX,
} from "../../src/git";

describe("normalizeGitRemoteUrl", () => {
  it("canonicalizes equivalent GitHub remotes across protocol variants", () => {
    expect(normalizeGitRemoteUrl("git@github.com:interfaces-co/Multi.git")).toBe(
      "github.com/interfaces-co/multi",
    );
    expect(normalizeGitRemoteUrl("https://github.com/interfaces-co/Multi.git")).toBe(
      "github.com/interfaces-co/multi",
    );
    expect(normalizeGitRemoteUrl("ssh://git@github.com/interfaces-co/Multi")).toBe(
      "github.com/interfaces-co/multi",
    );
  });

  it("preserves nested group paths for providers like GitLab", () => {
    expect(normalizeGitRemoteUrl("git@gitlab.com:interfaces-co/platform/Multi.git")).toBe(
      "gitlab.com/interfaces-co/platform/multi",
    );
    expect(normalizeGitRemoteUrl("https://gitlab.com/interfaces-co/platform/Multi.git")).toBe(
      "gitlab.com/interfaces-co/platform/multi",
    );
  });

  it("drops explicit ports from URL-shaped remotes", () => {
    expect(normalizeGitRemoteUrl("https://gitlab.company.com:8443/team/project.git")).toBe(
      "gitlab.company.com/team/project",
    );
    expect(normalizeGitRemoteUrl("ssh://git@gitlab.company.com:2222/team/project.git")).toBe(
      "gitlab.company.com/team/project",
    );
  });
});

describe("parseGitHubRepositoryNameWithOwnerFromRemoteUrl", () => {
  it("extracts the owner and repository from common GitHub remote shapes", () => {
    expect(
      parseGitHubRepositoryNameWithOwnerFromRemoteUrl("git@github.com:interfaces-co/Multi.git"),
    ).toBe("interfaces-co/Multi");
    expect(
      parseGitHubRepositoryNameWithOwnerFromRemoteUrl("https://github.com/interfaces-co/Multi.git"),
    ).toBe("interfaces-co/Multi");
  });
});

describe("isTemporaryWorktreeBranch", () => {
  it("matches the generated temporary worktree branch format", () => {
    expect(isTemporaryWorktreeBranch(buildTemporaryWorktreeBranchName())).toBe(true);
  });

  it("matches generated temporary worktree branches", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/deadbeef`)).toBe(true);
    expect(isTemporaryWorktreeBranch(` ${WORKTREE_BRANCH_PREFIX}/deadbeef `)).toBe(true);
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/DEADBEEF`)).toBe(true);
  });

  it("rejects non-temporary branch names", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/feature/demo`)).toBe(false);
    expect(isTemporaryWorktreeBranch("main")).toBe(false);
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/deadbeef-extra`)).toBe(false);
  });
});

describe("deriveLocalBranchNameFromRemoteRef", () => {
  it("strips the remote prefix from a remote ref", () => {
    expect(deriveLocalBranchNameFromRemoteRef("origin/feature/demo")).toBe("feature/demo");
  });

  it("supports remote names that contain slashes", () => {
    expect(deriveLocalBranchNameFromRemoteRef("my-org/upstream/feature/demo")).toBe(
      "upstream/feature/demo",
    );
  });

  it("returns the original name when ref is malformed", () => {
    expect(deriveLocalBranchNameFromRemoteRef("origin/")).toBe("origin/");
    expect(deriveLocalBranchNameFromRemoteRef("/feature/demo")).toBe("/feature/demo");
  });
});

describe("dedupeRemoteBranchesWithLocalMatches", () => {
  it("hides remote refs when the matching local branch exists", () => {
    const input: GitBranch[] = [
      {
        name: "feature/demo",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "origin/feature/demo",
        isRemote: true,
        remoteName: "origin",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "origin/feature/remote-only",
        isRemote: true,
        remoteName: "origin",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];

    expect(dedupeRemoteBranchesWithLocalMatches(input).map((branch) => branch.name)).toEqual([
      "feature/demo",
      "origin/feature/remote-only",
    ]);
  });

  it("keeps all entries when no local match exists for a remote ref", () => {
    const input: GitBranch[] = [
      {
        name: "feature/local",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "origin/feature/remote-only",
        isRemote: true,
        remoteName: "origin",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];

    expect(dedupeRemoteBranchesWithLocalMatches(input).map((branch) => branch.name)).toEqual([
      "feature/local",
      "origin/feature/remote-only",
    ]);
  });

  it("keeps non-origin remote refs visible even when a matching local branch exists", () => {
    const input: GitBranch[] = [
      {
        name: "feature/demo",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "my-org/upstream/feature/demo",
        isRemote: true,
        remoteName: "my-org/upstream",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];

    expect(dedupeRemoteBranchesWithLocalMatches(input).map((branch) => branch.name)).toEqual([
      "feature/demo",
      "my-org/upstream/feature/demo",
    ]);
  });

  it("keeps non-origin remote refs visible when git tracks with first-slash local naming", () => {
    const input: GitBranch[] = [
      {
        name: "upstream/feature",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "my-org/upstream/feature",
        isRemote: true,
        remoteName: "my-org/upstream",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];

    expect(dedupeRemoteBranchesWithLocalMatches(input).map((branch) => branch.name)).toEqual([
      "upstream/feature",
      "my-org/upstream/feature",
    ]);
  });
});

describe("applyGitStatusStreamEvent", () => {
  it("treats a remote-only update as a repository when local state is missing", () => {
    const remote: GitStatusRemoteResult = {
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    };

    expect(applyGitStatusStreamEvent(null, { _tag: "remoteUpdated", remote })).toEqual({
      isRepo: true,
      hasOriginRemote: false,
      isDefaultBranch: false,
      branch: null,
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    });
  });

  it("preserves local-only fields when applying a remote update", () => {
    const current: GitStatusResult = {
      isRepo: true,
      hostingProvider: {
        kind: "github",
        name: "GitHub",
        baseUrl: "https://github.com",
      },
      hasOriginRemote: true,
      isDefaultBranch: false,
      branch: "feature/demo",
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [{ path: "src/demo.ts", status: "modified", insertions: 1, deletions: 0 }],
        insertions: 1,
        deletions: 0,
      },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };

    const remote: GitStatusRemoteResult = {
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    };

    expect(applyGitStatusStreamEvent(current, { _tag: "remoteUpdated", remote })).toEqual({
      ...current,
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    });
  });
});
