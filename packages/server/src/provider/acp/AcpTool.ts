import type { ToolLifecycleItemType } from "@multi/contracts";
import { Predicate } from "effect";
import type * as EffectAcpSchema from "effect-acp/schema";

export type ToolInput = Record<string, unknown>;

export type ToolAttachment = {
  readonly mime?: string;
  readonly url?: string;
  readonly [key: string]: unknown;
};

export type CompletedToolState = {
  readonly status: "completed";
  readonly input: ToolInput;
  readonly output: string;
  readonly metadata?: unknown;
  readonly attachments?: ReadonlyArray<ToolAttachment>;
};

export type RunningToolState = {
  readonly status: "running";
  readonly input: ToolInput;
  readonly title?: string;
};

export type ErrorToolState = {
  readonly status: "error";
  readonly input: ToolInput;
  readonly error: string;
  readonly metadata?: unknown;
};

export type ImageAttachment = {
  readonly mimeType: string;
  readonly data: string;
};

export interface AcpToolCallState {
  readonly toolCallId: string;
  readonly kind?: string;
  readonly title?: string;
  readonly status?: "pending" | "inProgress" | "completed" | "failed";
  readonly command?: string;
  readonly detail?: string;
  readonly data: Record<string, unknown>;
}

export function toToolKind(toolName: string): EffectAcpSchema.ToolKind {
  const tool = toolName.toLocaleLowerCase();

  switch (tool) {
    case "bash":
    case "shell":
      return "execute";

    case "webfetch":
      return "fetch";

    case "edit":
    case "patch":
    case "write":
      return "edit";

    case "grep":
    case "glob":
    case "repo_clone":
    case "repo_overview":
    case "context":
    case "context7_resolve_library_id":
    case "context7_get_library_docs":
      return "search";

    case "read":
      return "read";

    default:
      return "other";
  }
}

export function toLocations(
  toolName: string,
  input: ToolInput,
): EffectAcpSchema.ToolCallLocation[] {
  const tool = toolName.toLocaleLowerCase();

  switch (tool) {
    case "read":
    case "edit":
    case "write":
      return locationFrom(input.filePath ?? input.filepath);

    case "grep":
    case "glob":
    case "repo_clone":
    case "repo_overview":
    case "context":
    case "context7_resolve_library_id":
    case "context7_get_library_docs":
      return locationFrom(input.path);

    case "bash":
    case "shell":
      return [];

    default:
      return [];
  }
}

export function completedToolContent(
  toolName: string,
  state: CompletedToolState,
): EffectAcpSchema.ToolCallContent[] {
  const content: EffectAcpSchema.ToolCallContent[] = [
    {
      type: "content",
      content: {
        type: "text",
        text: state.output,
      },
    },
  ];

  if (toToolKind(toolName) === "edit") {
    content.push(...diffContent(state.input));
  }

  content.push(...imageContents(state.attachments ?? []));
  return content;
}

export function pendingToolCall(input: {
  readonly toolCallId: string;
  readonly toolName: string;
}): EffectAcpSchema.ToolCall {
  return {
    toolCallId: input.toolCallId,
    title: input.toolName,
    kind: toToolKind(input.toolName),
    status: "pending",
    locations: [],
    rawInput: {},
  };
}

export function runningToolUpdate(input: {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly state: RunningToolState;
  readonly output?: string;
}): EffectAcpSchema.ToolCallUpdate {
  const content: EffectAcpSchema.ToolCallContent[] | undefined = input.output
    ? [
        {
          type: "content",
          content: {
            type: "text",
            text: input.output,
          },
        },
      ]
    : undefined;

  return {
    toolCallId: input.toolCallId,
    status: "in_progress",
    kind: toToolKind(input.toolName),
    title: input.state.title ?? input.toolName,
    locations: toLocations(input.toolName, input.state.input),
    rawInput: input.state.input,
    ...(content ? { content } : {}),
  };
}

export function duplicateRunningToolUpdate(input: {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly state: RunningToolState;
}): EffectAcpSchema.ToolCallUpdate {
  return {
    toolCallId: input.toolCallId,
    status: "in_progress",
    kind: toToolKind(input.toolName),
    title: input.state.title ?? input.toolName,
    locations: toLocations(input.toolName, input.state.input),
    rawInput: input.state.input,
  };
}

