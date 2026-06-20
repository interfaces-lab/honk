import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { AgentModelPolicy } from "@honk/contracts";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

export const CODEX_APPLY_PATCH_TOOL_NAME = "apply_patch";

const OPENAI_PROVIDER_IDS: ReadonlySet<string> = new Set(["openai", "openai-codex"]);
const BEGIN_PATCH = "*** Begin Patch";
const END_PATCH = "*** End Patch";
const UNIFIED_DIFF_CONTEXT_LINES = 3;
const MAX_DIFF_ANCHOR_RECURSION_DEPTH = 128;

const ApplyPatchParams = Type.Object({
  input: Type.String({
    description:
      "Full Codex patch text. Use *** Begin Patch / *** End Patch with Add/Update/Delete File sections.",
  }),
});

interface PatchLine {
  readonly marker: " " | "+" | "-";
  readonly text: string;
}

interface PatchHunk {
  readonly header: string;
  readonly lines: readonly PatchLine[];
  readonly endOfFile: boolean;
}

interface AddPatchAction {
  readonly type: "add";
  readonly path: string;
  readonly lines: readonly string[];
}

interface DeletePatchAction {
  readonly type: "delete";
  readonly path: string;
}

interface UpdatePatchAction {
  readonly type: "update";
  readonly path: string;
  readonly movePath?: string | undefined;
  readonly hunks: readonly PatchHunk[];
}

type PatchAction = AddPatchAction | DeletePatchAction | UpdatePatchAction;

interface ParsedPatch {
  readonly actions: readonly PatchAction[];
}

interface ApplyPatchResultSummary {
  readonly changedFiles: readonly string[];
  readonly createdFiles: readonly string[];
  readonly deletedFiles: readonly string[];
  readonly movedFiles: readonly string[];
  readonly fuzz: number;
}

interface ApplyPatchSuccessDetails {
  readonly status: "success";
  readonly result: ApplyPatchResultSummary;
  readonly patch?: string | undefined;
  readonly diff?: string | undefined;
}

interface ApplyPatchPartialFailureDetails {
  readonly status: "partial_failure";
  readonly result: ApplyPatchResultSummary;
  readonly error: string;
  readonly failedFiles: readonly string[];
  readonly appliedFiles: readonly string[];
  readonly recoveryInstructions: {
    readonly mustReadFiles: readonly string[];
    readonly mustNotReadFiles: readonly string[];
  };
  readonly patch?: string | undefined;
  readonly diff?: string | undefined;
}

type ApplyPatchDetails = ApplyPatchSuccessDetails | ApplyPatchPartialFailureDetails;

interface ApplyPatchState {
  readonly cwd: string;
  readonly unifiedDiffs: string[];
  readonly changedFiles: Set<string>;
  readonly createdFiles: Set<string>;
  readonly deletedFiles: Set<string>;
  readonly movedFiles: Set<string>;
  fuzz: number;
}

interface ResolvedPatchPath {
  readonly absolutePath: string;
  readonly relativePath: string;
}

type LineDiffSegment =
  | {
      readonly kind: "equal";
      readonly oldStart: number;
      readonly newStart: number;
      readonly lines: readonly string[];
    }
  | {
      readonly kind: "delete";
      readonly oldStart: number;
      readonly lines: readonly string[];
    }
  | {
      readonly kind: "add";
      readonly newStart: number;
      readonly lines: readonly string[];
    };

interface UnifiedDiffRow {
  readonly kind: "context" | "delete" | "add";
  readonly text: string;
  readonly oldLine?: number | undefined;
  readonly newLine?: number | undefined;
}

interface AppliedPatchHunk {
  readonly oldStart: number;
  readonly newStart: number;
  readonly oldCount: number;
  readonly newCount: number;
  readonly lines: readonly PatchLine[];
}

