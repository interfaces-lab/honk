// OpenCode leaves tool inputs open-ended. Normalize them behind guarded readers before rendering.

import type { ToolCallState } from "@honk/ui";

import { toolArtifact, type ToolArtifact } from "./tool-artifact-normalizer";
import {
  isTodoTool,
  numberField,
  recordArray,
  recordField,
  stringField,
  toolMetadata,
  toolTodos,
  unknownArray,
  type ToolPart,
} from "./tool-part-projection";

type ToolCategory = "edit" | "run" | "explore" | "delegate" | "plan" | "other";

type ToolView = {
  readonly verb: string;
  readonly detail?: string;
  readonly state: ToolCallState;
  readonly added: number;
  readonly removed: number;
  readonly body?: string;
  readonly artifact?: ToolArtifact;
};

const DETAIL_MAX_CHARS = 140;
const OUTPUT_MAX_CHARS = 2400;

function toolView(part: ToolPart): ToolView {
  const artifact = toolArtifact(part);
  const metadataStats = toolDiffStats(part);
  const artifactStats = artifact?.files.reduce(
    (total, file) => ({
      added: total.added + file.additions,
      removed: total.removed + file.deletions,
    }),
    { added: 0, removed: 0 },
  );
  const stats =
    metadataStats.added === 0 && metadataStats.removed === 0 && artifactStats !== undefined
      ? artifactStats
      : metadataStats;
  const detail =
    artifact?.kind === "source" && artifact.operation === "read"
      ? `${artifact.path} · lines ${String(artifact.lineStart)}–${String(artifact.lineEnd)}`
      : toolDetail(part);
  const body = artifact === undefined ? toolOutput(part) : undefined;
  return {
    verb: toolVerb(part),
    ...(detail === undefined ? {} : { detail }),
    state: toolLineState(part),
    added: stats.added,
    removed: stats.removed,
    ...(body === undefined ? {} : { body }),
    ...(artifact === undefined ? {} : { artifact }),
  };
}

function toolLineState(part: ToolPart): ToolCallState {
  switch (part.state.status) {
    case "pending":
    case "running":
      return "running";
    case "completed":
      return "done";
    case "error":
      return "failed";
  }
}

function toolVerb(part: ToolPart, state: ToolCallState = toolLineState(part)): string {
  const isRunning = state === "running";
  switch (part.tool) {
    case "bash":
      return isRunning ? "Running" : "Ran";
    case "read":
      return isRunning ? "Reading" : "Read";
    case "grep":
      return isRunning ? "Searching" : "Searched";
    case "glob":
    case "list":
      return isRunning ? "Finding" : "Found";
    case "edit":
    case "write":
    case "patch":
    case "apply_patch":
      return isRunning ? "Editing" : "Edited";
    case "webfetch":
      return isRunning ? "Fetching" : "Fetched";
    case "websearch":
      return isRunning ? "Searching web" : "Searched web";
    case "task":
      if (state === "failed") return "Work failed";
      return isRunning ? "Working" : "Completed";
    case "todowrite":
    case "todoread":
      return isRunning ? "Planning" : "Planned";
    case "question":
      return isRunning ? "Asking" : "Asked";
    case "plan_submit":
      return isRunning ? "Recording plan" : "Plan recorded";
    case "skill":
      return isRunning ? "Loading" : "Loaded";
    default: {
      const name = humanizeToolName(part.tool);
      return isRunning ? `Running ${name}` : name;
    }
  }
}

function toolCategory(tool: string): ToolCategory {
  switch (tool) {
    case "edit":
    case "write":
    case "patch":
    case "apply_patch":
      return "edit";
    case "bash":
      return "run";
    case "read":
    case "grep":
    case "glob":
    case "list":
    case "webfetch":
    case "websearch":
    case "skill":
      return "explore";
    case "task":
      return "delegate";
    case "todowrite":
    case "todoread":
    case "question":
    case "plan_submit":
      return "plan";
    default:
      return "other";
  }
}

function toolDetail(part: ToolPart): string | undefined {
  const input = part.state.input;
  const metadata = toolMetadata(part);

  if (isTodoTool(part.tool)) {
    const todos = toolTodos(part);
    if (todos !== undefined) {
      const completed = todos.filter((todo) => todo.status === "completed").length;
      return `${String(completed)}/${String(todos.length)} tasks`;
    }
  }

  if (part.tool === "question") {
    const questions = recordArray(input, "questions");
    if (questions !== undefined) {
      return `${String(questions.length)} ${questions.length === 1 ? "question" : "questions"}`;
    }
  }

  if (part.tool === "apply_patch") {
    const files = recordArray(metadata, "files");
    if (files !== undefined) {
      return `${String(files.length)} ${files.length === 1 ? "file" : "files"}`;
    }
  }

  if (part.tool === "task") {
    const description = stringField(input, "description") ?? stringField(input, "prompt");
    if (description !== undefined) return truncateText(description, DETAIL_MAX_CHARS);
  }

  if (part.state.status === "completed" || part.state.status === "running") {
    const title = part.state.title;
    if (title !== undefined && title.length > 0) {
      return truncateText(title, DETAIL_MAX_CHARS);
    }
  }

  const candidate =
    stringField(input, "command") ??
    stringField(input, "filePath") ??
    stringField(input, "path") ??
    stringField(input, "pattern") ??
    stringField(input, "query") ??
    stringField(input, "url") ??
    stringField(input, "description") ??
    stringField(input, "name");
  return candidate === undefined ? undefined : truncateText(candidate, DETAIL_MAX_CHARS);
}

