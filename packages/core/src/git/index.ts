/**
 * Git: typed read and mutation methods over one trusted workspace.
 *
 * Everything here runs through the workspace's `ExecutionEnv` — the same
 * instance Pi's harness gets as tool context. Honk does not spawn its own
 * processes and does not construct a second environment, because sharing one
 * is what makes the workspace directory the boundary rather than a suggestion.
 *
 * The module splits along its three concerns:
 *
 * - `./contract` — schemas, typed errors, and the command catalog.
 * - `./exec` — how commands run and how caller input is allowed to reach
 *   them: quoting, pathspecs, ref validation, and path containment. The
 *   security layer, kept small enough to audit in one sitting.
 * - `./parse` — pure parsers for git's machine-readable output.
 * - `./service` — the service implementation and its layers.
 *
 * A non-zero git exit code is an outcome, not a bug: it becomes
 * `CommandError` with the code and stderr, except for "not a git
 * repository", which is its own `NotARepositoryError` so a client can
 * show "no version control here" instead of an error toast.
 *
 * Checkpoints are whole-workspace snapshots stored as hidden parentless
 * commits under `refs/honk/checkpoints/`. Capture stages the workspace
 * subtree — untracked files included, ignore rules honored — into a scratch
 * index and writes a commit from it, so the user's index, `HEAD`, and
 * branches are never touched and no snapshot appears in any log. Diffing two
 * checkpoints is what gives a thread its per-turn changes; restoring one
 * rewrites the working tree to that snapshot. The git object store is the
 * only storage: unchanged files share objects between snapshots, and the ref
 * name is the entire bookkeeping.
 *
 * @example
 * ```ts
 * const { files } = await sdk.git.status({ workspaceId });
 * for (const file of files) {
 *   const diff = await sdk.git.filePatch({ workspaceId, path: file.file });
 *   render(diff.patch);
 * }
 * ```
 *
 * @see spec/honk-built-ins.md section 5 for the method list, and spec/core.md
 * section 13 — "Git must resolve paths inside the session workspace".
 * @module
 */

export * from "./contract";
export * from "./service";

// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Git from ".";
