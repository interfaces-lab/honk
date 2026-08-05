/**
 * The tools a trusted workspace gives its harness, and what each one's calls
 * say about attribution.
 *
 * Checkpoints are the truth about *content*: `sdk.session.changes` diffs the
 * snapshots around a turn, so every write shows up — shell redirections,
 * generated files, MCP side effects. What a snapshot cannot say is *whose*
 * write it was: two sessions in one directory, or the user editing by hand,
 * land in the same diff. That is what {@link writesOf} answers. A turn's tool
 * calls classify it: a turn that used only declaring tools claims exactly the
 * paths it named, and a turn that ran an opaque mutator claims the whole
 * diff, because filtering it would silently hide real writes.
 *
 * The classification errs open on purpose. An unknown tool is opaque, not
 * ignored: over-claiming a path is a visible, correctable mistake, while
 * dropping one is an invisible lie.
 *
 * @see spec/core.md section 7.
 * @module
 */

import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-agent-core";

/**
 * What one tool call says about the paths it wrote.
 *
 * - `none`: the tool cannot write — its calls never affect attribution.
 * - `declared`: the tool writes exactly the paths it names in its arguments.
 * - `opaque`: the tool can write anything, and nothing in its arguments can
 *   stand behind a path list.
 *
 * @category types
 */
export type ToolWrites =
  | { readonly kind: "none" }
  | { readonly kind: "declared"; readonly paths: readonly string[] }
  | { readonly kind: "opaque" };

/**
 * Pi's built-in execution tools, in the order a harness receives them.
 *
 * @category construction
 */
export const builtins = () =>
  [createReadTool(), createWriteTool(), createEditTool(), createBashTool()] as const;

/**
 * Classifies one tool call for the attribution gate.
 *
 * Arguments arrive as `unknown` because they come from the model and were
 * validated only against the tool's own schema. A declaring tool whose
 * arguments cannot be read declares nothing rather than guessing — the
 * checkpoint diff still holds the content either way.
 *
 * @example
 * ```ts
 * writesOf("edit", { path: "src/auth.ts", edits: [] });
 * // { kind: "declared", paths: ["src/auth.ts"] }
 * writesOf("bash", { command: "make generate" }); // { kind: "opaque" }
 * writesOf("unknown-mcp-tool", {});               // { kind: "opaque" }
 * ```
 *
 * @category reading
 */
export const writesOf = (toolName: string, args: unknown): ToolWrites => {
  switch (toolName) {
    case "read":
      return { kind: "none" };
    case "write":
    case "edit":
      return { kind: "declared", paths: declaredPath(args) };
    default:
      return { kind: "opaque" };
  }
};

/** The shape shared by Pi's writing built-ins: a required `path` argument. */
const declaredPath = (args: unknown): readonly string[] => {
  if (typeof args !== "object" || args === null) return [];
  const path: unknown = (args as { readonly path?: unknown }).path;
  return typeof path === "string" && path.length > 0 ? [path] : [];
};

// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Tools from "./tools";
