/**
 * Parsers for git's machine-readable output.
 *
 * Every function here is pure and total: strings in, values out, no Effect and
 * no filesystem. All the diff readers use `-z`, so paths arrive NUL-delimited
 * and unquoted — a filename containing a space, a quote, or a newline parses
 * the same as any other.
 *
 * @module
 */

import type { Branch, ChangeStatus, FileChange } from "./contract";

/** TAB-separated because a git ref may contain neither a tab nor a newline. */
export const REF_FORMAT = "%(refname)\t%(HEAD)\t%(upstream:short)";

/** Extensions a client can render as an image, mapped to their media type. */
const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

/** Maps a file extension to a media type, defaulting to opaque bytes. */
export function mediaTypeOf(file: string): string {
  const dot = file.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return IMAGE_MEDIA_TYPES[file.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

/** Base64 arrives line-wrapped on some platforms and not others. */
export function stripWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, "");
}

/** Stable listing order for change sets: by path, on code units. */
export function byFile(left: FileChange, right: FileChange): number {
  return left.file < right.file ? -1 : 1;
}

/** Splits NUL-delimited git output, dropping the trailing empty record. */
function splitNul(output: string): readonly string[] {
  return output.split("\0").filter((record) => record.length > 0);
}

/** One `--numstat` row: additions, deletions, and whether git called it binary. */
export interface Count {
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
}

const NO_COUNT: Count = { additions: 0, deletions: 0, binary: false };

/**
 * Indexes `--numstat -z` output by the path git reported.
 *
 * A record is `additions TAB deletions TAB path`. The path is joined back from
 * the remaining fields rather than taken as the third, because a filename may
 * contain a tab even though it may not contain a NUL.
 */
export function parseNumstat(output: string): ReadonlyMap<string, Count> {
  const counts = new Map<string, Count>();
  for (const record of splitNul(output)) {
    const fields = record.split("\t");
    const additions = fields[0];
    const deletions = fields[1];
    if (additions === undefined || deletions === undefined || fields.length < 3) continue;
    const file = fields.slice(2).join("\t");
    if (file.length === 0) continue;
    counts.set(file, toCount(additions, deletions));
  }
  return counts;
}

/** Reads the counts from the first `--numstat` record and ignores its path. */
export function firstNumstat(output: string): Count {
  const record = splitNul(output)[0];
  if (record === undefined) return NO_COUNT;
  const fields = record.split("\t");
  const additions = fields[0];
  const deletions = fields[1];
  if (additions === undefined || deletions === undefined) return NO_COUNT;
  return toCount(additions, deletions);
}

/** Git writes `-` for a file it will not count, which is how binaries appear. */
function toCount(additions: string, deletions: string): Count {
  if (additions === "-" || deletions === "-") return { ...NO_COUNT, binary: true };
  return {
    additions: toInteger(additions),
    deletions: toInteger(deletions),
    binary: false,
  };
}

function toInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Reads `--name-status -z` output, whose records alternate status then path.
 *
 * `--no-renames` is what makes the pairing safe: a rename record carries two
 * paths, and this shape has none.
 */
export function parseNameStatus(output: string): readonly { file: string; status: ChangeStatus }[] {
  const records = splitNul(output);
  const entries: { file: string; status: ChangeStatus }[] = [];
  for (let index = 0; index + 1 < records.length; index += 2) {
    const code = records[index];
    const file = records[index + 1];
    if (code === undefined || file === undefined) continue;
    entries.push({ file, status: changeStatusOf(code) });
  }
  return entries;
}

/**
 * Maps a git status letter onto Honk's three outcomes.
 *
 * `T` (type change) and `U` (unmerged) fold into `modified`: the path exists on
 * both sides and differs, which is what a reviewer needs to know.
 */
function changeStatusOf(code: string): ChangeStatus {
  const letter = code.charAt(0);
  if (letter === "A") return "added";
  if (letter === "D") return "deleted";
  return "modified";
}

/**
 * Picks the untracked paths out of `status --porcelain=v1 -z`.
 *
 * Each record is two status characters, a space, then the path. `??` is git's
 * code for a path it has never seen.
 */
export function parseUntracked(output: string): readonly string[] {
  const files: string[] = [];
  for (const record of splitNul(output)) {
    if (!record.startsWith("?? ")) continue;
    const file = record.slice(3);
    if (file.length > 0) files.push(file);
  }
  return files;
}

/**
 * Reads `for-each-ref` output in {@link REF_FORMAT}.
 *
 * `origin/HEAD` is skipped: it is a symbolic pointer at another branch in the
 * list, not a branch a client can check out.
 */
export function parseRefs(output: string): readonly Branch[] {
  const branches: Branch[] = [];
  for (const line of output.split("\n")) {
    if (line.length === 0) continue;
    const fields = line.split("\t");
    const refname = fields[0];
    if (refname === undefined) continue;
    const remote = refname.startsWith("refs/remotes/");
    const name = remote
      ? refname.slice("refs/remotes/".length)
      : refname.slice("refs/heads/".length);
    if (name.length === 0 || name === "HEAD" || name.endsWith("/HEAD")) continue;
    const upstream = fields[2]?.trim() ?? "";
    branches.push({
      name,
      remote,
      current: fields[1] === "*",
      ...(upstream.length > 0 ? { upstream } : {}),
    });
  }
  return branches;
}