export function createCodexApplyPatchExtension(policy: AgentModelPolicy): ExtensionFactory {
  return (pi) => {
    if (!isCodexApplyPatchPolicy(policy)) {
      return;
    }

    pi.registerTool(
      defineTool({
        name: CODEX_APPLY_PATCH_TOOL_NAME,
        label: "apply_patch",
        description: "Apply a Codex-style patch to files in the current workspace.",
        promptSnippet: "Edit files with Codex apply_patch patches.",
        promptGuidelines: [
          "Use apply_patch for text-file edits, creates, deletes, and moves.",
          "Group related edits into one patch when the changed files are part of the same fix.",
          "After a partial failure, read only the failed files before retrying; earlier file actions were already applied.",
        ],
        parameters: ApplyPatchParams,
        executionMode: "sequential",
        prepareArguments: prepareApplyPatchArguments,
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
          throwIfAborted(signal);
          const details = await applyCodexPatch({
            cwd: ctx.cwd,
            patchText: params.input,
            signal,
          });
          return {
            content: [{ type: "text", text: summarizeApplyPatchDetails(details) }],
            details,
          };
        },
      }),
    );
  };
}

function isCodexApplyPatchPolicy(policy: AgentModelPolicy): boolean {
  if (policy.agentMode !== "deep" && policy.agentMode !== "rush") {
    return false;
  }
  if (policy.modelSelection.type !== "explicit") {
    return false;
  }
  return OPENAI_PROVIDER_IDS.has(String(policy.modelSelection.authProviderId));
}

function prepareApplyPatchArguments(args: unknown): { readonly input: string } {
  if (typeof args === "string") {
    return { input: args };
  }
  const record = asRecord(args);
  const input =
    stringField(record, "input") ??
    stringField(record, "patch") ??
    stringField(record, "patchText");
  if (input === undefined) {
    throw new Error("apply_patch requires a string input field.");
  }
  return { input };
}

export async function applyCodexPatch(input: {
  readonly cwd: string;
  readonly patchText: string;
  readonly signal?: AbortSignal | undefined;
}): Promise<ApplyPatchDetails> {
  const parsed = parseCodexPatch(input.patchText);
  const state = createApplyPatchState(input.cwd);

  for (const action of parsed.actions) {
    throwIfAborted(input.signal);
    try {
      await applyPatchAction(state, action);
    } catch (error) {
      const message = error instanceof Error ? error.message : "apply_patch failed.";
      if (state.changedFiles.size === 0) {
        throw new Error(`apply_patch failed: ${message}`);
      }

      const failedFiles = actionFilePaths(action);
      const result = summarizePatchState(state);
      const appliedFiles = result.changedFiles.filter((path) => !failedFiles.includes(path));
      const recoveryMessage = buildPartialFailureMessage(message, failedFiles, appliedFiles);
      const patch = createUnifiedDiff(state);
      return {
        status: "partial_failure",
        result,
        error: recoveryMessage,
        failedFiles,
        appliedFiles,
        recoveryInstructions: {
          mustReadFiles: failedFiles,
          mustNotReadFiles: appliedFiles,
        },
        ...(patch.length > 0 ? { patch } : {}),
      };
    }
  }

  const result = summarizePatchState(state);
  const patch = createUnifiedDiff(state);
  return {
    status: "success",
    result,
    ...(patch.length > 0 ? { patch } : {}),
  };
}

function createApplyPatchState(cwd: string): ApplyPatchState {
  return {
    cwd,
    unifiedDiffs: [],
    changedFiles: new Set(),
    createdFiles: new Set(),
    deletedFiles: new Set(),
    movedFiles: new Set(),
    fuzz: 0,
  };
}

async function applyPatchAction(state: ApplyPatchState, action: PatchAction): Promise<void> {
  switch (action.type) {
    case "add":
      return applyAddAction(state, action);
    case "delete":
      return applyDeleteAction(state, action);
    case "update":
      return applyUpdateAction(state, action);
  }
}

async function applyAddAction(state: ApplyPatchState, action: AddPatchAction): Promise<void> {
  const target = resolvePatchPath(state.cwd, action.path);
  const existing = await readTextFileOrNull(target.absolutePath);
  if (existing !== null) {
    throw new Error(`${target.relativePath} already exists.`);
  }

  const nextContent = joinFileLines(action.lines, action.lines.length > 0);
  await mkdir(dirname(target.absolutePath), { recursive: true });
  await writeFile(target.absolutePath, nextContent, "utf8");
  pushUnifiedDiff(state, formatFileDiff(target.relativePath, null, nextContent));
  state.createdFiles.add(target.relativePath);
  state.changedFiles.add(target.relativePath);
}

