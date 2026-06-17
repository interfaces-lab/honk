import fsPromises from "node:fs/promises";

import { getFiletypeFromFileName } from "@pierre/diffs";
import { Effect, FileSystem, Layer, Path } from "effect";
import { ProjectDeleteFileError, ProjectCreateDirectoryError, ProjectRenamePathError, ProjectWriteConflictError } from "@honk/contracts";

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

function errorCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) {
    return undefined;
  }
  const code = (cause as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function hasWriteExpectations(input: {
  readonly expectedMtimeMs?: number | undefined;
  readonly expectedSizeBytes?: number | undefined;
}): boolean {
  return input.expectedMtimeMs !== undefined || input.expectedSizeBytes !== undefined;
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
        mtimeMs: stat.mtimeMs,
        readBytes: bytes.length,
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

      if (hasWriteExpectations(input)) {
        const currentStat = yield* Effect.tryPromise({
          try: () => fsPromises.stat(target.absolutePath),
          catch: (cause) => {
            if (errorCode(cause) === "ENOENT") {
              return new ProjectWriteConflictError({
                relativePath: target.relativePath,
                message: "File changed before save.",
              });
            }
            return new ProjectFileSystemError({
              cwd: normalizedCwd,
              relativePath: input.relativePath,
              operation: "projectFileSystem.writeFile.stat",
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
            });
          },
        });

        if (
          (input.expectedMtimeMs !== undefined && currentStat.mtimeMs !== input.expectedMtimeMs) ||
          (input.expectedSizeBytes !== undefined && currentStat.size !== input.expectedSizeBytes)
        ) {
          return yield* new ProjectWriteConflictError({
            relativePath: target.relativePath,
            message: "File changed before save.",
          });
        }
      }

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
      const stat = yield* Effect.tryPromise({
        try: () => fsPromises.stat(target.absolutePath),
        catch: (cause) =>
          new ProjectFileSystemError({
            cwd: normalizedCwd,
            relativePath: input.relativePath,
            operation: "projectFileSystem.writeFile.statAfterWrite",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      yield* projectEntries.invalidate(normalizedCwd);
      return { relativePath: target.relativePath, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
    },
  );

  const deleteFile: ProjectFileSystemShape["deleteFile"] = Effect.fn(
    "ProjectFileSystem.deleteFile",
  )(function* (input) {
    const normalizedCwd = yield* projectPaths.normalizeProjectRoot(input.cwd);
    const target = yield* projectPaths.resolveRelativePathWithinRoot({
      projectRoot: normalizedCwd,
      relativePath: input.relativePath,
    });

    // lstat (not stat) so a symlink leaf is never followed/classified as a
    // file or directory — fileSystem.remove then unlinks the symlink itself
    // rather than its target.
    const stat = yield* Effect.tryPromise({
      try: () => fsPromises.lstat(target.absolutePath),
      catch: (cause) =>
        new ProjectFileSystemError({
          cwd: normalizedCwd,
          relativePath: input.relativePath,
          operation: "projectFileSystem.deleteFile.stat",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    if (!stat.isFile() && !stat.isDirectory() && !stat.isSymbolicLink()) {
      return yield* new ProjectDeleteFileError({
        message: "Not a file or directory.",
      });
    }

    yield* fileSystem.remove(target.absolutePath, { recursive: stat.isDirectory() }).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectFileSystemError({
            cwd: normalizedCwd,
            relativePath: input.relativePath,
            operation: "projectFileSystem.deleteFile",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* projectEntries.invalidate(normalizedCwd);
    return { relativePath: target.relativePath };
  });

  const createDirectory: ProjectFileSystemShape["createDirectory"] = Effect.fn(
    "ProjectFileSystem.createDirectory",
  )(function* (input) {
    const normalizedCwd = yield* projectPaths.normalizeProjectRoot(input.cwd);
    const target = yield* projectPaths.resolveRelativePathWithinRoot({
      projectRoot: normalizedCwd,
      relativePath: input.relativePath,
    });

    const alreadyExists = yield* fileSystem.exists(target.absolutePath).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectFileSystemError({
            cwd: normalizedCwd,
            relativePath: input.relativePath,
            operation: "projectFileSystem.createDirectory.exists",
            detail: cause.message,
            cause,
          }),
      ),
    );
    if (alreadyExists) {
      return yield* new ProjectCreateDirectoryError({
        message: `"${target.relativePath}" already exists.`,
      });
    }

    yield* fileSystem.makeDirectory(target.absolutePath, { recursive: false }).pipe(
      Effect.mapError((cause) => {
        if (errorCode(cause) === "ENOENT") {
          return new ProjectCreateDirectoryError({
            message: "Parent directory does not exist.",
            cause,
          });
        }
        if (errorCode(cause) === "EEXIST") {
          return new ProjectCreateDirectoryError({
            message: `"${target.relativePath}" already exists.`,
            cause,
          });
        }
        return new ProjectFileSystemError({
          cwd: normalizedCwd,
          relativePath: input.relativePath,
          operation: "projectFileSystem.createDirectory",
          detail: cause.message,
          cause,
        });
      }),
    );
    yield* projectEntries.invalidate(normalizedCwd);
    return { relativePath: target.relativePath };
  });

  const renamePath: ProjectFileSystemShape["renamePath"] = Effect.fn(
    "ProjectFileSystem.renamePath",
  )(function* (input) {
    const normalizedCwd = yield* projectPaths.normalizeProjectRoot(input.cwd);
    const source = yield* projectPaths.resolveRelativePathWithinRoot({
      projectRoot: normalizedCwd,
      relativePath: input.fromRelativePath,
    });
    const destination = yield* projectPaths.resolveRelativePathWithinRoot({
      projectRoot: normalizedCwd,
      relativePath: input.toRelativePath,
    });

    if (source.relativePath === destination.relativePath) {
      return {
        fromRelativePath: source.relativePath,
        toRelativePath: destination.relativePath,
      };
    }

    const destinationExists = yield* fileSystem.exists(destination.absolutePath).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectFileSystemError({
            cwd: normalizedCwd,
            relativePath: input.toRelativePath,
            operation: "projectFileSystem.renamePath.exists",
            detail: cause.message,
            cause,
          }),
      ),
    );
    if (destinationExists) {
      return yield* new ProjectRenamePathError({
        message: `"${destination.relativePath}" already exists.`,
      });
    }

    yield* Effect.tryPromise({
      try: () => fsPromises.rename(source.absolutePath, destination.absolutePath),
      catch: (cause) => {
        if (errorCode(cause) === "ENOENT") {
          return new ProjectRenamePathError({
            message: `"${source.relativePath}" was not found.`,
            cause,
          });
        }
        if (errorCode(cause) === "EEXIST") {
          return new ProjectRenamePathError({
            message: `"${destination.relativePath}" already exists.`,
            cause,
          });
        }
        return new ProjectFileSystemError({
          cwd: normalizedCwd,
          relativePath: input.fromRelativePath,
          operation: "projectFileSystem.renamePath",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        });
      },
    });

    yield* projectEntries.invalidate(normalizedCwd);
    return {
      fromRelativePath: source.relativePath,
      toRelativePath: destination.relativePath,
    };
  });

  return { readFile, writeFile, deleteFile, createDirectory, renamePath } satisfies ProjectFileSystemShape;
});

export const ProjectFileSystemLive = Layer.effect(ProjectFileSystem, makeProjectFileSystem);
