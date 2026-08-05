// The one invariant everything else stands on: no path, however spelled,
// reaches outside the trusted workspace directory.

import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Files } from "../../src/files";
import { Workspace } from "../../src/workspace";
import { services, withWorkspace } from "./fixture";

describe("files containment", () => {
  it.effect("refuses a relative path that climbs out with ..", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        yield* Effect.promise(() =>
          writeFile(join(workspace.directory, "..", "honk-outside.txt"), "secret"),
        );

        const error = yield* files
          .read({ workspaceId: workspace.id, path: "../honk-outside.txt" })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(Files.EscapeError);
        if (error instanceof Files.EscapeError) {
          expect(error.code).toBe("files.path_escaped");
          expect(error.path).toBe("../honk-outside.txt");
          expect(error.workspaceId).toBe(workspace.id);
        }

        yield* Effect.promise(() =>
          rm(join(workspace.directory, "..", "honk-outside.txt"), { force: true }),
        );
      }),
    ),
  );

  it.effect("refuses an absolute path outside the workspace, on read and on write", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;

        const read = yield* files
          .read({ workspaceId: workspace.id, path: "/etc/hosts" })
          .pipe(Effect.flip);
        expect(read).toBeInstanceOf(Files.EscapeError);

        // The boundary has to hold on the way out as well as the way in: a
        // write that escapes is the one that does real damage.
        const written = yield* files
          .write({
            workspaceId: workspace.id,
            path: join(workspace.directory, "..", "honk-written.txt"),
            content: "nope",
          })
          .pipe(Effect.flip);
        expect(written).toBeInstanceOf(Files.EscapeError);

        const landed = yield* Effect.promise(() =>
          readFile(join(workspace.directory, "..", "honk-written.txt"), "utf8").then(
            () => true,
            () => false,
          ),
        );
        expect(landed).toBe(false);
      }),
    ),
  );

  it.effect("refuses a symlink that points outside, even though its path is inside", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        const outside = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "honk-outside-")));
        yield* Effect.promise(() => writeFile(join(outside, "secret.txt"), "secret"));
        yield* Effect.promise(() => symlink(outside, join(workspace.directory, "door")));

        const error = yield* files
          .read({ workspaceId: workspace.id, path: "door/secret.txt" })
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(Files.EscapeError);

        // The link itself is inside the workspace and still refused: reading
        // through it would leave the trusted directory.
        const listed = yield* files.list({ workspaceId: workspace.id });
        expect(listed.map((entry) => entry.kind)).toEqual(["symlink"]);

        yield* Effect.promise(() => rm(outside, { recursive: true, force: true }));
      }),
    ),
  );

  it.effect("refuses an unknown workspace id with the workspace domain's error", () =>
    Effect.gen(function* () {
      const files = yield* Files.Service;
      const error = yield* files
        .list({ workspaceId: Workspace.WorkspaceId.make("missing") })
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(Workspace.NotFoundError);
      expect(error.code).toBe("workspace.not_found");
    }).pipe(Effect.provide(services)),
  );
});
