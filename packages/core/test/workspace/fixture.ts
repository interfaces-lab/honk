// Shared fixture for the workspace tests: the rpc handler layer, the bare
// service layer, and a real-directory helper. The surface is tested across
// contract.test.ts, trust.test.ts, and lookup.test.ts.

import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Layer } from "effect";

import { createExecutionEnv, createTestStorage } from "../../src/testing";
import { Workspace } from "../../src/workspace";

export const serviceLayer = () =>
  Workspace.defaultLayer({ createExecutionEnv, storage: createTestStorage() });

export const handlers = Workspace.rpcLayer.pipe(Layer.provide(serviceLayer()));

/** A real directory plus its canonical form, which trust must resolve to. */
export const fixture = async (prefix: string) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  return { directory, canonical: await realpath(directory) };
};