export function completedToolUpdate(input: {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly state: CompletedToolState & { readonly title: string };
}): EffectAcpSchema.ToolCallUpdate {
  return {
    toolCallId: input.toolCallId,
    status: "completed",
    kind: toToolKind(input.toolName),
    title: input.state.title,
    content: completedToolContent(input.toolName, input.state),
    rawInput: input.state.input,
    rawOutput: completedToolRawOutput(input.state),
  };
}

export function errorToolUpdate(input: {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly state: ErrorToolState;
}): EffectAcpSchema.ToolCallUpdate {
  return {
    toolCallId: input.toolCallId,
    status: "failed",
    kind: toToolKind(input.toolName),
    title: input.toolName,
    rawInput: input.state.input,
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: input.state.error,
        },
      },
    ],
    rawOutput: {
      error: input.state.error,
      metadata: input.state.metadata,
    },
  };
}

export function completedToolRawOutput(state: CompletedToolState): {
  readonly output: string;
  readonly metadata?: unknown;
  readonly attachments?: ReadonlyArray<ToolAttachment>;
} {
  return {
    output: state.output,
    ...(state.metadata !== undefined ? { metadata: state.metadata } : {}),
    ...(state.attachments?.length ? { attachments: state.attachments } : {}),
  };
}

export function imageContents(
  attachments: ReadonlyArray<ToolAttachment>,
): EffectAcpSchema.ToolCallContent[] {
  return extractImageAttachments(attachments).map((attachment): EffectAcpSchema.ToolCallContent => {
    return {
      type: "content",
      content: {
        type: "image",
        mimeType: attachment.mimeType,
        data: attachment.data,
      },
    };
  });
}

export function extractImageAttachments(
  attachments: ReadonlyArray<ToolAttachment>,
): ImageAttachment[] {
  return attachments.flatMap((attachment): ImageAttachment[] => {
    const data = dataUrlImage(attachment);
    return data ? [data] : [];
  });
}

export function shellOutputSnapshot(state: { readonly metadata?: unknown }): string | undefined {
  if (!state.metadata || typeof state.metadata !== "object") return undefined;
  return stringValue((state.metadata as Record<string, unknown>).output);
}

export function makeAcpToolCallState(
  input: {
    readonly toolCallId: string;
    readonly title?: string | null | undefined;
    readonly kind?: EffectAcpSchema.ToolKind | null | undefined;
    readonly status?: EffectAcpSchema.ToolCallStatus | null | undefined;
    readonly rawInput?: unknown;
    readonly rawOutput?: unknown;
    readonly content?: ReadonlyArray<EffectAcpSchema.ToolCallContent> | null | undefined;
    readonly locations?: ReadonlyArray<EffectAcpSchema.ToolCallLocation> | null | undefined;
  },
  options?: {
    readonly fallbackStatus?: "pending" | "inProgress" | "completed" | "failed";
  },
): AcpToolCallState | undefined {
  const toolCallId = input.toolCallId.trim();
  if (!toolCallId) {
    return undefined;
  }
  const title = input.title?.trim() || undefined;
  const command = extractToolCallCommand(input.rawInput, title);
  const textContent = extractTextContentFromToolCallContent(input.content);
  const normalizedTitle =
    title && title.toLowerCase() !== "terminal" && title.toLowerCase() !== "tool call"
      ? title
      : undefined;
  const data: Record<string, unknown> = { toolCallId };
  const kind = normalizeAcpToolKind(input.kind);
  if (kind) {
    data.kind = kind;
  }
  if (command) {
    data.command = command;
  }
  if (input.rawInput !== undefined) {
    data.rawInput = input.rawInput;
  }
  if (input.rawOutput !== undefined) {
    data.rawOutput = input.rawOutput;
  }
  if (input.content !== undefined) {
    data.content = input.content;
  }
  if (input.locations !== undefined) {
    data.locations = input.locations;
  }
  const fallbackDetail = command ?? normalizedTitle ?? textContent;
  const hasPresentationSeed =
    title !== undefined ||
    kind !== undefined ||
    command !== undefined ||
    normalizedTitle !== undefined ||
    textContent !== undefined;
  const presentation = hasPresentationSeed
    ? deriveToolActivityPresentation({
        itemType: canonicalItemTypeFromAcpToolKind(kind),
        title,
        detail: fallbackDetail,
        data,
        fallbackSummary: title ?? "Tool",
      })
    : undefined;
  const status = normalizeAcpToolCallStatus(input.status, options?.fallbackStatus);
  return {
    toolCallId,
    ...(kind ? { kind } : {}),
    ...(presentation?.summary ? { title: presentation.summary } : {}),
    ...(status ? { status } : {}),
    ...(command ? { command } : {}),
    ...(presentation?.detail ? { detail: presentation.detail } : {}),
    data,
  };
}