async function applyDeleteAction(state: ApplyPatchState, action: DeletePatchAction): Promise<void> {
  const target = resolvePatchPath(state.cwd, action.path);
  const existing = await readTextFileOrNull(target.absolutePath);
  if (existing === null) {
    throw new Error(`${target.relativePath} does not exist.`);
  }

  await rm(target.absolutePath, { force: false });
  pushUnifiedDiff(state, formatFileDiff(target.relativePath, existing, null));
  state.deletedFiles.add(target.relativePath);
  state.changedFiles.add(target.relativePath);
}

async function applyUpdateAction(state: ApplyPatchState, action: UpdatePatchAction): Promise<void> {
  const source = resolvePatchPath(state.cwd, action.path);
  const moveTarget = action.movePath ? resolvePatchPath(state.cwd, action.movePath) : null;

  const existing = await readTextFileOrNull(source.absolutePath);
  if (existing === null) {
    throw new Error(`${source.relativePath} does not exist.`);
  }
  if (moveTarget && moveTarget.absolutePath !== source.absolutePath) {
    const targetExisting = await readTextFileOrNull(moveTarget.absolutePath);
    if (targetExisting !== null) {
      throw new Error(`${moveTarget.relativePath} already exists.`);
    }
  }

  const originalHadFinalNewline = existing.endsWith("\n");
  const originalLineCount = splitFileLines(existing).length;
  let nextLines = splitFileLines(existing);
  let cursor = 0;
  const appliedHunks: AppliedPatchHunk[] = [];
  for (const hunk of action.hunks) {
    const lineOffset = nextLines.length - originalLineCount;
    const applied = applyPatchHunk(nextLines, hunk, cursor);
    appliedHunks.push({
      oldStart: Math.max(1, applied.matchIndex - lineOffset + 1),
      newStart: applied.matchIndex + 1,
      oldCount: hunk.lines.filter((line) => line.marker !== "+").length,
      newCount: hunk.lines.filter((line) => line.marker !== "-").length,
      lines: hunk.lines,
    });
    nextLines = applied.lines;
    cursor = applied.nextCursor;
    state.fuzz += applied.fuzz;
  }

  await writeFile(source.absolutePath, joinFileLines(nextLines, originalHadFinalNewline), "utf8");
  state.changedFiles.add(source.relativePath);

  if (moveTarget && moveTarget.absolutePath !== source.absolutePath) {
    await mkdir(dirname(moveTarget.absolutePath), { recursive: true });
    await rename(source.absolutePath, moveTarget.absolutePath);
    state.movedFiles.add(`${source.relativePath} -> ${moveTarget.relativePath}`);
    state.changedFiles.add(moveTarget.relativePath);
  }
  pushUnifiedDiff(
    state,
    formatAppliedUpdateDiff(
      source.relativePath,
      moveTarget?.relativePath ?? source.relativePath,
      appliedHunks,
    ),
  );
}

function applyPatchHunk(
  lines: readonly string[],
  hunk: PatchHunk,
  cursor: number,
): {
  readonly lines: string[];
  readonly nextCursor: number;
  readonly fuzz: number;
  readonly matchIndex: number;
} {
  const oldSequence = hunk.lines.filter((line) => line.marker !== "+").map((line) => line.text);
  const newSequence = hunk.lines.filter((line) => line.marker !== "-").map((line) => line.text);
  const anchorIndex = hunk.header ? findSectionAnchor(lines, hunk.header, cursor) : -1;
  const endSearchStart = Math.max(0, lines.length - oldSequence.length);
  const searchStart = hunk.endOfFile
    ? endSearchStart
    : oldSequence.length === 0 && anchorIndex !== -1
      ? anchorIndex + 1
      : cursor;
  const match =
    findSequence(lines, oldSequence, searchStart, linesEqual) ??
    (hunk.endOfFile ? null : findSequence(lines, oldSequence, 0, linesEqual)) ??
    findSequence(lines, oldSequence, searchStart, linesEqualTrimmed) ??
    (hunk.endOfFile ? null : findSequence(lines, oldSequence, 0, linesEqualTrimmed)) ??
    findSequence(lines, oldSequence, endSearchStart, linesEqual) ??
    findSequence(lines, oldSequence, 0, linesEqual) ??
    findSequence(lines, oldSequence, endSearchStart, linesEqualTrimmed) ??
    findSequence(lines, oldSequence, 0, linesEqualTrimmed);

  if (!match) {
    const target = hunk.header ? ` near ${hunk.header}` : "";
    throw new Error(`Could not find patch context${target}.`);
  }

  const nextLines = [...lines];
  nextLines.splice(match.index, oldSequence.length, ...newSequence);
  return {
    lines: nextLines,
    nextCursor: match.index + newSequence.length,
    fuzz: match.fuzzy ? 1 : 0,
    matchIndex: match.index,
  };
}

