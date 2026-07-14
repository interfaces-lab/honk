// OpenCode ToolPart → the transcript's compact activity row. The SDK deliberately leaves tool
// inputs and metadata open-ended, so normalization lives behind guarded record readers here;
// render code consumes one stable view model instead of scattering unchecked casts per tool.

import * as stylex from "@stylexjs/stylex";
import { ToolCallLine, WorkGroup } from "@honk/ui";
import { colorVars, conversationVars, fontVars, radiusVars } from "@honk/ui/tokens.stylex";
import type { Part } from "@honk/opencode";
import * as React from "react";

type ToolPart = Extract<Part, { readonly type: "tool" }>;
type FilePart = Extract<Part, { readonly type: "file" }>;
type ToolCallState = "running" | "done" | "failed";
type ToolCategory = "edit" | "run" | "explore" | "delegate" | "plan" | "other";

type ToolView = {
  readonly verb: string;
  readonly detail?: string;
  readonly state: ToolCallState;
  readonly added: number;
  readonly removed: number;
  readonly body?: string;
};

const DETAIL_MAX_CHARS = 140;
const OUTPUT_MAX_CHARS = 2400;
// Tool-produced media stays a transcript attachment rather than growing into a workbench.
const TOOL_IMAGE_MAX_WIDTH = "240px";
const TOOL_IMAGE_MAX_HEIGHT = "160px";
const ATTACHMENT_RING = `inset 0 0 0 1px ${colorVars["--honk-color-border-base"]}`;

