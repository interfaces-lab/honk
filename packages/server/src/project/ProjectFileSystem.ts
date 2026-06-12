import fsPromises from "node:fs/promises";

import { getFiletypeFromFileName } from "@pierre/diffs";
import { Effect, FileSystem, Layer, Path } from "effect";

import {
  ProjectFileSystem,
  ProjectFileSystemError,
  type ProjectFileSystemShape,
} from "./ProjectFileSystem.service.ts";
import { ProjectEntries } from "./ProjectEntries.service.ts";
import { ProjectPaths } from "./ProjectPaths.service.ts";

const READ_FILE_PREVIEW_MAX_BYTES = 1_000_000;
const BINARY_DETECTION_BYTES = 8_000;

function isProbablyBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, BINARY_DETECTION_BYTES).includes(0);
}

export const makeProjectFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projectPaths = yield* ProjectPaths;
  const projectEntries = yield* ProjectEntries;

  const readFile: ProjectFileSystemShape["readFile"] = Effect.fn("ProjectFileSystem.readFile")(
    function* (input) {
      const normalizedCwd = yield* projectPaths.normalizeProjectRoot(input.cwd);
      const target = yield* projectPaths.resolveRelativePathWithinRoot({
        projectRoot: normalizedCwd,
        relativePath: input.relativePath,
      });

      const stat = yield* Effect.tryPromise({
        try: () => fsPromises.stat(target.absolutePath),
        catch: (cause) =>
          new ProjectFileSystemError({
            cwd: normalizedCwd,
            relativePath: input.relativePath,
            operation: "projectFileSystem.readFile.stat",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

      if (!stat.isFile()) {
        return yield* new ProjectFileSystemError({
          cwd: normalizedCwd,
          relativePath: input.relativePath,
          operation: "projectFileSystem.readFile.stat",
          detail: "Path is not a file.",
        });
      }

      const bytesToRead = Math.min(stat.size, READ_FILE_PREVIEW_MAX_BYTES);
      const bytes = yield* Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => fsPromises.open(target.absolutePath, "r"),
          catch: (cause) =>
            new ProjectFileSystemError({
              cwd: normalizedCwd,
              relativePath: input.relativePath,
              operation: "projectFileSystem.readFile.open",
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
              new ProjectFileSystemError({
                cwd: normalizedCwd,
                relativePath: input.relativePath,
                operation: "projectFileSystem.readFile.read",
                detail: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
          }),
        (handle) => Effect.promise(() => handle.close()),
      );

      if (isProbablyBinary(bytes)) {
        return yield* new ProjectFileSystemError({
          cwd: normalizedCwd,
          relativePath: input.relativePath,
          operation: "projectFileSystem.readFile.decode",
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

  const writeFile: ProjectFileSystemShape["writeFile"] = Effect.fn("ProjectFileSystem.writeFile")(
    function* (input) {
      const normalizedCwd = yield* projectPaths.normalizeProjectRoot(input.cwd);
      const target = yield* projectPaths.resolveRelativePathWithinRoot({
        projectRoot: normalizedCwd,
        relativePath: input.relativePath,
      });

      yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectFileSystemError({
              cwd: normalizedCwd,
              relativePath: input.relativePath,
              operation: "projectFileSystem.makeDirectory",
              detail: cause.message,
              cause,
            }),
        ),
      );
      yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectFileSystemError({
              cwd: normalizedCwd,
              relativePath: input.relativePath,
              operation: "projectFileSystem.writeFile",
              detail: cause.message,
              cause,
            }),
        ),
      );
      yield* projectEntries.invalidate(normalizedCwd);
      return { relativePath: target.relativePath };
    },
  );
  return { readFile, writeFile } satisfies ProjectFileSystemShape;
});

export const ProjectFileSystemLive = Layer.effect(ProjectFileSystem, makeProjectFileSystem);