function findSequence(
  lines: readonly string[],
  sequence: readonly string[],
  start: number,
  equals: (left: string, right: string) => boolean,
): { readonly index: number; readonly fuzzy: boolean } | null {
  if (sequence.length === 0) {
    return { index: Math.max(0, Math.min(lines.length, start)), fuzzy: false };
  }

  const safeStart = Math.max(0, Math.min(lines.length, start));
  for (let index = safeStart; index <= lines.length - sequence.length; index += 1) {
    if (sequence.every((line, offset) => equals(lines[index + offset] ?? "", line))) {
      return { index, fuzzy: equals === linesEqualTrimmed };
    }
  }
  return null;
}

function findSectionAnchor(lines: readonly string[], target: string, start: number): number {
  const normalizedTarget = target.trim();
  if (!normalizedTarget) {
    return -1;
  }
  for (let index = Math.max(0, start); index < lines.length; index += 1) {
    if (lines[index]?.trim() === normalizedTarget) {
      return index;
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() === normalizedTarget) {
      return index;
    }
  }
  return -1;
}

function linesEqual(left: string, right: string): boolean {
  return left === right;
}

function linesEqualTrimmed(left: string, right: string): boolean {
  return left.trimEnd() === right.trimEnd();
}

function parseCodexPatch(text: string): ParsedPatch {
  const lines = patchEnvelope(text).split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  if (lines[0] !== BEGIN_PATCH) {
    throw new Error(`Patch must start with ${BEGIN_PATCH}.`);
  }

  const actions: PatchAction[] = [];
  let index = 1;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line === END_PATCH) {
      index += 1;
      break;
    }
    if (line.startsWith("*** Add File:")) {
      const parsed = parseAddAction(lines, index);
      actions.push(parsed.action);
      index = parsed.nextIndex;
      continue;
    }
    if (line.startsWith("*** Delete File:")) {
      actions.push({ type: "delete", path: parseActionPath(line, "*** Delete File:") });
      index += 1;
      continue;
    }
    if (line.startsWith("*** Update File:")) {
      const parsed = parseUpdateAction(lines, index);
      actions.push(parsed.action);
      index = parsed.nextIndex;
      continue;
    }
    throw new Error(`Invalid patch line: ${line}`);
  }

  if (index < lines.length) {
    const extra = lines.slice(index).join("\n").trim();
    if (extra.length > 0) {
      throw new Error("Patch has content after the end marker.");
    }
  }
  if (actions.length === 0) {
    throw new Error("Patch contains no file actions.");
  }
  return { actions };
}

function parseAddAction(
  lines: readonly string[],
  startIndex: number,
): { readonly action: AddPatchAction; readonly nextIndex: number } {
  const path = parseActionPath(lines[startIndex] ?? "", "*** Add File:");
  const addedLines: string[] = [];
  let index = startIndex + 1;
  while (index < lines.length && !isPatchBoundary(lines[index] ?? "")) {
    const line = lines[index] ?? "";
    if (!line.startsWith("+")) {
      throw new Error(`Invalid add-file line for ${path}: ${line}`);
    }
    addedLines.push(line.slice(1));
    index += 1;
  }
  return { action: { type: "add", path, lines: addedLines }, nextIndex: index };
}

