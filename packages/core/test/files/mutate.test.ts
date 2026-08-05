// Destructive operations: delete and rename, with their refusals.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Files } from "../../src/files";
import { withWorkspace } from "./fixture";

describe("files delete", () => {
  it.effect("removes a file, and refuses a missing path", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        yield* files.write({ workspaceId: workspace.id, path: "gone.txt", content: "x" });
        yield* files.delete({ workspaceId: workspace.id, path: "gone.txt" });
        expect(yield* files.list({ workspaceId: workspace.id })).toEqual([]);

        const error = yield* files
          .delete({ workspaceId: workspace.id, path: "gone.txt" })
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(Files.NotFoundError);
      }),
    ),
  );

  it.effect("needs recursive for a non-empty directory, and refuses the workspace root", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        yield* files.write({ workspaceId: workspace.id, path: "tree/leaf.txt", content: "x" });

        const shallow = yield* files
          .delete({ workspaceId: workspace.id, path: "tree" })
          .pipe(Effect.flip);
        expect(shallow).toBeInstanceOf(Files.OperationError);

        const root = yield* files
          .delete({ workspaceId: workspace.id, path: "." })
          .pipe(Effect.flip);
        expect(root).toBeInstanceOf(Files.OperationError);
        if (root instanceof Files.OperationError) expect(root.reason).toBe("invalid");

        yield* files.delete({ workspaceId: workspace.id, path: "tree", recursive: true });
        expect(yield* files.list({ workspaceId: workspace.id })).toEqual([]);
      }),
    ),
  );
});

describe("files rename", () => {
  it.effect("moves a file without touching its bytes", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        // Binary on purpose: a copy that went through text would corrupt it.
        const bytes = Uint8Array.from([0x00, 0xff, 0x10, 0x80]);
        yield* Effect.promise(() => writeFile(join(workspace.directory, "a.bin"), bytes));

        yield* files.rename({ workspaceId: workspace.id, from: "a.bin", to: "moved/b.bin" });

        const moved = yield* Effect.promise(() =>
          readFile(join(workspace.directory, "moved/b.bin")),
        );
        expect(Uint8Array.from(moved)).toEqual(bytes);
        const remaining = yield* files.list({ workspaceId: workspace.id });
        expect(remaining.map((entry) => entry.name)).toEqual(["moved"]);
      }),
    ),
  );

  it.effect("moves a directory tree", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        yield* files.write({ workspaceId: workspace.id, path: "src/deep/one.txt", content: "one" });
        yield* files.write({ workspaceId: workspace.id, path: "src/two.txt", content: "two" });

        yield* files.rename({ workspaceId: workspace.id, from: "src", to: "lib" });

        const one = yield* files.read({ workspaceId: workspace.id, path: "lib/deep/one.txt" });
        expect(Files.ReadResult.guards.text(one) ? one.text : undefined).toBe("one");
        const two = yield* files.read({ workspaceId: workspace.id, path: "lib/two.txt" });
        expect(Files.ReadResult.guards.text(two) ? two.text : undefined).toBe("two");

        const roots = yield* files.list({ workspaceId: workspace.id });
        expect(roots.map((entry) => entry.name)).toEqual(["lib"]);
      }),
    ),
  );

  it.effect("refuses to overwrite, and refuses to leave the workspace", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        yield* files.write({ workspaceId: workspace.id, path: "a.txt", content: "a" });
        yield* files.write({ workspaceId: workspace.id, path: "b.txt", content: "b" });

        const clobber = yield* files
          .rename({ workspaceId: workspace.id, from: "a.txt", to: "b.txt" })
          .pipe(Effect.flip);
        expect(clobber).toBeInstanceOf(Files.ExistsError);

        const escaped = yield* files
          .rename({ workspaceId: workspace.id, from: "a.txt", to: "../escaped.txt" })
          .pipe(Effect.flip);
        expect(escaped).toBeInstanceOf(Files.EscapeError);

        // Nothing moved: a refused rename leaves both sides alone.
        const kept = yield* files.read({ workspaceId: workspace.id, path: "a.txt" });
        expect(Files.ReadResult.guards.text(kept) ? kept.text : undefined).toBe("a");
      }),
    ),
  );

  it.effect("refuses to copy a directory into itself", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        yield* Effect.promise(() => mkdir(join(workspace.directory, "tree"), { recursive: true }));

        const error = yield* files
          .rename({ workspaceId: workspace.id, from: "tree", to: "tree/inner" })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(Files.OperationError);
        if (error instanceof Files.OperationError) expect(error.reason).toBe("invalid");
      }),
    ),
  );
});