export function mergeAcpToolCallState(
  previous: AcpToolCallState | undefined,
  next: AcpToolCallState,
): AcpToolCallState {
  const nextKind = typeof next.data.kind === "string" ? next.data.kind : undefined;
  const kind = nextKind ?? previous?.kind;
  const title = next.title ?? previous?.title;
  const status = next.status ?? previous?.status;
  const command = next.command ?? previous?.command;
  const detail = next.detail ?? previous?.detail;
  return {
    toolCallId: next.toolCallId,
    ...(kind ? { kind } : {}),
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(command ? { command } : {}),
    ...(detail ? { detail } : {}),
    data: {
      ...previous?.data,
      ...next.data,
    },
  };
}

export function normalizeAcpToolKind(kind: unknown): string | undefined {
  return typeof kind === "string" && kind.trim().length > 0 ? kind.trim() : undefined;
}

export const mapToolKind = toToolKind;
export const extractLocations = toLocations;
export const buildCompletedToolContent = completedToolContent;
export const buildCompletedRawOutput = completedToolRawOutput;
export const extractShellOutputSnapshot = shellOutputSnapshot;
export const buildPendingToolCall = pendingToolCall;
export const buildRunningToolUpdate = runningToolUpdate;
export const buildDuplicateRunningToolUpdate = duplicateRunningToolUpdate;
export const buildCompletedToolUpdate = completedToolUpdate;
export const buildErrorToolUpdate = errorToolUpdate;

function locationFrom(value: unknown): EffectAcpSchema.ToolCallLocation[] {
  const path = stringValue(value);
  return path ? [{ path }] : [];
}

function diffContent(input: ToolInput): EffectAcpSchema.ToolCallContent[] {
  const oldText = stringValue(input.oldString);
  const newText = stringValue(input.newString) ?? stringValue(input.content);
  if (oldText === undefined || newText === undefined) return [];

  return [
    {
      type: "diff",
      path: stringValue(input.filePath) ?? "",
      oldText,
      newText,
    },
  ];
}

