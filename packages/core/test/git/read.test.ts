// The read surface: status, diffs, patches, and file content at every source.
// Mutations live in mutate.test.ts; checkpoints in checkpoint.test.ts.

import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

describe("git.status", () => {
  it.effect("reports modified, deleted and untracked paths with their counts", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        writeFile(join(directory, "tracked.txt"), "one\ntwo\nthree\nfour\n"),
      );
      yield* Effect.promise(() => writeFile(join(directory, "untracked.txt"), "new\nlines\n"));
      yield* Effect.promise(() => rm(join(directory, "docs", "keep.md")));

      const status = yield* withGit(directory, (service, workspaceId) =>
        service.status({ workspaceId }),
      );

      expect(status.branch).toBe("main");
      expect(status.defaultBranch).toBe("main");
      expect(status.files.map((file) => file.file)).toEqual([
        "docs/keep.md",
        "tracked.txt",
        "untracked.txt",
      ]);

      const [deleted, modified, untracked] = status.files;
      expect(deleted).toMatchObject({ status: "deleted", tracked: true, deletions: 1 });
      expect(modified).toMatchObject({ status: "modified", tracked: true, additions: 1 });
      // Untracked files are still "added" to a reviewer, but only `tracked`
      // says whether git holds a version to restore.
      expect(untracked).toMatchObject({ status: "added", tracked: false, additions: 2 });
    }),
  );

  it.effect("a directory outside any repository is its own state, not a failure", () =>
    Effect.gen(function* () {
      // realpath because trust canonicalizes: the error must name the
      // directory the workspace actually is, not the tmpdir alias.
      const plain = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "honk-plain-")).then((made) => realpath(made)),
      );

      const error = yield* withGit(plain, (service, workspaceId) =>
        service.status({ workspaceId }),
      ).pipe(Effect.flip);

      expect(error).toBeInstanceOf(Git.NotARepositoryError);
      if (error instanceof Git.NotARepositoryError) {
        expect(error.code).toBe("git.not_a_repository");
        expect(error.directory).toBe(plain);
      }

      yield* Effect.promise(() => rm(plain, { recursive: true, force: true }));
    }),
  );
});

describe("git.diff", () => {
  it.effect("produces one patch per changed path, tracked or not", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        writeFile(join(directory, "tracked.txt"), "one\ntwo\nthree\nfour\n"),
      );
      yield* Effect.promise(() => writeFile(join(directory, "untracked.txt"), "brand new\n"));

      const diffs = yield* withGit(directory, (service, workspaceId) =>
        service.diff({ workspaceId }),
      );

      const tracked = diffs.find((diff) => diff.file === "tracked.txt");
      const untracked = diffs.find((diff) => diff.file === "untracked.txt");
      expect(tracked?.patch).toContain("+four");
      expect(untracked?.patch).toContain("+brand new");
      expect(untracked?.tracked).toBe(false);
    }),
  );
});

describe("git.filePatch", () => {
  it.effect("answers for a changed path and for a clean one", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        writeFile(join(directory, "tracked.txt"), "one\ntwo\nthree\nfour\n"),
      );

      const [changed, clean, missing] = yield* withGit(directory, (service, workspaceId) =>
        Effect.all([
          service.filePatch({ workspaceId, path: "tracked.txt" }),
          service.filePatch({ workspaceId, path: "docs/keep.md" }),
          service.filePatch({ workspaceId, path: "never-existed.txt" }),
        ]),
      );

      expect(changed).toMatchObject({ status: "modified", tracked: true, additions: 1 });
      expect(changed.patch).toContain("@@");
      // A clean file is real and has nothing to show: absent status, not a
      // fourth "unchanged" literal leaking into every list rendering.
      expect(clean).toMatchObject({ tracked: true, additions: 0, deletions: 0 });
      expect(clean.status).toBeUndefined();
      expect(missing).toMatchObject({ tracked: false });
    }),
  );

  it.effect("passes a path a shell would mangle straight through to git", () =>
    Effect.gen(function* () {
      // Quotes, a space, a dollar sign and a semicolon: everything single-quote
      // escaping exists to neutralize.
      const awkward = `we're $(echo "x"); ok.txt`;
      yield* Effect.promise(() => writeFile(join(directory, awkward), "quoted content\n"));

      const patch = yield* withGit(directory, (service, workspaceId) =>
        service.filePatch({ workspaceId, path: awkward }),
      );

      expect(patch.file).toBe(awkward);
      expect(patch.patch).toContain("+quoted content");
    }),
  );

  it.effect("refuses a path that climbs out of the workspace", () =>
    Effect.gen(function* () {
      const error = yield* withGit(directory, (service, workspaceId) =>
        service.filePatch({ workspaceId, path: "../escaped.txt" }),
      ).pipe(Effect.flip);

      expect(error).toBeInstanceOf(Git.PathError);
      if (error instanceof Git.PathError) {
        expect(error.code).toBe("git.path_outside_workspace");
        expect(error.path).toBe("../escaped.txt");
      }
    }),
  );

  it.effect("refuses an absolute path outside the workspace", () =>
    Effect.gen(function* () {
      const error = yield* withGit(directory, (service, workspaceId) =>
        service.filePatch({ workspaceId, path: "/etc/passwd" }),
      ).pipe(Effect.flip);

      expect(error).toBeInstanceOf(Git.PathError);
    }),
  );
});