const styles = stylex.create({
  attachments: {
    display: "flex",
    flexWrap: "wrap",
    gap: conversationVars["--honk-conversation-step-gap"],
    paddingInline: conversationVars["--honk-conversation-inset"],
  },
  attachmentImage: {
    display: "block",
    maxWidth: TOOL_IMAGE_MAX_WIDTH,
    maxHeight: TOOL_IMAGE_MAX_HEIGHT,
    borderRadius: radiusVars["--honk-radius-control"],
    boxShadow: ATTACHMENT_RING,
    objectFit: "cover",
  },
  attachmentLink: {
    display: "inline-flex",
    minWidth: 0,
    maxWidth: TOOL_IMAGE_MAX_WIDTH,
    paddingBlock: conversationVars["--honk-conversation-row-gap"],
    paddingInline: conversationVars["--honk-conversation-step-gap"],
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    color: colorVars["--honk-color-fg-secondary"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-text-detail"],
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

function ToolMessage({
  part,
  allowDisclosure = true,
}: {
  readonly part: ToolPart;
  readonly allowDisclosure?: boolean;
}): React.ReactElement {
  const [isExpanded, setExpanded] = React.useState(
    () => part.tool === "question" || part.tool === "todowrite" || part.tool === "todoread",
  );
  const view = toolView(part);
  const hasBody = view.body !== undefined && view.body.length > 0;
  const attachments = part.state.status === "completed" ? (part.state.attachments ?? []) : [];
  const canExpand = allowDisclosure && (hasBody || attachments.length > 0);

  return (
    <>
      <ToolCallLine
        verb={view.verb}
        detail={view.detail}
        state={view.state}
        added={view.added}
        removed={view.removed}
        isExpanded={isExpanded}
        onToggle={
          canExpand
            ? () => {
                setExpanded((current) => !current);
              }
            : undefined
        }
      />
      {canExpand && isExpanded ? (
        <>
          {hasBody ? <WorkGroup.OutputStrip>{view.body}</WorkGroup.OutputStrip> : null}
          {attachments.length > 0 ? <ToolAttachments attachments={attachments} /> : null}
        </>
      ) : null}
    </>
  );
}

function ToolAttachments({
  attachments,
}: {
  readonly attachments: readonly FilePart[];
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.attachments)}>
      {attachments.map((attachment) => {
        const name = attachment.filename ?? fileUrlBasename(attachment.url);
        return attachment.mime.startsWith("image/") ? (
          <img
            key={attachment.id}
            src={attachment.url}
            alt={name}
            {...stylex.props(styles.attachmentImage)}
          />
        ) : (
          <a key={attachment.id} href={attachment.url} {...stylex.props(styles.attachmentLink)}>
            {name}
          </a>
        );
      })}
    </div>
  );
}

function fileUrlBasename(url: string): string {
  if (url.startsWith("data:")) {
    return "attachment";
  }
  const trimmed = url.replace(/^file:\/\//, "").replace(/[\\/]+$/, "");
  const [last = trimmed] = trimmed.split(/[\\/]/).slice(-1);
  return last.length > 0 ? last : url;
}

function toolView(part: ToolPart): ToolView {
  const stats = toolDiffStats(part);
  const detail = toolDetail(part);
  const body = toolOutput(part);
  return {
    verb: toolVerb(part),
    ...(detail !== undefined ? { detail } : {}),
    state: toolLineState(part),
    added: stats.added,
    removed: stats.removed,
    ...(body !== undefined ? { body } : {}),
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

function toolVerb(part: ToolPart): string {
  const isRunning = toolLineState(part) === "running";
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
      return isRunning ? "Delegating" : "Delegated";
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

  if (part.tool === "todowrite" || part.tool === "todoread") {
    const todos = recordArray(metadata, "todos") ?? recordArray(input, "todos");
    if (todos !== undefined) {
      const completed = todos.filter((todo) => stringField(todo, "status") === "completed").length;
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

  const structured = structuredToolOutput(part);
  if (structured !== undefined) {
    return truncateText(structured, OUTPUT_MAX_CHARS);
  }

  if (part.state.status === "completed" && part.state.output.length > 0) {
    return truncateText(part.state.output, OUTPUT_MAX_CHARS);
  }

  const metadataOutput = stringField(toolMetadata(part), "output");
  if (metadataOutput !== undefined) {
    return truncateText(metadataOutput, OUTPUT_MAX_CHARS);
  }

  if (part.state.status === "pending" && part.state.raw.trim().length > 0) {
    return truncateText(part.state.raw, OUTPUT_MAX_CHARS);
  }

  if (toolCategory(part.tool) === "other" && Object.keys(part.state.input).length > 0) {
    return truncateText(stringifyValue(part.state.input), OUTPUT_MAX_CHARS);
  }

  return undefined;
}

function structuredToolOutput(part: ToolPart): string | undefined {
  const input = part.state.input;
  const metadata = toolMetadata(part);

  if (part.tool === "todowrite" || part.tool === "todoread") {
    const todos = recordArray(metadata, "todos") ?? recordArray(input, "todos");
    if (todos !== undefined && todos.length > 0) {
      return todos
        .map((todo) => {
          const status = stringField(todo, "status");
          const content = stringField(todo, "content") ?? "Untitled task";
          return `${status === "completed" ? "[x]" : "[ ]"} ${content}`;
        })
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

  const fileDiff = recordField(metadata, "filediff");
  const patch = fileDiff === undefined ? undefined : stringField(fileDiff, "patch");
  return patch;
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

function toolMetadata(part: ToolPart): Record<string, unknown> {
  const stateMetadata =
    part.state.status === "running" ||
    part.state.status === "completed" ||
    part.state.status === "error"
      ? part.state.metadata
      : undefined;
  return { ...(part.metadata ?? {}), ...(stateMetadata ?? {}) };
}

function humanizeToolName(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (spaced.length === 0) {
    return "Tool call";
  }
  return spaced[0]?.toUpperCase() + spaced.slice(1);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function recordField(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  return record === undefined ? undefined : asRecord(record[key]);
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function unknownArray(
  record: Record<string, unknown> | undefined,
  key: string,
): readonly unknown[] | undefined {
  const value = record?.[key];
  return Array.isArray(value) ? value : undefined;
}

function recordArray(
  record: Record<string, unknown> | undefined,
  key: string,
): readonly Record<string, unknown>[] | undefined {
  const value = unknownArray(record, key);
  if (value === undefined) {
    return undefined;
  }
  return value.map(asRecord).filter((item): item is Record<string, unknown> => item !== undefined);
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

export {
  ToolMessage,
  toolCategory,
  toolDetail,
  toolDiffStats,
  toolLineState,
  toolOutput,
  toolVerb,
};
export type { ToolCategory, ToolPart, ToolView };
