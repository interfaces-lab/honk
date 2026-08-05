// Shared fixture for the files tests: the service layer over a fresh trust
// store and a real trusted temp directory per program. The surface is tested
// across contract.test.ts, containment.test.ts, read-write.test.ts,
// browse.test.ts, mutate.test.ts, and rpc.test.ts.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Layer } from "effect";

import { Files } from "../../src/files";
import { createExecutionEnv, createTestStorage, openTrustedWorkspace } from "../../src/testing";
import { Workspace } from "../../src/workspace";

// One Workspace instance behind both services: ids minted by trust have to be
// findable by Files, and a second instance would split the trust store.
export const services = Files.defaultLayer.pipe(
  Layer.provideMerge(Workspace.defaultLayer({ createExecutionEnv, storage: createTestStorage() })),
);

export const handlers = Files.rpcLayer.pipe(Layer.provideMerge(services));

/**
 * Runs `body` against a real, freshly created, trusted temp directory.
 *
 * A real directory rather than a stub environment, because everything this
 * module promises — `..` normalization, symlink canonicalization, recursive
 * copy — is a claim about a filesystem, and only a filesystem can refute it.
 * On macOS the temp root is itself reached through a symlink, so these tests
 * also exercise the addressed/canonical root split for free.
 */
export const withWorkspace = <A, E>(
  body: (workspace: {
    readonly id: Workspace.WorkspaceId;
    readonly directory: string;
  }) => Effect.Effect<A, E, Files.Service | Workspace.Service>,
) =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "honk-files-")));
    const opened = yield* openTrustedWorkspace(directory);
    return yield* body({ id: opened.id, directory }).pipe(
      Effect.ensuring(Effect.promise(() => rm(directory, { recursive: true, force: true }))),
    );
  }).pipe(Effect.provide(services));
