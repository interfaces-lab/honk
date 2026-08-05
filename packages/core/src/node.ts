/**
 * Node bindings for Honk Core.
 *
 * The rest of `@honk/core` is platform-free: it takes Pi's `ExecutionEnv`
 * interface as an injected capability so the package carries no filesystem or
 * process dependency of its own. This module is the Node implementation of
 * that capability, kept in a separate entry point so importing `@honk/core`
 * from a browser bundle never pulls Node in.
 *
 * Core owns the Pi version pin, so hosts get their environment from here
 * rather than depending on `@earendil-works/pi-agent-core` directly. That
 * keeps one Pi revision across the workspace.
 *
 * @example
 * ```ts
 * import { createHonkCore } from "@honk/core";
 * import { createNodeExecutionEnv } from "@honk/core/node";
 *
 * const core = await createHonkCore({
 *   dataDirectory,
 *   models,
 *   model,
 *   createExecutionEnv: createNodeExecutionEnv,
 * });
 * ```
 *
 * @module
 */

import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

import type { Workspace } from "./workspace";

/**
 * Builds a Node filesystem and shell environment rooted at one directory.
 *
 * Everything the workspace does through this instance — Pi's tools,
 * `sdk.files`, `sdk.git` — resolves against `directory` as its working
 * directory, which is what keeps a trusted workspace the boundary.
 *
 * @category construction
 */
export const createNodeExecutionEnv: Workspace.LayerOptions["createExecutionEnv"] = (directory) =>
  new NodeExecutionEnv({ cwd: directory });

// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Node from "./node";
