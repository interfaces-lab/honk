// The mutation surface: branches, checkout, pull, and discard. Reads live in
// read.test.ts; checkpoints in checkpoint.test.ts.

import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Git } from "../../src/git";
import { createTestRepository, git, withGit } from "./fixture";

let directory: string;

beforeEach(async () => {
  directory = await createTestRepository();
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("git.branches and git.checkout", () => {
  it.effect("lists local branches and marks the checked-out one", () =>
    Effect.gen(function* () {
      git(directory, "branch", "feature");

      const branches = yield* withGit(directory, (service, workspaceId) =>
        service.branches({ workspaceId }),
      );

      expect(branches.current).toBe("main");
      expect(branches.defaultBranch).toBe("main");
      expect(branches.branches.map((branch) => branch.name)).toEqual(["feature", "main"]);
      expect(branches.branches.find((branch) => branch.name === "main")?.current).toBe(true);
      expect(branches.branches.every((branch) => !branch.remote)).toBe(true);
    }),
  );

  it.effect("creates and switches to a branch", () =>
    Effect.gen(function* () {
      const branches = yield* withGit(directory, (service, workspaceId) =>
        Effect.gen(function* () {
          yield* service.checkout({ workspaceId, branch: "feature/one", create: true });
          return yield* service.branches({ workspaceId });
        }),
      );

      expect(branches.current).toBe("feature/one");
    }),
  );

  it.effect("refuses branch names git would read as flags or revisions", () =>
    Effect.gen(function* () {
      const refused = yield* withGit(directory, (service, workspaceId) =>
        Effect.all(
          ["--force", "main; rm -rf /", "main@{1}", "-b", "feature..other"].map((branch) =>
            service.checkout({ workspaceId, branch }).pipe(Effect.flip),
          ),
        ),
      );

      for (const error of refused) {
        expect(error).toBeInstanceOf(Git.RefError);
        if (error instanceof Git.RefError) expect(error.code).toBe("git.invalid_ref");
      }
    }),
  );
});

describe("git.pull", () => {
  it.effect("carries git's own exit code and stderr when a command refuses", () =>
    Effect.gen(function* () {
      const error = yield* withGit(directory, (service, workspaceId) =>
        service.pull({ workspaceId }),
      ).pipe(Effect.flip);

      expect(error).toBeInstanceOf(Git.CommandError);
      if (error instanceof Git.CommandError) {
        expect(error.code).toBe("git.command_failed");
        expect(error.command).toBe("pull");
        expect(error.exitCode).toBeGreaterThan(0);
        expect(error.stderr.length).toBeGreaterThan(0);
      }
    }),
  );
});

describe("git.discard", () => {
  it.effect("restores the named tracked paths and refuses to delete untracked ones", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        writeFile(join(directory, "tracked.txt"), "one\ntwo\nthree\nfour\n"),
      );
      yield* Effect.promise(() => writeFile(join(directory, "untracked.txt"), "new\n"));

      const [result, after] = yield* withGit(directory, (service, workspaceId) =>
        Effect.gen(function* () {
          const discarded = yield* service.discard({
            workspaceId,
            paths: ["tracked.txt", "untracked.txt"],
          });
          return [discarded, yield* service.status({ workspaceId })] as const;
        }),
      );

      expect(result.discarded).toEqual(["tracked.txt"]);
      // Discarding an untracked file would delete the only copy, which is a
      // different act with a different blast radius.
      expect(result.skipped).toEqual(["untracked.txt"]);
      expect(after.files.map((file) => file.file)).toEqual(["untracked.txt"]);
    }),
  );
});