function parseUpdateAction(
  lines: readonly string[],
  startIndex: number,
): { readonly action: UpdatePatchAction; readonly nextIndex: number } {
  const path = parseActionPath(lines[startIndex] ?? "", "*** Update File:");
  let index = startIndex + 1;
  let movePath: string | undefined;
  if ((lines[index] ?? "").startsWith("*** Move to:")) {
    movePath = parseActionPath(lines[index] ?? "", "*** Move to:");
    index += 1;
  }

  const hunks: PatchHunk[] = [];
  while (index < lines.length && !isPatchBoundary(lines[index] ?? "")) {
    const headerLine = lines[index] ?? "";
    if (!headerLine.startsWith("@@")) {
      throw new Error(`Invalid update hunk for ${path}: ${headerLine}`);
    }
    const parsed = parseHunk(lines, index);
    hunks.push(parsed.hunk);
    index = parsed.nextIndex;
  }
  if (!movePath && hunks.length === 0) {
    throw new Error(`Update patch for ${path} has no hunks.`);
  }
  return {
    action: { type: "update", path, ...(movePath ? { movePath } : {}), hunks },
    nextIndex: index,
  };
}

function parseHunk(
  lines: readonly string[],
  startIndex: number,
): { readonly hunk: PatchHunk; readonly nextIndex: number } {
  const headerLine = lines[startIndex] ?? "";
  const header = headerLine.slice(2).trim();
  const hunkLines: PatchLine[] = [];
  let endOfFile = false;
  let index = startIndex + 1;

  while (
    index < lines.length &&
    !isPatchBoundary(lines[index] ?? "") &&
    !(lines[index] ?? "").startsWith("@@")
  ) {
    const line = lines[index] ?? "";
    if (line === "*** End of File") {
      endOfFile = true;
      index += 1;
      break;
    }
    if (line === "") {
      hunkLines.push({ marker: " ", text: "" });
      index += 1;
      continue;
    }
    const marker = line[0];
    if (marker !== " " && marker !== "+" && marker !== "-") {
      throw new Error(`Invalid hunk line: ${line}`);
    }
    hunkLines.push({ marker, text: line.slice(1) });
    index += 1;
  }

  if (hunkLines.length === 0) {
    throw new Error(`Patch hunk ${headerLine} has no changes or context.`);
  }
  return { hunk: { header, lines: hunkLines, endOfFile }, nextIndex: index };
}

function patchEnvelope(text: string): string {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  const begin = normalized.indexOf(BEGIN_PATCH);
  const end = normalized.lastIndexOf(END_PATCH);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`Patch must include ${BEGIN_PATCH} and ${END_PATCH}.`);
  }
  return normalized.slice(begin, end + END_PATCH.length);
}

function parseActionPath(line: string, prefix: string): string {
  const path = line.slice(prefix.length).trim();
  if (!path) {
    throw new Error(`${prefix} requires a path.`);
  }
  return path;
}

function isPatchBoundary(line: string): boolean {
  return (
    line === END_PATCH ||
    line.startsWith("*** Add File:") ||
    line.startsWith("*** Delete File:") ||
    line.startsWith("*** Update File:")
  );
}

function resolvePatchPath(cwd: string, patchPath: string): ResolvedPatchPath {
  const absolutePath = isAbsolute(patchPath) ? resolve(patchPath) : resolve(cwd, patchPath);
  const relativePath = relative(cwd, absolutePath);
  if (relativePath.length === 0 || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Patch path is outside the workspace: ${patchPath}`);
  }
  return { absolutePath, relativePath };
}

async function readTextFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function splitFileLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function joinFileLines(lines: readonly string[], finalNewline: boolean): string {
  if (lines.length === 0) {
    return finalNewline ? "\n" : "";
  }
  return `${lines.join("\n")}${finalNewline ? "\n" : ""}`;
}

function summarizePatchState(state: ApplyPatchState): ApplyPatchResultSummary {
  return {
    changedFiles: [...state.changedFiles],
    createdFiles: [...state.createdFiles],
    deletedFiles: [...state.deletedFiles],
    movedFiles: [...state.movedFiles],
    fuzz: state.fuzz,
  };
}

function pushUnifiedDiff(state: ApplyPatchState, diff: string): void {
  if (diff.trim().length > 0) {
    state.unifiedDiffs.push(diff);
  }
}

function createUnifiedDiff(state: ApplyPatchState): string {
  return state.unifiedDiffs.join("\n");
}

function formatAppliedUpdateDiff(
  oldPath: string,
  newPath: string,
  hunks: readonly AppliedPatchHunk[],
): string {
  if (hunks.length === 0) {
    return "";
  }

  return [
    `diff --git a/${oldPath} b/${newPath}`,
    `--- a/${oldPath}`,
    `+++ b/${newPath}`,
    ...hunks.map(formatAppliedHunk),
  ].join("\n");
}

function formatAppliedHunk(hunk: AppliedPatchHunk): string {
  return [
    `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
    ...hunk.lines.map(formatPatchLine),
  ].join("\n");
}

