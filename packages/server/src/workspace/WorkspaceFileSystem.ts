import fsPromises from "node:fs/promises";

import { getFiletypeFromFileName } from "@pierre/diffs";
import { Effect, FileSystem, Layer, Path } from "effect";

import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "./WorkspaceFileSystem.service.ts";
import { WorkspaceEntries } from "./WorkspaceEntries.service.ts";
import { WorkspacePaths } from "./WorkspacePaths.service.ts";

const READ_FILE_PREVIEW_MAX_BYTES = 1_000_000;
const BINARY_DETECTION_BYTES = 8_000;

function isProbablyBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, BINARY_DETECTION_BYTES).includes(0);
}

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;

  const readFile: WorkspaceFileSystemShape["readFile"] = Effect.fn("WorkspaceFileSystem.readFile")(
    function* (input) {
      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });

      const stat = yield* Effect.tryPromise({
        try: () => fsPromises.stat(target.absolutePath),
        catch: (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.readFile.stat",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

      if (!stat.isFile()) {
        return yield* new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.readFile.stat",
          detail: "Path is not a file.",
        });
      }

      const bytesToRead = Math.min(stat.size, READ_FILE_PREVIEW_MAX_BYTES);
      const bytes = yield* Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => fsPromises.open(target.absolutePath, "r"),
          catch: (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.readFile.open",
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }),
        (handle) =>
          Effect.tryPromise({
            try: async () => {
              const buffer = Buffer.alloc(bytesToRead);
              if (bytesToRead === 0) {
                return buffer;
              }
              const result = await handle.read(buffer, 0, bytesToRead, 0);
              return buffer.subarray(0, result.bytesRead);
            },
            catch: (cause) =>
              new WorkspaceFileSystemError({
                cwd: input.cwd,
                relativePath: input.relativePath,
                operation: "workspaceFileSystem.readFile.read",
                detail: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
          }),
        (handle) => Effect.promise(() => handle.close()),
      );

      if (isProbablyBinary(bytes)) {
        return yield* new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.readFile.decode",
          detail: "Binary file previews are not supported.",
        });
      }

      return {
        relativePath: target.relativePath,
        contents: new TextDecoder("utf-8").decode(bytes),
        sizeBytes: stat.size,
        truncated: stat.size > READ_FILE_PREVIEW_MAX_BYTES,
        syntax: {
          languageId: getFiletypeFromFileName(target.relativePath),
        },
      };
    },
  );

  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.makeDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.writeFile",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });
  return { readFile, writeFile } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
