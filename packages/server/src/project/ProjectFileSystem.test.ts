import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectEntriesLive } from "./ProjectEntries.ts";
import { ProjectFileSystem } from "./ProjectFileSystem.service.ts";
import { ProjectFileSystemLive } from "./ProjectFileSystem.ts";
import { ProjectPathsLive } from "./ProjectPaths.ts";

const ProjectLayerLive = Layer.mergeAll(
  ProjectFileSystemLive.pipe(
    Layer.provide(ProjectPathsLive),
    Layer.provide(ProjectEntriesLive.pipe(Layer.provide(ProjectPathsLive))),
  ),
  ProjectPathsLive,
  ProjectEntriesLive.pipe(Layer.provide(ProjectPathsLive)),
).pipe(Layer.provide(NodeServices.layer));

function withTempProjectRoot<T>(run: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = mkdtempSync(join(tmpdir(), "honk-project-fs-"));
  return run(cwd).finally(() => {
    rmSync(cwd, { recursive: true, force: true });
  });
}

function expectEffectSuccess<A>(exit: Exit.Exit<A, unknown>): A {
  if (Exit.isFailure(exit)) {
    throw new Error(Cause.pretty(exit.cause));
  }
  return exit.value;
}

describe("ProjectFileSystem", () => {
  it("creates a directory", async () => {
    await withTempProjectRoot(async (cwd) => {
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const projectFileSystem = yield* ProjectFileSystem;
          return yield* projectFileSystem.createDirectory({
            cwd,
            relativePath: "new-dir",
          });
        }).pipe(Effect.provide(ProjectLayerLive)),
      );
      const result = expectEffectSuccess(exit);
      expect(result.relativePath).toBe("new-dir");
    });
  });

  it("rejects duplicate directory creation", async () => {
    await withTempProjectRoot(async (cwd) => {
      const program = Effect.gen(function* () {
        const projectFileSystem = yield* ProjectFileSystem;
        yield* projectFileSystem.createDirectory({
          cwd,
          relativePath: "dup-dir",
        });
        return yield* projectFileSystem.createDirectory({
          cwd,
          relativePath: "dup-dir",
        });
      }).pipe(Effect.provide(ProjectLayerLive));

      await expect(Effect.runPromise(program)).rejects.toThrow(/already exists/i);
    });
  });

  it("renames a file", async () => {
    await withTempProjectRoot(async (cwd) => {
      writeFileSync(join(cwd, "old.txt"), "hello", "utf8");
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const projectFileSystem = yield* ProjectFileSystem;
          return yield* projectFileSystem.renamePath({
            cwd,
            fromRelativePath: "old.txt",
            toRelativePath: "new.txt",
          });
        }).pipe(Effect.provide(ProjectLayerLive)),
      );
      expect(result).toEqual({
        fromRelativePath: "old.txt",
        toRelativePath: "new.txt",
      });
    });
  });

  it("renames a folder", async () => {
    await withTempProjectRoot(async (cwd) => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const projectFileSystem = yield* ProjectFileSystem;
          yield* projectFileSystem.createDirectory({
            cwd,
            relativePath: "folder-a",
          });
          return yield* projectFileSystem.renamePath({
            cwd,
            fromRelativePath: "folder-a",
            toRelativePath: "folder-b",
          });
        }).pipe(Effect.provide(ProjectLayerLive)),
      );
      expect(result).toEqual({
        fromRelativePath: "folder-a",
        toRelativePath: "folder-b",
      });
    });
  });

  it("rejects rename collisions", async () => {
    await withTempProjectRoot(async (cwd) => {
      writeFileSync(join(cwd, "a.txt"), "a", "utf8");
      writeFileSync(join(cwd, "b.txt"), "b", "utf8");
      const program = Effect.gen(function* () {
        const projectFileSystem = yield* ProjectFileSystem;
        return yield* projectFileSystem.renamePath({
          cwd,
          fromRelativePath: "a.txt",
          toRelativePath: "b.txt",
        });
      }).pipe(Effect.provide(ProjectLayerLive));

      await expect(Effect.runPromise(program)).rejects.toThrow(/already exists/i);
    });
  });
});