function formatPatchLine(line: PatchLine): string {
  return `${line.marker}${line.text}`;
}

export function formatFileDiff(
  path: string,
  oldContent: string | null,
  newContent: string | null,
): string {
  const oldLines = oldContent === null ? [] : splitFileLines(oldContent);
  const newLines = newContent === null ? [] : splitFileLines(newContent);
  const rows = buildUnifiedDiffRows(diffLineSegments(oldLines, newLines));
  const hunks = formatUnifiedDiffHunks(rows);
  if (hunks.length === 0) {
    return "";
  }

  const oldLabel = oldContent === null ? "/dev/null" : `a/${path}`;
  const newLabel = newContent === null ? "/dev/null" : `b/${path}`;
  return [
    `diff --git a/${path} b/${path}`,
    `--- ${oldLabel}`,
    `+++ ${newLabel}`,
    ...hunks,
  ].join("\n");
}

function diffLineSegments(
  oldLines: readonly string[],
  newLines: readonly string[],
): LineDiffSegment[] {
  return mergeLineDiffSegments(
    diffLineRange(oldLines, newLines, 0, oldLines.length, 0, newLines.length, 0),
  );
}

function diffLineRange(
  oldLines: readonly string[],
  newLines: readonly string[],
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number,
  depth: number,
): LineDiffSegment[] {
  const segments: LineDiffSegment[] = [];

  let nextOldStart = oldStart;
  let nextNewStart = newStart;
  while (
    nextOldStart < oldEnd &&
    nextNewStart < newEnd &&
    oldLines[nextOldStart] === newLines[nextNewStart]
  ) {
    nextOldStart += 1;
    nextNewStart += 1;
  }

  if (nextOldStart > oldStart) {
    segments.push({
      kind: "equal",
      oldStart,
      newStart,
      lines: oldLines.slice(oldStart, nextOldStart),
    });
  }

  let nextOldEnd = oldEnd;
  let nextNewEnd = newEnd;
  while (
    nextOldEnd > nextOldStart &&
    nextNewEnd > nextNewStart &&
    oldLines[nextOldEnd - 1] === newLines[nextNewEnd - 1]
  ) {
    nextOldEnd -= 1;
    nextNewEnd -= 1;
  }

  if (nextOldStart === nextOldEnd && nextNewStart === nextNewEnd) {
    // Only prefix/suffix equality remained.
  } else if (nextOldStart === nextOldEnd) {
    segments.push({
      kind: "add",
      newStart: nextNewStart,
      lines: newLines.slice(nextNewStart, nextNewEnd),
    });
  } else if (nextNewStart === nextNewEnd) {
    segments.push({
      kind: "delete",
      oldStart: nextOldStart,
      lines: oldLines.slice(nextOldStart, nextOldEnd),
    });
  } else {
    const anchor =
      depth < MAX_DIFF_ANCHOR_RECURSION_DEPTH
        ? findUniqueLineAnchor(
            oldLines,
            newLines,
            nextOldStart,
            nextOldEnd,
            nextNewStart,
            nextNewEnd,
          )
        : null;
    if (anchor) {
      segments.push(
        ...diffLineRange(
          oldLines,
          newLines,
          nextOldStart,
          anchor.oldIndex,
          nextNewStart,
          anchor.newIndex,
          depth + 1,
        ),
      );
      segments.push({
        kind: "equal",
        oldStart: anchor.oldIndex,
        newStart: anchor.newIndex,
        lines: [oldLines[anchor.oldIndex] ?? ""],
      });
      segments.push(
        ...diffLineRange(
          oldLines,
          newLines,
          anchor.oldIndex + 1,
          nextOldEnd,
          anchor.newIndex + 1,
          nextNewEnd,
          depth + 1,
        ),
      );
    } else {
      segments.push({
        kind: "delete",
        oldStart: nextOldStart,
        lines: oldLines.slice(nextOldStart, nextOldEnd),
      });
      segments.push({
        kind: "add",
        newStart: nextNewStart,
        lines: newLines.slice(nextNewStart, nextNewEnd),
      });
    }
  }

  if (nextOldEnd < oldEnd) {
    segments.push({
      kind: "equal",
      oldStart: nextOldEnd,
      newStart: nextNewEnd,
      lines: oldLines.slice(nextOldEnd, oldEnd),
    });
  }

  return mergeLineDiffSegments(segments);
}