describe("git.fileImage", () => {
  // A 1x1 PNG. Binary on purpose: the point of the test is that bytes survive
  // a shell's stdout, which they only do because they are base64-encoded first.
  const committed =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const edited =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it.effect("reads both sides of an image diff, and reports an absent one", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        writeFile(join(directory, "logo.png"), Buffer.from(committed, "base64")),
      );
      git(directory, "add", "-A");
      git(directory, "commit", "-m", "add logo");
      yield* Effect.promise(() =>
        writeFile(join(directory, "logo.png"), Buffer.from(edited, "base64")),
      );

      const [head, working, missing] = yield* withGit(directory, (service, workspaceId) =>
        Effect.all([
          service.fileImage({ workspaceId, path: "logo.png", ref: "head" }),
          service.fileImage({ workspaceId, path: "logo.png" }),
          service.fileImage({ workspaceId, path: "never-added.png", ref: "head" }),
        ]),
      );

      expect(head).toMatchObject({ type: "image", mediaType: "image/png", base64: committed });
      expect(working).toMatchObject({ type: "image", ref: "working_tree", base64: edited });
      // An image added in this diff has no `head` side. That is a half of the
      // comparison, not a failure, so it arrives on the success channel.
      expect(Git.ImageResult.guards.absent(missing)).toBe(true);
    }),
  );
});

describe("git.fileContent", () => {
  it.effect("reads one file at the working tree, at HEAD, and at a checkpoint", () =>
    Effect.gen(function* () {
      const [working, head, snapshot] = yield* withGit(directory, (service, workspaceId) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            writeFile(join(directory, "tracked.txt"), "one\ntwo\nthree\nturn-one\n"),
          );
          yield* service.captureCheckpoint({ workspaceId, checkpoint: "s1/turn-1" });
          yield* Effect.promise(() =>
            writeFile(join(directory, "tracked.txt"), "one\ntwo\nthree\nturn-two\n"),
          );

          return yield* Effect.all([
            service.fileContent({ workspaceId, path: "tracked.txt" }),
            service.fileContent({ workspaceId, path: "tracked.txt", at: { type: "head" } }),
            service.fileContent({
              workspaceId,
              path: "tracked.txt",
              at: { type: "checkpoint", checkpoint: "s1/turn-1" },
            }),
          ]);
        }),
      );

      // Three sources, three honest answers: disk now, the commit, the turn.
      expect(working).toMatchObject({ type: "content", text: "one\ntwo\nthree\nturn-two\n" });
      expect(head).toMatchObject({ type: "content", text: "one\ntwo\nthree\n" });
      expect(snapshot).toMatchObject({ type: "content", text: "one\ntwo\nthree\nturn-one\n" });
    }),
  );

  it.effect("reports absence and binary content as states, not failures", () =>
    Effect.gen(function* () {
      // A 1x1 PNG: binary by git's own judgment, not by extension guessing.
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      );
      yield* Effect.promise(() => writeFile(join(directory, "logo.png"), png));

      const [absent, binary] = yield* withGit(directory, (service, workspaceId) =>
        Effect.all([
          service.fileContent({ workspaceId, path: "untracked.txt", at: { type: "head" } }),
          service.fileContent({ workspaceId, path: "logo.png" }),
        ]),
      );

      expect(Git.ContentResult.guards.absent(absent)).toBe(true);
      // Binary is not an empty string: bytes are fileImage's answer.
      expect(Git.ContentResult.guards.binary(binary)).toBe(true);
    }),
  );
});
