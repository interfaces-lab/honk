import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";

import { ServerConfig } from "../../src/config.ts";
import { GitCoreLive } from "../../src/git/GitCore.ts";
import { ProjectEntries } from "../../src/project/ProjectEntries.service.ts";
import {
  ProjectFileSystem,
  ProjectFileSystemError,
} from "../../src/project/ProjectFileSystem.service.ts";
import { ProjectEntriesLive } from "../../src/project/ProjectEntries.ts";
import { ProjectFileSystemLive } from "../../src/project/ProjectFileSystem.ts";
import { ProjectPathsLive } from "../../src/project/ProjectPaths.ts";

const ProjectLayer = ProjectFileSystemLive.pipe(
  Layer.provide(ProjectPathsLive),
  Layer.provide(ProjectEntriesLive.pipe(Layer.provide(ProjectPathsLive))),
);
const isProjectFileSystemError = Schema.is(ProjectFileSystemError);

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ProjectLayer),
  Layer.provideMerge(ProjectEntriesLive.pipe(Layer.provide(ProjectPathsLive))),
  Layer.provideMerge(ProjectPathsLive),
  Layer.provideMerge(GitCoreLive),
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-project-files-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "multi-project-files-",
  });
});

const writeTextFile = Effect.fn("writeTextFile")(function* (
  cwd: string,
  relativePath: string,
  contents = "",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(cwd, relativePath);
  yield* fileSystem
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.orDie);
  yield* fileSystem.writeFileString(absolutePath, contents).pipe(Effect.orDie);
});

it.layer(TestLayer)("ProjectFileSystemLive", (it) => {
  describe("readFile", () => {
    it.effect("reads text files relative to the project root", () =>
      Effect.gen(function* () {
        const projectFileSystem = yield* ProjectFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/index.ts", "export const value = 1;\n");

        const result = yield* projectFileSystem.readFile({
          cwd,
          relativePath: "src/index.ts",
        });

        expect(result).toEqual({
          relativePath: "src/index.ts",
          contents: "export const value = 1;\n",
          sizeBytes: 24,
          truncated: false,
          syntax: {
            languageId: "typescript",
          },
        });
      }),
    );

    it.effect("rejects reads outside the project root", () =>
      Effect.gen(function* () {
        const projectFileSystem = yield* ProjectFileSystem;
        const cwd = yield* makeTempDir;

        const error = yield* projectFileSystem
          .readFile({
            cwd,
            relativePath: "../escape.md",
          })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Project file path must be relative to the project root: ../escape.md",
        );
      }),
    );

    it.effect("fails explicitly when the project root is missing", () =>
      Effect.gen(function* () {
        const projectFileSystem = yield* ProjectFileSystem;
        const cwd = yield* makeTempDir;
        const path = yield* Path.Path;
        const missingRoot = path.join(cwd, "missing-root");

        const error = yield* projectFileSystem
          .readFile({
            cwd: missingRoot,
            relativePath: "README.md",
          })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(ProjectFileSystemError);
        if (!isProjectFileSystemError(error)) {
          return;
        }
        expect(error.detail).toContain("Project root does not exist:");
        expect(error.cwd).toBe(missingRoot);
      }),
    );
  });

  describe("writeFile", () => {
    it.effect("writes files relative to the project root", () =>
      Effect.gen(function* () {
        const projectFileSystem = yield* ProjectFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const result = yield* projectFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });
        const saved = yield* fileSystem
          .readFileString(path.join(cwd, "plans/effect-rpc.md"))
          .pipe(Effect.orDie);

        expect(result).toEqual({ relativePath: "plans/effect-rpc.md" });
        expect(saved).toBe("# Plan\n");
      }),
    );

    it.effect("invalidates project entry search cache after writes", () =>
      Effect.gen(function* () {
        const projectEntries = yield* ProjectEntries;
        const projectFileSystem = yield* ProjectFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/existing.ts", "export {};\n");

        const beforeWrite = yield* projectEntries.search({
          cwd,
          query: "rpc",
          limit: 10,
        });
        expect(beforeWrite).toEqual({
          entries: [],
          truncated: false,
        });

        yield* projectFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });

        const afterWrite = yield* projectEntries.search({
          cwd,
          query: "rpc",
          limit: 10,
        });
        expect(afterWrite.entries).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "plans/effect-rpc.md" })]),
        );
        expect(afterWrite.truncated).toBe(false);
      }),
    );

    it.effect("rejects writes outside the project root", () =>
      Effect.gen(function* () {
        const projectFileSystem = yield* ProjectFileSystem;
        const cwd = yield* makeTempDir;
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;

        const error = yield* projectFileSystem
          .writeFile({
            cwd,
            relativePath: "../escape.md",
            contents: "# nope\n",
          })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Project file path must be relative to the project root: ../escape.md",
        );

        const escapedPath = path.resolve(cwd, "..", "escape.md");
        const escapedStat = yield* fileSystem
          .stat(escapedPath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        expect(escapedStat).toBeNull();
      }),
    );

    it.effect("does not create a missing project root on write", () =>
      Effect.gen(function* () {
        const projectFileSystem = yield* ProjectFileSystem;
        const cwd = yield* makeTempDir;
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;
        const missingRoot = path.join(cwd, "missing-root");

        const error = yield* projectFileSystem
          .writeFile({
            cwd: missingRoot,
            relativePath: "README.md",
            contents: "# nope\n",
          })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(ProjectFileSystemError);
        if (!isProjectFileSystemError(error)) {
          return;
        }
        expect(error.detail).toContain("Project root does not exist:");
        expect(yield* fileSystem.exists(missingRoot)).toBe(false);
      }),
    );
  });
});