function findUniqueLineAnchor(
  oldLines: readonly string[],
  newLines: readonly string[],
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number,
): { readonly oldIndex: number; readonly newIndex: number } | null {
  const oldOccurrences = countLineOccurrences(oldLines, oldStart, oldEnd);
  const newOccurrences = countLineOccurrences(newLines, newStart, newEnd);
  const oldMiddle = oldStart + (oldEnd - oldStart) / 2;
  const newMiddle = newStart + (newEnd - newStart) / 2;
  let bestAnchor: {
    readonly oldIndex: number;
    readonly newIndex: number;
    readonly score: number;
  } | null = null;

  for (const [line, oldOccurrence] of oldOccurrences) {
    if (oldOccurrence.count !== 1) {
      continue;
    }
    const newOccurrence = newOccurrences.get(line);
    if (!newOccurrence || newOccurrence.count !== 1) {
      continue;
    }
    const score =
      Math.abs(oldOccurrence.index - oldMiddle) + Math.abs(newOccurrence.index - newMiddle);
    if (!bestAnchor || score < bestAnchor.score) {
      bestAnchor = {
        oldIndex: oldOccurrence.index,
        newIndex: newOccurrence.index,
        score,
      };
    }
  }

  return bestAnchor ? { oldIndex: bestAnchor.oldIndex, newIndex: bestAnchor.newIndex } : null;
}

function countLineOccurrences(
  lines: readonly string[],
  start: number,
  end: number,
): Map<string, { count: number; index: number }> {
  const occurrences = new Map<string, { count: number; index: number }>();
  for (let index = start; index < end; index += 1) {
    const line = lines[index] ?? "";
    const current = occurrences.get(line);
    occurrences.set(line, {
      count: (current?.count ?? 0) + 1,
      index: current?.index ?? index,
    });
  }
  return occurrences;
}

function mergeLineDiffSegments(segments: readonly LineDiffSegment[]): LineDiffSegment[] {
  const merged: LineDiffSegment[] = [];
  for (const segment of segments) {
    if (segment.lines.length === 0) {
      continue;
    }
    const previous = merged.at(-1);
    if (previous && previous.kind === segment.kind) {
      if (previous.kind === "equal" && segment.kind === "equal") {
        merged[merged.length - 1] = {
          kind: "equal",
          oldStart: previous.oldStart,
          newStart: previous.newStart,
          lines: [...previous.lines, ...segment.lines],
        };
        continue;
      }
      if (previous.kind === "delete" && segment.kind === "delete") {
        merged[merged.length - 1] = {
          kind: "delete",
          oldStart: previous.oldStart,
          lines: [...previous.lines, ...segment.lines],
        };
        continue;
      }
      if (previous.kind === "add" && segment.kind === "add") {
        merged[merged.length - 1] = {
          kind: "add",
          newStart: previous.newStart,
          lines: [...previous.lines, ...segment.lines],
        };
        continue;
      }
    }
    merged.push(segment);
  }
  return merged;
}

function buildUnifiedDiffRows(segments: readonly LineDiffSegment[]): UnifiedDiffRow[] {
  const rows: UnifiedDiffRow[] = [];
  for (const segment of segments) {
    for (let offset = 0; offset < segment.lines.length; offset += 1) {
      const text = segment.lines[offset] ?? "";
      switch (segment.kind) {
        case "equal":
          rows.push({
            kind: "context",
            text,
            oldLine: segment.oldStart + offset + 1,
            newLine: segment.newStart + offset + 1,
          });
          break;
        case "delete":
          rows.push({
            kind: "delete",
            text,
            oldLine: segment.oldStart + offset + 1,
          });
          break;
        case "add":
          rows.push({
            kind: "add",
            text,
            newLine: segment.newStart + offset + 1,
          });
          break;
      }
    }
  }
  return rows;
}

