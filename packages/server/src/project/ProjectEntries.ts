import * as OS from "node:os";
import fsPromises from "node:fs/promises";
import type { Dirent } from "node:fs";

import { Cache, Duration, Effect, Exit, Layer, Option, Path } from "effect";

import { type FilesystemBrowseInput, type ProjectEntry } from "@honk/contracts";
import { isExplicitRelativePath, isWindowsAbsolutePath } from "@honk/shared/path";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
  type RankedSearchResult,
} from "@honk/shared/search-ranking";

import { GitCore } from "../git/GitCore.service.ts";
import {
  ProjectEntries,
  ProjectEntriesBrowseError,
  ProjectEntriesError,
  type ProjectEntriesShape,
} from "./ProjectEntries.service.ts";
import { ProjectPaths } from "./ProjectPaths.service.ts";

const PROJECT_CACHE_TTL_MS = 15_000;
const PROJECT_CACHE_MAX_KEYS = 4;
const PROJECT_INDEX_MAX_ENTRIES = 25_000;
const PROJECT_SCAN_READDIR_CONCURRENCY = 32;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".convex",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  ".cache",
  ".electron-runtime",
  "dist-electron",
  ".pnpm-store",
]);

interface ProjectIndex {
  scannedAt: number;
  entries: SearchableProjectEntry[];
  truncated: boolean;
}

interface SearchableProjectEntry extends ProjectEntry {
  normalizedPath: string;
  normalizedName: string;
}

type RankedProjectEntry = RankedSearchResult<SearchableProjectEntry>;

function toPosixPath(input: string): string {
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

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return undefined;
  }
  return input.slice(0, separatorIndex);
}

function basenameOf(input: string): string {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return input;
  }
  return input.slice(separatorIndex + 1);
}

function toSearchableProjectEntry(entry: ProjectEntry): SearchableProjectEntry {
  const normalizedPath = entry.path.toLowerCase();
  return {
    ...entry,
    normalizedPath,
    normalizedName: basenameOf(normalizedPath),
  };
}

function normalizeRelativeDirectoryPath(input: string): string {
  const normalized = toPosixPath(input.trim()).replace(/\/+$/g, "");
  return normalized === "." ? "" : normalized;
}

function scoreEntry(entry: SearchableProjectEntry, query: string): number | null {
  if (!query) {
    return entry.kind === "directory" ? 0 : 1;
  }

  const { normalizedPath, normalizedName } = entry;

  const scores = [
    scoreQueryMatch({
      value: normalizedName,
      query,
      exactBase: 0,
      prefixBase: 2,
      includesBase: 5,
      fuzzyBase: 100,
    }),
    scoreQueryMatch({
      value: normalizedPath,
      query,
      exactBase: 1,
      prefixBase: 3,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 200,
      boundaryMarkers: ["/"],
    }),
  ].filter((score): score is number => score !== null);

  if (scores.length === 0) {
    return null;
  }

  return Math.min(...scores);
}

function isPathInIgnoredDirectory(relativePath: string): boolean {
  return relativePath
    .split("/")
    .some((segment) => segment.length > 0 && IGNORED_DIRECTORY_NAMES.has(segment));
}

function directoryAncestorsOf(relativePath: string): string[] {
  const segments = relativePath.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) return [];

  const directories: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index).join("/"));
  }
  return directories;
}

const resolveBrowseTarget = (
  input: FilesystemBrowseInput,
  pathService: Path.Path,
): Effect.Effect<string, ProjectEntriesBrowseError> =>
  Effect.gen(function* () {
    if (process.platform !== "win32" && isWindowsAbsolutePath(input.partialPath)) {
      return yield* new ProjectEntriesBrowseError({
        cwd: input.cwd,
        partialPath: input.partialPath,
        operation: "projectEntries.resolveBrowseTarget",
        detail: "Windows-style paths are only supported on Windows.",
      });
    }

    if (!isExplicitRelativePath(input.partialPath)) {
      return pathService.resolve(expandHomePath(input.partialPath, pathService));
    }

    if (!input.cwd) {
      return yield* new ProjectEntriesBrowseError({
        cwd: input.cwd,
        partialPath: input.partialPath,
        operation: "projectEntries.resolveBrowseTarget",
        detail: "Relative filesystem browse paths require a current project.",
      });
    }

    return pathService.resolve(expandHomePath(input.cwd, pathService), input.partialPath);
  });

