// Navigating the workspace: listing, finding, and creating directories.

import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Files } from "../../src/files";
import { withWorkspace } from "./fixture";

describe("files list, find, and directories", () => {
  it.effect("lists workspace-relative entries with directories first", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        yield* files.write({ workspaceId: workspace.id, path: "b.txt", content: "b" });
        yield* files.write({
          workspaceId: workspace.id,
          path: "src/main.ts",
          content: "export {}",
        });
        yield* files.createDirectory({ workspaceId: workspace.id, path: "assets" });

        const root = yield* files.list({ workspaceId: workspace.id });
        expect(root.map((entry) => `${entry.kind}:${entry.path}`)).toEqual([
          "directory:assets",
          "directory:src",
          "file:b.txt",
        ]);

        const nested = yield* files.list({ workspaceId: workspace.id, path: "src" });
        expect(nested.map((entry) => entry.path)).toEqual([join("src", "main.ts")]);
        expect(nested[0]?.size).toBe("export {}".length);
      }),
    ),
  );

  it.effect("createDirectory makes parents and is idempotent", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        yield* files.createDirectory({ workspaceId: workspace.id, path: "a/b/c" });
        yield* files.createDirectory({ workspaceId: workspace.id, path: "a/b/c" });

        const listed = yield* files.list({ workspaceId: workspace.id, path: "a/b" });
        expect(listed.map((entry) => entry.name)).toEqual(["c"]);
      }),
    ),
  );

  it.effect("find matches the relative path case-insensitively", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        yield* files.write({ workspaceId: workspace.id, path: "src/Auth.ts", content: "" });
        yield* files.write({ workspaceId: workspace.id, path: "src/auth.test.ts", content: "" });
        yield* files.write({ workspaceId: workspace.id, path: "docs/readme.md", content: "" });

        const found = yield* files.find({ workspaceId: workspace.id, query: "AUTH" });
        expect(found.truncated).toBe(false);
        expect(found.entries.map((entry) => entry.name).sort()).toEqual([
          "Auth.ts",
          "auth.test.ts",
        ]);

        const scoped = yield* files.find({
          workspaceId: workspace.id,
          query: ".md",
          path: "docs",
        });
        expect(scoped.entries.map((entry) => entry.name)).toEqual(["readme.md"]);
      }),
    ),
  );

  it.effect("find stops at the limit and reports that there is more", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        for (const index of [0, 1, 2, 3]) {
          yield* files.write({ workspaceId: workspace.id, path: `note-${index}.txt`, content: "" });
        }

        const limited = yield* files.find({ workspaceId: workspace.id, query: "note-", limit: 2 });
        expect(limited.entries).toHaveLength(2);
        expect(limited.truncated).toBe(true);

        const complete = yield* files.find({ workspaceId: workspace.id, query: "note-", limit: 4 });
        expect(complete.entries).toHaveLength(4);
        expect(complete.truncated).toBe(false);
      }),
    ),
  );

  it.effect("find reports a symlinked directory without walking into it", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        const outside = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "honk-outside-")));
        yield* Effect.promise(() => writeFile(join(outside, "leak-target.txt"), ""));
        yield* Effect.promise(() => symlink(outside, join(workspace.directory, "leak")));

        const found = yield* files.find({ workspaceId: workspace.id, query: "leak" });
        expect(found.entries.map((entry) => entry.path)).toEqual(["leak"]);

        yield* Effect.promise(() => rm(outside, { recursive: true, force: true }));
      }),
    ),
  );
});