function toolOutput(part: ToolPart): string | undefined {
  if (part.state.status === "error") {
    return truncateText(part.state.error, OUTPUT_MAX_CHARS);
  }

  // Structured file artifacts own their complete output. Writes without an observed diff stay as
  // activity rows rather than inventing file history from their input.
  if (part.state.status === "completed" && isFileOperationTool(part.tool)) {
    return undefined;
  }

  const structured = structuredToolOutput(part);
  if (structured !== undefined) return truncateText(structured, OUTPUT_MAX_CHARS);

  if (part.state.status === "completed" && part.state.output.length > 0) {
    return truncateText(part.state.output, OUTPUT_MAX_CHARS);
  }

  const metadataOutput = stringField(toolMetadata(part), "output");
  if (metadataOutput !== undefined) return truncateTail(metadataOutput, OUTPUT_MAX_CHARS);

  if (part.state.status === "pending" && part.state.raw.trim().length > 0) {
    return truncateTail(part.state.raw, OUTPUT_MAX_CHARS);
  }

  if (toolCategory(part.tool) === "other" && Object.keys(part.state.input).length > 0) {
    return truncateText(stringifyValue(part.state.input), OUTPUT_MAX_CHARS);
  }

  return undefined;
}

function isFileOperationTool(tool: string): boolean {
  return (
    tool === "read" ||
    tool === "edit" ||
    tool === "write" ||
    tool === "patch" ||
    tool === "apply_patch"
  );
}

function structuredToolOutput(part: ToolPart): string | undefined {
  const input = part.state.input;
  const metadata = toolMetadata(part);

  if (isTodoTool(part.tool)) {
    const todos = toolTodos(part);
    if (todos !== undefined && todos.length > 0) {
      return todos
        .map((todo) => `${todo.status === "completed" ? "[x]" : "[ ]"} ${todo.content}`)
        .join("\n");
    }
  }

  if (part.tool === "question") {
    const questions = recordArray(input, "questions");
    const answers = unknownArray(metadata, "answers");
    if (questions !== undefined && questions.length > 0) {
      return questions
        .map((question, index) => {
          const prompt = stringField(question, "question") ?? `Question ${String(index + 1)}`;
          const answer = answers?.[index];
          const answerText = Array.isArray(answer)
            ? answer.filter((item): item is string => typeof item === "string").join(", ")
            : undefined;
          return answerText !== undefined && answerText.length > 0
            ? `${prompt}\n${answerText}`
            : prompt;
        })
        .join("\n\n");
    }
  }

  if (part.tool === "apply_patch") {
    const files = recordArray(metadata, "files");
    if (files !== undefined && files.length > 0) {
      return files
        .map((file) => {
          const path = stringField(file, "relativePath") ?? stringField(file, "filePath") ?? "file";
          const added = numberField(file, "additions") ?? 0;
          const removed = numberField(file, "deletions") ?? 0;
          return `${path}  +${String(added)} -${String(removed)}`;
        })
        .join("\n");
    }
  }

  return undefined;
}

function toolDiffStats(part: ToolPart): { readonly added: number; readonly removed: number } {
  const metadata = toolMetadata(part);
  const fileDiff = recordField(metadata, "filediff");
  const files = recordArray(metadata, "files");

  if (files !== undefined) {
    return files.reduce<{ added: number; removed: number }>(
      (total, file) => ({
        added: total.added + (numberField(file, "additions") ?? 0),
        removed: total.removed + (numberField(file, "deletions") ?? 0),
      }),
      { added: 0, removed: 0 },
    );
  }

  return {
    added:
      numberField(fileDiff, "additions") ??
      numberField(metadata, "additions") ??
      numberField(metadata, "linesAdded") ??
      0,
    removed:
      numberField(fileDiff, "deletions") ??
      numberField(metadata, "deletions") ??
      numberField(metadata, "linesRemoved") ??
      0,
  };
}

function humanizeToolName(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (spaced.length === 0) return "Tool call";
  return spaced[0]?.toUpperCase() + spaced.slice(1);
}

function stringifyValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

function truncateTail(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `…${text.slice(-maxChars)}`;
}

export { toolCategory, toolDetail, toolOutput, toolVerb, toolView };
export type { ToolCategory, ToolView };
