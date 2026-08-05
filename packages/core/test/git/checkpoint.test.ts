// The checkpoint surface: capture, list, per-turn changes and diffs, and both
// restore grains. Reads live in read.test.ts; mutations in mutate.test.ts.

import { readFile, rm, stat, writeFile } from "node:fs/promises";
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

describe("git checkpoints", () => {
  it.effect("diffing two checkpoints isolates one turn's changes", () =>
    Effect.gen(function* () {
      // Turn one: edit a tracked file and create an untracked one.
      yield* Effect.promise(() =>
        writeFile(join(directory, "tracked.txt"), "one\ntwo\nthree\nfour\n"),
      );
      yield* Effect.promise(() => writeFile(join(directory, "note.txt"), "first\n"));

      // Turn two: touch the untracked file again and add another.
      const [names, changes, diffs] = yield* withGit(directory, (service, workspaceId) =>
        Effect.gen(function* () {
          yield* service.captureCheckpoint({ workspaceId, checkpoint: "s1/turn-1" });
          yield* Effect.promise(() => writeFile(join(directory, "note.txt"), "first\nsecond\n"));
          yield* Effect.promise(() => writeFile(join(directory, "fresh.txt"), "brand new\n"));
          yield* service.captureCheckpoint({ workspaceId, checkpoint: "s1/turn-2" });

          return [
            yield* service.checkpoints({ workspaceId, prefix: "s1" }),
            yield* service.checkpointChanges({ workspaceId, from: "s1/turn-1", to: "s1/turn-2" }),
            yield* service.checkpointDiff({ workspaceId, from: "s1/turn-1", to: "s1/turn-2" }),
          ] as const;
        }),
      );

      expect(names.checkpoints).toEqual(["s1/turn-1", "s1/turn-2"]);
      // tracked.txt changed before turn one's snapshot, so the turn-two diff
      // must not claim it: that isolation is the whole point of checkpoints.
      expect(changes.map((change) => change.file)).toEqual(["fresh.txt", "note.txt"]);
      expect(changes[0]).toMatchObject({ status: "added", additions: 1 });
      expect(changes[1]).toMatchObject({ status: "modified", additions: 1, deletions: 0 });
      expect(diffs.find((diff) => diff.file === "fresh.txt")?.patch).toContain("+brand new");

      // Capturing never moves the user's own git state: nothing staged, and
      // the untracked files are still untracked.
      expect(git(directory, "diff", "--cached", "--name-only")).toBe("");
      expect(git(directory, "status", "--porcelain")).toContain("?? note.txt");
    }),
  );

  it.effect("restore rewrites the working tree to a snapshot, untracked files included", () =>
    Effect.gen(function* () {
      yield* withGit(directory, (service, workspaceId) =>
        Effect.gen(function* () {
          yield* service.captureCheckpoint({ workspaceId, checkpoint: "s1/base" });
          yield* Effect.promise(() =>
            writeFile(join(directory, "tracked.txt"), "one\ntwo\nthree\nfour\n"),
          );
          yield* Effect.promise(() => writeFile(join(directory, "extra.txt"), "extra\n"));
          yield* service.captureCheckpoint({ workspaceId, checkpoint: "s1/after" });

          yield* service.restoreCheckpoint({ workspaceId, checkpoint: "s1/base" });
        }),
      );

      // Back to base: the edit is undone and the file created after the
      // snapshot is gone.
      expect(yield* Effect.promise(() => readFile(join(directory, "tracked.txt"), "utf8"))).toBe(
        "one\ntwo\nthree\n",
      );
      const extraExists = yield* Effect.promise(() =>
        stat(join(directory, "extra.txt")).then(
          () => true,
          () => false,
        ),
      );
      expect(extraExists).toBe(false);

      // Forward again: the untracked file was captured, so restore brings it
      // back — which is what makes revert itself revertible.
      yield* withGit(directory, (service, workspaceId) =>
        service.restoreCheckpoint({ workspaceId, checkpoint: "s1/after" }),
      );
      expect(yield* Effect.promise(() => readFile(join(directory, "extra.txt"), "utf8"))).toBe(
        "extra\n",
      );
      expect(yield* Effect.promise(() => readFile(join(directory, "tracked.txt"), "utf8"))).toBe(
        "one\ntwo\nthree\nfour\n",
      );
    }),
  );

  it.effect("refuses names git could misread and reports a missing checkpoint", () =>
    Effect.gen(function* () {
      const [refused, missing] = yield* withGit(directory, (service, workspaceId) =>
        Effect.all([
          service.captureCheckpoint({ workspaceId, checkpoint: "--force" }).pipe(Effect.flip),
          service.restoreCheckpoint({ workspaceId, checkpoint: "s1/never" }).pipe(Effect.flip),
        ]),
      );

      expect(refused).toBeInstanceOf(Git.RefError);
      expect(missing).toBeInstanceOf(Git.CheckpointNotFoundError);
      if (missing instanceof Git.CheckpointNotFoundError) {
        expect(missing.checkpoint).toBe("s1/never");
      }
    }),
  );
});

describe("git.restoreFiles", () => {
  it.effect("restores only the named paths and removes ones the snapshot lacks", () =>
    Effect.gen(function* () {
      const result = yield* withGit(directory, (service, workspaceId) =>
        Effect.gen(function* () {
          yield* service.captureCheckpoint({ workspaceId, checkpoint: "s1/base" });
          // After the snapshot: edit two files, create a third.
          yield* Effect.promise(() =>
            writeFile(join(directory, "tracked.txt"), "one\ntwo\nthree\nbroken\n"),
          );
          yield* Effect.promise(() =>
            writeFile(join(directory, "docs", "keep.md"), "kept\nedit\n"),
          );
          yield* Effect.promise(() => writeFile(join(directory, "fresh.txt"), "brand new\n"));

          return yield* service.restoreFiles({
            workspaceId,
            checkpoint: "s1/base",
            paths: ["tracked.txt", "fresh.txt"],
          });
        }),
      );

      expect(result.restored).toEqual(["tracked.txt"]);
      expect(result.removed).toEqual(["fresh.txt"]);

      // The named paths went back to the snapshot; the unnamed edit survived.
      expect(yield* Effect.promise(() => readFile(join(directory, "tracked.txt"), "utf8"))).toBe(
        "one\ntwo\nthree\n",
      );
      expect(
        yield* Effect.promise(() => readFile(join(directory, "docs", "keep.md"), "utf8")),
      ).toBe("kept\nedit\n");
      const freshExists = yield* Effect.promise(() =>
        stat(join(directory, "fresh.txt")).then(
          () => true,
          () => false,
        ),
      );
      expect(freshExists).toBe(false);

      // Nothing is left staged: the restore reads as ordinary uncommitted
      // changes, exactly like a whole-tree restore.
      expect(git(directory, "diff", "--cached", "--name-only")).toBe("");
    }),
  );
});
