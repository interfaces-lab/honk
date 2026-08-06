/**
 * The attribution gate: what a turn's tool calls say about whose writes a
 * checkpoint diff contains.
 *
 * The snapshot diff is the truth about *content*; the turn's tool calls are
 * the truth about *attribution*. Intersecting them is what keeps a sibling
 * session's edits out of a turn's receipt without hiding what a shell command
 * wrote. Everything here is pure — transcript entries in, decisions out — and
 * pairs with `Tools.writesOf`, which classifies a single call.
 *
 * @see spec/core.md section 7 — "A turn captures a checkpoint; tools gate
 * attribution".
 * @module
 */

import type { SessionTreeEntry } from "@earendil-works/pi-agent-core";

import type { Git } from "../git";
import type { Models } from "../models";
import { Tools } from "../tools";

/** What one turn's tool calls say about who wrote what. */
export interface TurnWrites {
  /** The turn ran a tool whose writes are not derivable — shell, MCP. */
  readonly opaque: boolean;
  /** Paths the turn's declaring tools named, workspace-relative. */
  readonly declared: ReadonlySet<string>;
}

/**
 * The transcript's model record: the last `model_change` entry wins, exactly
 * as Pi replays it when rebuilding session context. Create always writes one,
 * so an absent record only means an empty or foreign transcript — resolution
 * then falls back to the default policy rather than failing a session that
 * could still run.
 */
export const modelOf = (entries: readonly SessionTreeEntry[]): Models.ModelRef | undefined => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "model_change") {
      return { providerId: entry.provider, modelId: entry.modelId };
    }
  }
  return undefined;
};

/**
 * Collects the attribution gate for one turn: the entries after the previous
 * snapshot up to and including this one.
 *
 * An absent index means the boundary entry is not in the transcript — `base`
 * never is — and widens the range to the corresponding end, which errs toward
 * claiming more rather than silently dropping a write.
 */
export const turnToolWrites = (
  entries: readonly SessionTreeEntry[],
  fromIndex: number | undefined,
  toIndex: number | undefined,
): TurnWrites => {
  const start = fromIndex === undefined ? 0 : fromIndex + 1;
  const end = toIndex === undefined ? entries.length - 1 : toIndex;

  let opaque = false;
  const declared = new Set<string>();
  for (let index = start; index <= end; index += 1) {
    const entry = entries[index];
    if (entry === undefined || entry.type !== "message") continue;
    if (entry.message.role !== "assistant" || typeof entry.message.content === "string") continue;
    for (const block of entry.message.content) {
      if (block.type !== "toolCall") continue;
      const writes = Tools.writesOf(block.name, block.arguments);
      if (writes.kind === "opaque") opaque = true;
      if (writes.kind === "declared") {
        for (const path of writes.paths) declared.add(normalizePath(path));
      }
    }
  }
  return { opaque, declared };
};

/**
 * Applies the gate: a declaring-only turn claims exactly the paths it named,
 * an opaque turn claims the whole diff. Filtering an opaque turn would
 * silently hide real writes, which is the one failure mode this read must
 * never have.
 */
export const gateTurnFiles = (
  files: readonly Git.FileChange[],
  writes: TurnWrites,
): readonly Git.FileChange[] => {
  if (writes.opaque) return files;
  return files.filter((file) => writes.declared.has(normalizePath(file.file)));
};

/** Aligns a tool-argument path with the workspace-relative form git reports. */
const normalizePath = (path: string): string => {
  let value = path;
  while (value.startsWith("./")) value = value.slice(2);
  return value;
};
