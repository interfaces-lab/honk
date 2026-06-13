import * as OS from "node:os";
import { Effect, FileSystem, Layer, Path } from "effect";

import {
  ProjectPaths,
  ProjectPathOutsideRootError,
  ProjectRootCreateFailedError,
  ProjectRootNotDirectoryError,
  ProjectRootNotExistsError,
  type ProjectPathsShape,
} from "./ProjectPaths.service.ts";

function toPosixRelativePath(input: string): string {
  return input.replaceAll("\\", "/");
}

function expandHomePath(input: string, path: Path.Path): string {
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(OS.homedir(), input.slice(2));
  }
  return input;
}

export const makeProjectPaths = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const normalizeProjectRoot: ProjectPathsShape["normalizeProjectRoot"] = Effect.fn(
    "ProjectPaths.normalizeProjectRoot",
  )(function* (projectRoot, options) {
    const normalizedProjectRoot = path.resolve(expandHomePath(projectRoot.trim(), path));
    let projectStat = yield* fileSystem
      .stat(normalizedProjectRoot)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!projectStat && options?.createIfMissing) {
      yield* fileSystem.makeDirectory(normalizedProjectRoot, { recursive: true }).pipe(
        Effect.mapError(
          () =>
            new ProjectRootCreateFailedError({
              projectRoot,
              normalizedProjectRoot,
            }),
        ),
      );
      projectStat = yield* fileSystem
        .stat(normalizedProjectRoot)
        .pipe(Effect.catch(() => Effect.succeed(null)));
    }
    if (!projectStat) {
      return yield* new ProjectRootNotExistsError({
        projectRoot,
        normalizedProjectRoot,
      });
    }
    if (projectStat.type !== "Directory") {
      return yield* new ProjectRootNotDirectoryError({
        projectRoot,
        normalizedProjectRoot,
      });
    }
    return normalizedProjectRoot;
  });

  const resolveRelativePathWithinRoot: ProjectPathsShape["resolveRelativePathWithinRoot"] =
    Effect.fn("ProjectPaths.resolveRelativePathWithinRoot")(function* (input) {
      const normalizedInputPath = input.relativePath.trim();
      if (path.isAbsolute(normalizedInputPath)) {
        return yield* new ProjectPathOutsideRootError({
          projectRoot: input.projectRoot,
          relativePath: input.relativePath,
        });
      }

      const absolutePath = path.resolve(input.projectRoot, normalizedInputPath);
      const relativeToRoot = toPosixRelativePath(path.relative(input.projectRoot, absolutePath));
      if (
        relativeToRoot.length === 0 ||
        relativeToRoot === "." ||
        relativeToRoot.startsWith("../") ||
        relativeToRoot === ".." ||
        path.isAbsolute(relativeToRoot)
      ) {
        return yield* new ProjectPathOutsideRootError({
          projectRoot: input.projectRoot,
          relativePath: input.relativePath,
        });
      }

      // The lexical check above blocks `..`/absolute escapes but cannot see a
      // SYMLINKED directory component inside the root (e.g. root/link -> /etc,
      // relativePath "link/passwd"), which would let read/write/delete escape
      // the root. Canonicalize with realpath and require containment. The leaf
      // may not exist yet (writeFile creates files/dirs), so resolve the nearest
      // existing ancestor — any dirs created beneath it cannot be symlinks.
      const realRoot = yield* fileSystem
        .realPath(input.projectRoot)
        .pipe(Effect.catch(() => Effect.succeed(input.projectRoot)));
      let ancestor = path.dirname(absolutePath);
      // Bounded by the filesystem root: dirname stops changing there, and
      // absolutePath is lexically under projectRoot so the walk halts at/above
      // the (existing) root at the latest.
      for (;;) {
        const exists = yield* fileSystem
          .exists(ancestor)
          .pipe(Effect.catch(() => Effect.succeed(false)));
        if (exists) {
          break;
        }
        const parent = path.dirname(ancestor);
        if (parent === ancestor) {
          break;
        }
        ancestor = parent;
      }
      const realAncestor = yield* fileSystem
        .realPath(ancestor)
        .pipe(Effect.catch(() => Effect.succeed(ancestor)));
      const realRelative = path.relative(realRoot, realAncestor);
      if (
        realRelative === ".." ||
        realRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(realRelative)
      ) {
        return yield* new ProjectPathOutsideRootError({
          projectRoot: input.projectRoot,
          relativePath: input.relativePath,
        });
      }

      return {
        absolutePath,
        relativePath: relativeToRoot,
      };
    });

  return {
    normalizeProjectRoot,
    resolveRelativePathWithinRoot,
  } satisfies ProjectPathsShape;
});

export const ProjectPathsLive = Layer.effect(ProjectPaths, makeProjectPaths);