export const makeProjectEntries = Effect.gen(function* () {
  const path = yield* Path.Path;
  const gitOption = yield* Effect.serviceOption(GitCore);
  const projectPaths = yield* ProjectPaths;

  const isInsideGitWorkTree = (cwd: string): Effect.Effect<boolean> =>
    Option.match(gitOption, {
      onSome: (git) => git.isInsideWorkTree(cwd).pipe(Effect.catch(() => Effect.succeed(false))),
      onNone: () => Effect.succeed(false),
    });

  const filterGitIgnoredPaths = (
    cwd: string,
    relativePaths: string[],
  ): Effect.Effect<string[], never> =>
    Option.match(gitOption, {
      onSome: (git) =>
        git.filterIgnoredPaths(cwd, relativePaths).pipe(
          Effect.map((paths) => [...paths]),
          Effect.catch(() => Effect.succeed(relativePaths)),
        ),
      onNone: () => Effect.succeed(relativePaths),
    });

  const buildProjectIndexFromGit = Effect.fn("ProjectEntries.buildProjectIndexFromGit")(function* (
    cwd: string,
  ) {
    if (Option.isNone(gitOption)) {
      return null;
    }
    if (!(yield* isInsideGitWorkTree(cwd))) {
      return null;
    }

    const listedFiles = yield* gitOption.value
      .listProjectFiles(cwd)
      .pipe(Effect.catch(() => Effect.succeed(null)));

    if (!listedFiles) {
      return null;
    }

    const listedPaths = [...listedFiles.paths]
      .map((entry) => toPosixPath(entry))
      .filter((entry) => entry.length > 0 && !isPathInIgnoredDirectory(entry));
    const filePaths = yield* filterGitIgnoredPaths(cwd, listedPaths);

    const directorySet = new Set<string>();
    for (const filePath of filePaths) {
      for (const directoryPath of directoryAncestorsOf(filePath)) {
        if (!isPathInIgnoredDirectory(directoryPath)) {
          directorySet.add(directoryPath);
        }
      }
    }

    const directoryEntries = [...directorySet]
      .toSorted((left, right) => left.localeCompare(right))
      .map(
        (directoryPath): ProjectEntry => ({
          path: directoryPath,
          kind: "directory",
          parentPath: parentPathOf(directoryPath),
        }),
      )
      .map(toSearchableProjectEntry);
    const fileEntries = [...new Set(filePaths)]
      .toSorted((left, right) => left.localeCompare(right))
      .map(
        (filePath): ProjectEntry => ({
          path: filePath,
          kind: "file",
          parentPath: parentPathOf(filePath),
        }),
      )
      .map(toSearchableProjectEntry);

    const entries = [...directoryEntries, ...fileEntries];
    return {
      scannedAt: Date.now(),
      entries: entries.slice(0, PROJECT_INDEX_MAX_ENTRIES),
      truncated: listedFiles.truncated || entries.length > PROJECT_INDEX_MAX_ENTRIES,
    };
  });

  const readDirectoryEntries = Effect.fn("ProjectEntries.readDirectoryEntries")(function* (
    cwd: string,
    relativeDir: string,
  ): Effect.fn.Return<
    { readonly relativeDir: string; readonly dirents: Dirent[] | null },
    ProjectEntriesError
  > {
    return yield* Effect.tryPromise({
      try: async () => {
        const absoluteDir = relativeDir ? path.join(cwd, relativeDir) : cwd;
        const dirents = await fsPromises.readdir(absoluteDir, { withFileTypes: true });
        return { relativeDir, dirents };
      },
      catch: (cause) =>
        new ProjectEntriesError({
          cwd,
          operation: "projectEntries.readDirectoryEntries",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    }).pipe(
      Effect.catchIf(
        () => relativeDir.length > 0,
        () => Effect.succeed({ relativeDir, dirents: null }),
      ),
    );
  });

  const buildProjectIndexFromFilesystem = Effect.fn(
    "ProjectEntries.buildProjectIndexFromFilesystem",
  )(function* (cwd: string): Effect.fn.Return<ProjectIndex, ProjectEntriesError> {
    const shouldFilterWithGitIgnore = yield* isInsideGitWorkTree(cwd);

    let pendingDirectories: string[] = [""];
    const entries: SearchableProjectEntry[] = [];
    let truncated = false;

    while (pendingDirectories.length > 0 && !truncated) {
      const currentDirectories = pendingDirectories;
      pendingDirectories = [];

      const directoryEntries = yield* Effect.forEach(
        currentDirectories,
        (relativeDir) => readDirectoryEntries(cwd, relativeDir),
        { concurrency: PROJECT_SCAN_READDIR_CONCURRENCY },
      );

      const candidateEntriesByDirectory = directoryEntries.map((directoryEntry) => {
        const { relativeDir, dirents } = directoryEntry;
        if (!dirents) return [] as Array<{ dirent: Dirent; relativePath: string }>;

        dirents.sort((left, right) => left.name.localeCompare(right.name));
        const candidates: Array<{ dirent: Dirent; relativePath: string }> = [];
        for (const dirent of dirents) {
          if (!dirent.name || dirent.name === "." || dirent.name === "..") {
            continue;
          }
          if (dirent.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)) {
            continue;
          }
          if (!dirent.isDirectory() && !dirent.isFile()) {
            continue;
          }

          const relativePath = toPosixPath(
            relativeDir ? path.join(relativeDir, dirent.name) : dirent.name,
          );
          if (isPathInIgnoredDirectory(relativePath)) {
            continue;
          }
          candidates.push({ dirent, relativePath });
        }
        return candidates;
      });

      const candidatePaths = candidateEntriesByDirectory.flatMap((candidateEntries) =>
        candidateEntries.map((entry) => entry.relativePath),
      );
      const allowedPathSet = shouldFilterWithGitIgnore
        ? new Set(yield* filterGitIgnoredPaths(cwd, candidatePaths))
        : null;

      for (const candidateEntries of candidateEntriesByDirectory) {
        for (const candidate of candidateEntries) {
          if (allowedPathSet && !allowedPathSet.has(candidate.relativePath)) {
            continue;
          }

          const entry = toSearchableProjectEntry({
            path: candidate.relativePath,
            kind: candidate.dirent.isDirectory() ? "directory" : "file",
            parentPath: parentPathOf(candidate.relativePath),
          });
          entries.push(entry);

          if (candidate.dirent.isDirectory()) {
            pendingDirectories.push(candidate.relativePath);
          }

          if (entries.length >= PROJECT_INDEX_MAX_ENTRIES) {
            truncated = true;
            break;
          }
        }

        if (truncated) {
          break;
        }
      }
    }

    return {
      scannedAt: Date.now(),
      entries,
      truncated,
    };
  });

  const buildProjectIndex = Effect.fn("ProjectEntries.buildProjectIndex")(function* (
    cwd: string,
  ): Effect.fn.Return<ProjectIndex, ProjectEntriesError> {
    const gitIndexed = yield* buildProjectIndexFromGit(cwd);
    if (gitIndexed) {
      return gitIndexed;
    }
    return yield* buildProjectIndexFromFilesystem(cwd);
  });

  const projectIndexCache = yield* Cache.makeWith<string, ProjectIndex, ProjectEntriesError>(
    buildProjectIndex,
    {
      capacity: PROJECT_CACHE_MAX_KEYS,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) ? Duration.millis(PROJECT_CACHE_TTL_MS) : Duration.zero,
    },
  );

  const resolveDirectoryTarget = Effect.fn("ProjectEntries.resolveDirectoryTarget")(function* (
    cwd: string,
    rawRelativeDir: string,
  ): Effect.fn.Return<
    { readonly absoluteDir: string; readonly relativeDir: string },
    ProjectEntriesError
  > {
    const relativeDir = normalizeRelativeDirectoryPath(rawRelativeDir);
    if (relativeDir.length === 0) {
      return {
        absoluteDir: cwd,
        relativeDir: "",
      };
    }

    if (path.isAbsolute(relativeDir) || isWindowsAbsolutePath(relativeDir)) {
      return yield* new ProjectEntriesError({
        cwd,
        operation: "projectEntries.resolveDirectoryTarget",
        detail: "Project directory path must be relative to the project root.",
      });
    }

    return yield* projectPaths
      .resolveRelativePathWithinRoot({
        projectRoot: cwd,
        relativePath: relativeDir,
      })
      .pipe(
        Effect.map(({ absolutePath, relativePath }) => ({
          absoluteDir: absolutePath,
          relativeDir: relativePath,
        })),
        Effect.mapError(
          (cause) =>
            new ProjectEntriesError({
              cwd,
              operation: "projectEntries.resolveDirectoryTarget",
              detail: cause.message,
              cause,
            }),
        ),
      );
  });

  const invalidate: ProjectEntriesShape["invalidate"] = Effect.fn("ProjectEntries.invalidate")(
    function* (cwd) {
      yield* Cache.invalidate(projectIndexCache, cwd);
    },
  );

  const browse: ProjectEntriesShape["browse"] = Effect.fn("ProjectEntries.browse")(
    function* (input) {
      const resolvedInputPath = yield* resolveBrowseTarget(input, path);
      const endsWithSeparator = /[\\/]$/.test(input.partialPath) || input.partialPath === "~";
      const parentPath = endsWithSeparator ? resolvedInputPath : path.dirname(resolvedInputPath);
      const prefix = endsWithSeparator ? "" : path.basename(resolvedInputPath);

      const dirents = yield* Effect.tryPromise({
        try: () => fsPromises.readdir(parentPath, { withFileTypes: true }),
        catch: (cause) =>
          new ProjectEntriesBrowseError({
            cwd: input.cwd,
            partialPath: input.partialPath,
            operation: "projectEntries.browse.readDirectory",
            detail: `Unable to browse '${parentPath}': ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          }),
      });

      const showHidden = endsWithSeparator || prefix.startsWith(".");
      const lowerPrefix = prefix.toLowerCase();

      return {
        parentPath,
        entries: dirents
          .filter(
            (dirent) =>
              dirent.isDirectory() &&
              dirent.name.toLowerCase().startsWith(lowerPrefix) &&
              (showHidden || !dirent.name.startsWith(".")),
          )
          .map((dirent) => ({
            name: dirent.name,
            fullPath: path.join(parentPath, dirent.name),
          }))
          .toSorted((left, right) => left.name.localeCompare(right.name)),
      };
    },
  );

  const search: ProjectEntriesShape["search"] = Effect.fn("ProjectEntries.search")(
    function* (input) {
      const normalizedCwd = yield* projectPaths.normalizeProjectRoot(input.cwd);
      return yield* Cache.get(projectIndexCache, normalizedCwd).pipe(
        Effect.map((index) => {
          const normalizedQuery = normalizeSearchQuery(input.query, {
            trimLeadingPattern: /^[@./]+/,
          });
          const limit = Math.max(0, Math.floor(input.limit));
          const rankedEntries: RankedProjectEntry[] = [];
          let matchedEntryCount = 0;

          for (const entry of index.entries) {
            const score = scoreEntry(entry, normalizedQuery);
            if (score === null) {
              continue;
            }

            matchedEntryCount += 1;
            insertRankedSearchResult(
              rankedEntries,
              { item: entry, score, tieBreaker: entry.path },
              limit,
            );
          }

          return {
            entries: rankedEntries.map((candidate) => candidate.item),
            truncated: index.truncated || matchedEntryCount > limit,
          };
        }),
      );
    },
  );

  const listDirectory: ProjectEntriesShape["listDirectory"] = Effect.fn(
    "ProjectEntries.listDirectory",
  )(function* (input) {
    const normalizedCwd = yield* projectPaths.normalizeProjectRoot(input.cwd);
    const { absoluteDir, relativeDir } = yield* resolveDirectoryTarget(
      normalizedCwd,
      input.relativeDir,
    );
    const shouldFilterWithGitIgnore = yield* isInsideGitWorkTree(normalizedCwd);

    const dirents = yield* Effect.tryPromise({
      try: () => fsPromises.readdir(absoluteDir, { withFileTypes: true }),
      catch: (cause) =>
        new ProjectEntriesError({
          cwd: normalizedCwd,
          operation: "projectEntries.listDirectory.readDirectory",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    const candidates: Array<{ readonly dirent: Dirent; readonly relativePath: string }> = [];
    for (const dirent of dirents) {
      if (!dirent.name || dirent.name === "." || dirent.name === "..") {
        continue;
      }
      if (dirent.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)) {
        continue;
      }
      if (!dirent.isDirectory() && !dirent.isFile()) {
        continue;
      }

      const relativePath = toPosixPath(
        relativeDir ? path.join(relativeDir, dirent.name) : dirent.name,
      );
      if (isPathInIgnoredDirectory(relativePath)) {
        continue;
      }
      candidates.push({ dirent, relativePath });
    }

    const candidatePaths = candidates.map((candidate) => candidate.relativePath);
    const allowedPathSet = shouldFilterWithGitIgnore
      ? new Set(yield* filterGitIgnoredPaths(normalizedCwd, candidatePaths))
      : null;

    const entries = candidates
      .filter((candidate) => !allowedPathSet || allowedPathSet.has(candidate.relativePath))
      .map((candidate): ProjectEntry => {
        const parentPath = parentPathOf(candidate.relativePath);
        return parentPath
          ? {
              path: candidate.relativePath,
              kind: candidate.dirent.isDirectory() ? "directory" : "file",
              parentPath,
            }
          : {
              path: candidate.relativePath,
              kind: candidate.dirent.isDirectory() ? "directory" : "file",
            };
      })
      .toSorted((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "directory" ? -1 : 1;
        }
        return left.path.localeCompare(right.path);
      });

    return {
      entries,
      truncated: false,
    };
  });

  return {
    browse,
    invalidate,
    listDirectory,
    search,
  } satisfies ProjectEntriesShape;
});

export const ProjectEntriesLive = Layer.effect(ProjectEntries, makeProjectEntries);
