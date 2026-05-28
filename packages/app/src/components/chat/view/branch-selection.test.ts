import { describe, expect, it } from "vitest";

import { isBranchListed, resolveMissingStoredBranch } from "./branch-selection";

describe("branch-selection", () => {
  it("detects a stored branch missing from the listing", () => {
    expect(
      resolveMissingStoredBranch(
        "feature/merged",
        [{ name: "main", current: true, isDefault: true, worktreePath: null }],
        true,
      ),
    ).toBe("feature/merged");
  });

  it("returns null while branch data is not ready", () => {
    expect(resolveMissingStoredBranch("feature/merged", [], false)).toBeNull();
  });

  it("returns null when the stored branch is still listed", () => {
    expect(
      resolveMissingStoredBranch(
        "main",
        [
          { name: "main", current: true, isDefault: true, worktreePath: null },
          { name: "feature/merged", current: false, isDefault: false, worktreePath: null },
        ],
        true,
      ),
    ).toBeNull();
    expect(
      isBranchListed([{ name: "main", current: true, isDefault: true, worktreePath: null }], "main"),
    ).toBe(true);
  });
});
