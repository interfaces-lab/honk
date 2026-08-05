// Reading and writing file content: round-trips, binary reporting,
// truncation, and typed refusals.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Files } from "../../src/files";
import { withWorkspace } from "./fixture";

describe("files read and write", () => {
  it.effect("round-trips text and creates missing parent directories", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        yield* files.write({
          workspaceId: workspace.id,
          path: "docs/nested/notes.md",
          content: "# notes\nline two\n",
        });

        const result = yield* files.read({
          workspaceId: workspace.id,
          path: "docs/nested/notes.md",
        });
        expect(result.type).toBe("text");
        if (Files.ReadResult.guards.text(result)) {
          expect(result.text).toBe("# notes\nline two\n");
          expect(result.truncated).toBe(false);
        }

        const onDisk = yield* Effect.promise(() =>
          readFile(join(workspace.directory, "docs/nested/notes.md"), "utf8"),
        );
        expect(onDisk).toBe("# notes\nline two\n");
      }),
    ),
  );

  it.effect("reports a binary file as binary with its size and no content", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        const bytes = Uint8Array.from([0x89, 0x50, 0x00, 0x01, 0xff, 0xfe]);
        yield* Effect.promise(() => writeFile(join(workspace.directory, "logo.bin"), bytes));

        const result = yield* files.read({ workspaceId: workspace.id, path: "logo.bin" });
        expect(result.type).toBe("binary");
        if (Files.ReadResult.guards.binary(result)) expect(result.size).toBe(bytes.byteLength);
      }),
    ),
  );

  it.effect("truncates to maxLines and says so", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        yield* files.write({ workspaceId: workspace.id, path: "log.txt", content: "a\nb\nc\nd" });

        const head = yield* files.read({ workspaceId: workspace.id, path: "log.txt", maxLines: 2 });
        expect(head).toEqual({ type: "text", text: "a\nb", truncated: true });

        const whole = yield* files.read({
          workspaceId: workspace.id,
          path: "log.txt",
          maxLines: 4,
        });
        expect(whole).toEqual({ type: "text", text: "a\nb\nc\nd", truncated: false });
      }),
    ),
  );

  it.effect("reading a missing path is a typed not-found, not a defect", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        const error = yield* files
          .read({ workspaceId: workspace.id, path: "nope.txt" })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(Files.NotFoundError);
        if (error instanceof Files.NotFoundError) expect(error.path).toBe("nope.txt");
      }),
    ),
  );

  it.effect("listing a file rather than a directory reports why", () =>
    withWorkspace((workspace) =>
      Effect.gen(function* () {
        const files = yield* Files.Service;
        yield* files.write({ workspaceId: workspace.id, path: "a.txt", content: "a" });

        const error = yield* files
          .list({ workspaceId: workspace.id, path: "a.txt" })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(Files.OperationError);
        if (error instanceof Files.OperationError) expect(error.reason).toBe("not_directory");
      }),
    ),
  );
});