function formatUnifiedDiffHunks(rows: readonly UnifiedDiffRow[]): string[] {
  const changedRowIndexes: number[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index]?.kind !== "context") {
      changedRowIndexes.push(index);
    }
  }
  if (changedRowIndexes.length === 0) {
    return [];
  }

  const hunks: string[] = [];
  let changedRowCursor = 0;
  while (changedRowCursor < changedRowIndexes.length) {
    const firstChangedRow = changedRowIndexes[changedRowCursor] ?? 0;
    let lastChangedRow = firstChangedRow;
    changedRowCursor += 1;

    while (changedRowCursor < changedRowIndexes.length) {
      const nextChangedRow = changedRowIndexes[changedRowCursor] ?? lastChangedRow;
      if (nextChangedRow - lastChangedRow > UNIFIED_DIFF_CONTEXT_LINES * 2 + 1) {
        break;
      }
      lastChangedRow = nextChangedRow;
      changedRowCursor += 1;
    }

    const hunkStart = Math.max(0, firstChangedRow - UNIFIED_DIFF_CONTEXT_LINES);
    const hunkEnd = Math.min(rows.length, lastChangedRow + UNIFIED_DIFF_CONTEXT_LINES + 1);
    hunks.push(formatUnifiedDiffHunk(rows, hunkStart, hunkEnd));
  }
  return hunks;
}

function formatUnifiedDiffHunk(
  rows: readonly UnifiedDiffRow[],
  start: number,
  end: number,
): string {
  const hunkRows = rows.slice(start, end);
  const oldCount = hunkRows.filter((row) => row.oldLine !== undefined).length;
  const newCount = hunkRows.filter((row) => row.newLine !== undefined).length;
  const oldStart = hunkStartLine(rows, start, hunkRows, "oldLine");
  const newStart = hunkStartLine(rows, start, hunkRows, "newLine");

  return [
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...hunkRows.map(formatUnifiedDiffRow),
  ].join("\n");
}

function hunkStartLine(
  rows: readonly UnifiedDiffRow[],
  hunkStart: number,
  hunkRows: readonly UnifiedDiffRow[],
  side: "oldLine" | "newLine",
): number {
  const firstLine = hunkRows.find((row) => row[side] !== undefined)?.[side];
  if (firstLine !== undefined) {
    return firstLine;
  }
  for (let index = hunkStart - 1; index >= 0; index -= 1) {
    const previousLine = rows[index]?.[side];
    if (previousLine !== undefined) {
      return previousLine;
    }
  }
  return 0;
}

function formatUnifiedDiffRow(row: UnifiedDiffRow): string {
  switch (row.kind) {
    case "context":
      return ` ${row.text}`;
    case "delete":
      return `-${row.text}`;
    case "add":
      return `+${row.text}`;
  }
}

function actionFilePaths(action: PatchAction): string[] {
  if (action.type === "update" && action.movePath) {
    return [action.path, action.movePath];
  }
  return [action.path];
}

function buildPartialFailureMessage(
  message: string,
  failedFiles: readonly string[],
  appliedFiles: readonly string[],
): string {
  const lines = [`apply_patch partially failed: ${message}`];
  if (failedFiles.length > 0) {
    lines.push(`Failed files: ${failedFiles.join(", ")}`);
    lines.push(`Recovery: MUST read ${failedFiles.join(", ")} before retrying.`);
  }
  if (appliedFiles.length > 0) {
    lines.push("Earlier file actions in this patch were already applied.");
    lines.push(
      "Recovery: MUST NOT reread other files from this patch unless a specific dependency requires it.",
    );
  }
  return lines.join("\n");
}

function summarizeApplyPatchDetails(details: ApplyPatchDetails): string {
  if (details.status === "partial_failure") {
    return details.error;
  }
  const result = details.result;
  return [
    "Applied patch successfully.",
    `Changed files: ${result.changedFiles.length}`,
    `Created files: ${result.createdFiles.length}`,
    `Deleted files: ${result.deletedFiles.length}`,
    `Moved files: ${result.movedFiles.length}`,
    `Fuzz: ${result.fuzz}`,
  ].join("\n");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("apply_patch aborted.");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}
