import type { GitBranch } from "@multi/contracts";

export function isBranchListed(branches: ReadonlyArray<GitBranch>, branchName: string): boolean {
  return branches.some((branch) => branch.name === branchName);
}

export function resolveMissingStoredBranch(
  storedBranch: string | null,
  branches: ReadonlyArray<GitBranch>,
  branchesReady: boolean,
): string | null {
  if (!storedBranch || !branchesReady) {
    return null;
  }
  return isBranchListed(branches, storedBranch) ? null : storedBranch;
}