function dataUrlImage(attachment: ToolAttachment): ImageAttachment | undefined {
  const match = stringValue(attachment.url)?.match(/^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$/);
  const mime = match?.[1] ?? stringValue(attachment.mime);
  if (!mime?.startsWith("image/")) return undefined;

  const data = match?.[2];
  if (data === undefined) return undefined;
  return { mimeType: mime, data };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeAcpToolCallStatus(
  raw: unknown,
  fallback?: "pending" | "inProgress" | "completed" | "failed",
): "pending" | "inProgress" | "completed" | "failed" | undefined {
  switch (raw) {
    case "pending":
      return "pending";
    case "in_progress":
    case "inProgress":
      return "inProgress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return fallback;
  }
}

function extractToolCallCommand(rawInput: unknown, title: string | undefined): string | undefined {
  const rawInputRecord = asRecord(rawInput);
  if (rawInputRecord) {
    const directCommand = normalizeCommandValue(rawInputRecord.command);
    if (directCommand) {
      return directCommand;
    }
    const executable = asTrimmedString(rawInputRecord.executable);
    const args = normalizeCommandValue(rawInputRecord.args);
    if (executable && args) {
      return `${executable} ${args}`;
    }
    if (executable) {
      return executable;
    }
  }
  return extractCommandFromTitle(title);
}

function extractTextContentFromToolCallContent(
  content: ReadonlyArray<EffectAcpSchema.ToolCallContent> | null | undefined,
): string | undefined {
  if (!content) return undefined;
  const chunks = content
    .map((entry) => {
      if (entry.type !== "content") {
        return undefined;
      }
      const nestedContent = entry.content;
      if (nestedContent.type !== "text") {
        return undefined;
      }
      return nestedContent.text.trim().length > 0 ? nestedContent.text.trim() : undefined;
    })
    .filter((entry): entry is string => entry !== undefined);
  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

function canonicalItemTypeFromAcpToolKind(kind: string | undefined): ToolLifecycleItemType {
  switch (kind) {
    case "read":
      return "file_read";
    case "execute":
      return "command_execution";
    case "edit":
    case "delete":
    case "move":
      return "file_change";
    case "search":
      return "file_search";
    case "fetch":
      return "web_fetch";
    default:
      return "dynamic_tool_call";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return Predicate.isObject(value) ? value : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCommandValue(value: unknown): string | undefined {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts = value
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => entry !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function stripTrailingExitCode(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code \d+>)\s*$/iu.exec(trimmed);
  const output = match?.groups?.output?.trim() ?? trimmed;
  return output.length > 0 ? output : undefined;
}

function extractCommandFromTitle(title: string | undefined): string | undefined {
  if (!title) {
    return undefined;
  }
  const backtickMatch = /`([^`]+)`/u.exec(title);
  return backtickMatch?.[1]?.trim() || undefined;
}

function extractToolCommand(
  data: Record<string, unknown> | undefined,
  title: string | undefined,
): string | undefined {
  const item = asRecord(data?.item);
  const itemInput = asRecord(item?.input);
  const itemResult = asRecord(item?.result);
  const rawInput = asRecord(data?.rawInput);
  const candidates = [
    normalizeCommandValue(item?.command),
    normalizeCommandValue(itemInput?.command),
    normalizeCommandValue(itemResult?.command),
    normalizeCommandValue(data?.command),
    normalizeCommandValue(rawInput?.command),
  ];
  const direct = candidates.find((candidate) => candidate !== undefined);
  if (direct) {
    return direct;
  }
  const executable = asTrimmedString(rawInput?.executable);
  const args = normalizeCommandValue(rawInput?.args);
  if (executable && args) {
    return `${executable} ${args}`;
  }
  if (executable) {
    return executable;
  }
  return extractCommandFromTitle(title);
}

function maybePathLike(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (
    value.includes("/") ||
    value.includes("\\") ||
    value.startsWith(".") ||
    /\.(?:[a-z0-9]{1,12})$/iu.test(value)
  ) {
    return value;
  }
  return undefined;
}

function collectPaths(value: unknown, paths: string[], seen: Set<string>, depth: number): void {
  if (depth > 4 || paths.length >= 8) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPaths(entry, paths, seen, depth + 1);
      if (paths.length >= 8) {
        return;
      }
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  for (const key of ["path", "filePath", "relativePath", "filename", "newPath", "oldPath"]) {
    const candidate = maybePathLike(asTrimmedString(record[key]));
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    paths.push(candidate);
    if (paths.length >= 8) {
      return;
    }
  }
  for (const nestedKey of ["locations", "item", "input", "result", "rawInput", "data", "changes"]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectPaths(record[nestedKey], paths, seen, depth + 1);
    if (paths.length >= 8) {
      return;
    }
  }
}

function extractPrimaryPath(data: Record<string, unknown> | undefined): string | undefined {
  const paths: string[] = [];
  collectPaths(data, paths, new Set<string>(), 0);
  return paths[0];
}

function extractSearchQuery(data: Record<string, unknown> | undefined): string | undefined {
  const rawInput = asRecord(data?.rawInput);
  return (
    asTrimmedString(rawInput?.query) ??
    asTrimmedString(rawInput?.pattern) ??
    asTrimmedString(rawInput?.searchTerm)
  );
}

function extractFetchTarget(
  data: Record<string, unknown> | undefined,
  detail: string | undefined,
): string | undefined {
  const rawInput = asRecord(data?.rawInput);
  const item = asRecord(data?.item);
  const itemInput = asRecord(item?.input);
  for (const candidate of [
    rawInput?.url,
    rawInput?.uri,
    rawInput?.href,
    rawInput?.endpoint,
    data?.url,
    data?.uri,
    data?.href,
    itemInput?.url,
    itemInput?.uri,
  ]) {
    const target = asTrimmedString(candidate);
    if (target) {
      return target;
    }
  }
  const detailTarget = asTrimmedString(detail);
  return detailTarget && /^(?:https?:\/\/|www\.)/iu.test(detailTarget) ? detailTarget : undefined;
}

function normalizeEquivalentValue(value: string | undefined): string | undefined {
  const trimmed = asTrimmedString(value);
  if (!trimmed) {
    return undefined;
  }
  return trimmed
    .replace(/\s+/gu, " ")
    .replace(/\s+(?:complete|completed|started)\s*$/iu, "")
    .trim();
}

function isEquivalent(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeEquivalentValue(left)?.toLowerCase();
  const normalizedRight = normalizeEquivalentValue(right)?.toLowerCase();
  return normalizedLeft !== undefined && normalizedLeft === normalizedRight;
}

function classifyToolAction(input: {
  readonly itemType?: ToolLifecycleItemType | null | undefined;
  readonly title?: string | undefined;
  readonly data?: Record<string, unknown> | undefined;
}): "command" | "read" | "file_change" | "file_search" | "web_search" | "fetch" | "other" {
  const itemType = input.itemType ?? undefined;
  const kind = asTrimmedString(input.data?.kind)?.toLowerCase();
  const title = asTrimmedString(input.title)?.toLowerCase();
  if (itemType === "command_execution" || kind === "execute" || title === "terminal") {
    return "command";
  }
  if (itemType === "file_read" || kind === "read" || title === "read file") {
    return "read";
  }
  if (
    itemType === "file_change" ||
    kind === "edit" ||
    kind === "move" ||
    kind === "delete" ||
    kind === "write"
  ) {
    return "file_change";
  }
  if (itemType === "web_fetch" || kind === "fetch") {
    return "fetch";
  }
  if (itemType === "web_search") {
    return "web_search";
  }
  if (itemType === "file_search" || kind === "search" || title === "find" || title === "grep") {
    return "file_search";
  }
  return "other";
}

export interface ToolActivityPresentationInput {
  readonly itemType?: ToolLifecycleItemType | null | undefined;
  readonly title?: string | null | undefined;
  readonly detail?: string | null | undefined;
  readonly data?: unknown;
  readonly fallbackSummary?: string | null | undefined;
}

export interface ToolActivityPresentation {
  readonly summary: string;
  readonly detail?: string | undefined;
}

export function deriveToolActivityPresentation(
  input: ToolActivityPresentationInput,
): ToolActivityPresentation {
  const title = asTrimmedString(input.title);
  const detail = stripTrailingExitCode(asTrimmedString(input.detail));
  const fallbackSummary = asTrimmedString(input.fallbackSummary) ?? "Tool";
  const data = asRecord(input.data);
  const command = extractToolCommand(data, title);
  const primaryPath = extractPrimaryPath(data);
  const action = classifyToolAction({
    itemType: input.itemType,
    title,
    data,
  });

  if (action === "command") {
    return {
      summary: "Ran command",
      ...(command ? { detail: command } : {}),
    };
  }

  if (action === "read") {
    if (primaryPath) {
      return {
        summary: "Read file",
        detail: primaryPath,
      };
    }
    return {
      summary: "Read file",
    };
  }

  if (action === "file_change") {
    return {
      summary: "Changed files",
      ...(primaryPath ? { detail: primaryPath } : {}),
    };
  }

  if (action === "file_search") {
    const query = extractSearchQuery(data);
    return {
      summary: "Searched files",
      ...(query ? { detail: query } : {}),
    };
  }

  if (action === "web_search") {
    const query = extractSearchQuery(data);
    return {
      summary: "Searched web",
      ...(query ? { detail: query } : {}),
    };
  }

  if (action === "fetch") {
    const target = extractFetchTarget(data, detail);
    return {
      summary: "Fetched",
      ...(target ? { detail: target } : {}),
    };
  }

  if (detail && !isEquivalent(detail, title) && !isEquivalent(detail, fallbackSummary)) {
    return {
      summary: title ?? fallbackSummary,
      detail,
    };
  }

  return {
    summary: title ?? fallbackSummary,
  };
}
