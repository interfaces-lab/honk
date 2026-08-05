// The wire contract: every RPC tag exists and every error carries its stable
// code. Behavior lives in read.test.ts, mutate.test.ts, and checkpoint.test.ts.

import { describe, expect, it } from "@effect/vitest";

import { Git } from "../../src/git";

describe("git contract", () => {
  it("defines typed RPCs with stable error codes", () => {
    for (const tag of [
      "git.status",
      "git.diff",
      "git.file_patch",
      "git.file_image",
      "git.file_content",
      "git.branches",
      "git.checkout",
      "git.pull",
      "git.discard",
      "git.capture_checkpoint",
      "git.checkpoints",
      "git.checkpoint_changes",
      "git.checkpoint_diff",
      "git.restore_checkpoint",
      "git.restore_files",
      "git.delete_checkpoints",
    ]) {
      expect(Git.Rpcs.requests.get(tag)).toBeDefined();
    }

    expect(new Git.PathError({ path: "../x" }).code).toBe("git.path_outside_workspace");
    expect(new Git.RefError({ ref: "--force" }).code).toBe("git.invalid_ref");
    expect(new Git.BaseBranchError().code).toBe("git.base_branch_unknown");
    expect(new Git.CommandError({ command: "switch", exitCode: 1, stderr: "boom" }).code).toBe(
      "git.command_failed",
    );
    expect(new Git.ExecError({ command: "status", reason: "spawn_error", detail: "" }).code).toBe(
      "git.execution_failed",
    );
    expect(new Git.CheckpointNotFoundError({ checkpoint: "s1/never" }).code).toBe(
      "git.checkpoint_not_found",
    );
  });
});
