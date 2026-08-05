// Shared fixture for the git tests: one real temp repository per test, the
// service layer over a fresh trust store, and an argv git for setup. The
// surface is tested across read.test.ts, mutate.test.ts, checkpoint.test.ts,
// and contract.test.ts, so a change to one surface touches one file.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Layer } from "effect";

import { Git } from "../../src/git";
import { createExecutionEnv, createTestStorage, openTrustedWorkspace } from "../../src/testing";
import { Workspace } from "../../src/workspace";

// Git reads a real working tree, so the tests do too: every case runs against
// a temp repository with real commits. A stubbed shell would only prove that
// the parser matches the stub.
const appLayer = Git.defaultLayer.pipe(
  Layer.provideMerge(Workspace.defaultLayer({ createExecutionEnv, storage: createTestStorage() })),
);

/** Drives git through argv, never a shell, so fixture setup cannot be quoted wrong. */
export const git = (directory: string, ...argv: readonly string[]) =>
  execFileSync("git", [...argv], { cwd: directory, encoding: "utf8" });

/** Runs one test program against the git service in a trusted workspace. */
export const withGit = <A, E>(
  directory: string,
  use: (service: Git.Interface, workspaceId: Workspace.WorkspaceId) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const opened = yield* openTrustedWorkspace(directory);
    const service = yield* Git.Service;
    return yield* use(service, opened.id);
  }).pipe(Effect.provide(appLayer));

/**
 * A fresh repository on `main` with one commit holding `tracked.txt` and
 * `docs/keep.md`. Callers remove the directory in their own `afterEach`.
 */
export const createTestRepository = async () => {
  const directory = await mkdtemp(join(tmpdir(), "honk-git-"));
  // `git init -b` needs git 2.28; the symbolic-ref form works everywhere and
  // pins the branch name the assertions expect.
  git(directory, "init", ".");
  git(directory, "symbolic-ref", "HEAD", "refs/heads/main");
  // Local identity and no signing, so the fixture commits on a clean CI box
  // that has neither configured.
  git(directory, "config", "user.email", "test@honk.invalid");
  git(directory, "config", "user.name", "Honk Test");
  git(directory, "config", "commit.gpgsign", "false");

  await writeFile(join(directory, "tracked.txt"), "one\ntwo\nthree\n");
  await mkdir(join(directory, "docs"));
  await writeFile(join(directory, "docs", "keep.md"), "keep\n");
  git(directory, "add", "-A");
  git(directory, "commit", "-m", "initial");
  return directory;
};
