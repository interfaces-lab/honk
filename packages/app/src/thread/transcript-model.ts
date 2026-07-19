import type { ThreadViewState } from "../open-code-view";

export type ThreadMessage = ThreadViewState["messages"][number];
export type ThreadPart = ThreadViewState["parts"][number];
export type ToolPart = Extract<ThreadPart, { readonly type: "tool" }>;
export type TextPart = Extract<ThreadPart, { readonly type: "text" }>;
export type ReasoningPart = Extract<ThreadPart, { readonly type: "reasoning" }>;
export type FilePart = Extract<ThreadPart, { readonly type: "file" }>;
export type WorkPart = Extract<
  ThreadPart,
  { readonly type: "tool" | "subtask" | "file" | "patch" | "agent" }
>;
export type UserThreadMessage = Extract<ThreadMessage, { readonly role: "user" }>;
export type AssistantThreadMessage = Extract<ThreadMessage, { readonly role: "assistant" }>;
export type ThreadDiff = NonNullable<UserThreadMessage["summary"]>["diffs"][number];
export type RenderableThreadDiff = ThreadDiff & { readonly file: string };

export type ThreadTurn = {
  readonly key: string;
  readonly user: UserThreadMessage | null;
  readonly assistants: readonly AssistantThreadMessage[];
};

export type TranscriptBlock =
  | { readonly kind: "prose"; readonly key: string; readonly part: TextPart }
  | { readonly kind: "reasoning"; readonly key: string; readonly part: ReasoningPart }
  | { readonly kind: "task"; readonly key: string; readonly part: ToolPart }
  | { readonly kind: "work"; readonly key: string; readonly parts: readonly WorkPart[] }
  | { readonly kind: "notice"; readonly key: string; readonly part: ThreadPart }
  | { readonly kind: "error"; readonly key: string; readonly message: string };

export type TranscriptRow =
  | {
      readonly kind: "human";
      readonly key: string;
      readonly turnKey: string;
      readonly message: UserThreadMessage;
      readonly parts: readonly ThreadPart[];
      readonly requiresRevertConfirmation: boolean;
    }
  | {
      readonly kind: "block";
      readonly key: string;
      readonly turnKey: string;
      readonly block: TranscriptBlock;
    }
  | {
      readonly kind: "diff";
      readonly key: string;
      readonly turnKey: string;
      readonly diffs: readonly RenderableThreadDiff[];
    };

// Flattens turns into stable per-message/per-block virtual rows. Row keys must
// survive streaming updates: human rows key off the turn's user message id and
// block rows key off their first part id, so virtualizer measurements stay
// attached while parts grow in place.
export function buildTranscriptRows(
  turns: readonly ThreadTurn[],
  partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>,
  options: { readonly isThreadRunning: boolean; readonly showDiffSummary: boolean },
): readonly TranscriptRow[] {
  return turns.flatMap((turn, index) => {
    const isLastTurn = index === turns.length - 1;
    const diffs = turnDiffs(turn.user);
    const userParts =
      turn.user === null ? EMPTY_PARTS : (partsByMessageId.get(turn.user.id) ?? EMPTY_PARTS);
    const rows: TranscriptRow[] = [];
    if (turn.user !== null && !isSyntheticOnlyUserMessage(userParts)) {
      rows.push({
        kind: "human",
        key: `human:${turn.key}`,
        turnKey: turn.key,
        message: turn.user,
        parts: userParts,
        requiresRevertConfirmation: !isLastTurn || diffs.length > 0,
      });
    }
    for (const block of segmentAssistantTurn(turn.assistants, partsByMessageId)) {
      rows.push({ kind: "block", key: `block:${block.key}`, turnKey: turn.key, block });
    }
    if (options.showDiffSummary && diffs.length > 0 && (!isLastTurn || !options.isThreadRunning)) {
      rows.push({ kind: "diff", key: `diff:${turn.key}`, turnKey: turn.key, diffs });
    }
    return rows;
  });
}

const EMPTY_PARTS: readonly ThreadPart[] = Object.freeze([]);

export function groupMessagesIntoTurns(messages: readonly ThreadMessage[]): readonly ThreadTurn[] {
  const turns: {
    key: string;
    user: UserThreadMessage | null;
    assistants: AssistantThreadMessage[];
  }[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ key: message.id, user: message, assistants: [] });
      continue;
    }
    const current = turns[turns.length - 1];
    if (current === undefined || current.user === null) {
      if (current === undefined) {
        turns.push({ key: message.id, user: null, assistants: [message] });
      } else {
        current.assistants.push(message);
      }
      continue;
    }
    current.assistants.push(message);
  }
  return turns;
}

export function isSyntheticOnlyUserMessage(parts: readonly ThreadPart[]): boolean {
  return (
    parts.some((part) => part.type === "text" && part.synthetic === true) &&
    !parts.some((part) => part.type === "file" || (part.type === "text" && part.synthetic !== true))
  );
}

export function turnDiffs(message: UserThreadMessage | null): readonly RenderableThreadDiff[] {
  const diffs = message?.summary?.diffs ?? [];
  const seen = new Set<string>();
  const result: RenderableThreadDiff[] = [];
  for (let index = diffs.length - 1; index >= 0; index -= 1) {
    const diff = diffs[index];
    if (diff === undefined || typeof diff.file !== "string" || seen.has(diff.file)) {
      continue;
    }
    if (diff.additions === 0 && diff.deletions === 0 && diff.status !== "deleted") {
      continue;
    }
    seen.add(diff.file);
    result.push({ ...diff, file: diff.file });
  }
  return result.reverse();
}

export function groupPartsByMessage(
  parts: readonly ThreadPart[],
): Map<string, readonly ThreadPart[]> {
  const grouped = new Map<string, ThreadPart[]>();
  for (const part of parts) {
    const existing = grouped.get(part.messageID);
    if (existing === undefined) {
      grouped.set(part.messageID, [part]);
    } else {
      existing.push(part);
    }
  }
  return grouped;
}

export function isPartActive(part: ThreadPart): boolean {
  if (part.type === "tool") {
    return part.state.status === "pending" || part.state.status === "running";
  }
  if (part.type === "text" || part.type === "reasoning") {
    return part.time?.start !== undefined && part.time.end === undefined;
  }
  return false;
}

export function isVisibleActivePart(part: ThreadPart): boolean {
  if (!isPartActive(part)) {
    return false;
  }
  if (part.type === "text") {
    return part.ignored !== true && part.text.trim().length > 0;
  }
  if (part.type === "reasoning") {
    return part.text.trim().length > 0;
  }
  if (part.type === "tool") {
    return part.tool !== "todowrite" && part.tool !== "todoread";
  }
  return false;
}

export function turnHasVisibleActivity(
  turn: ThreadTurn | undefined,
  partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>,
): boolean {
  if (turn === undefined) {
    return false;
  }
  const messageIds = [turn.user?.id, ...turn.assistants.map((message) => message.id)];
  return messageIds.some(
    (messageId) =>
      messageId !== undefined &&
      (partsByMessageId.get(messageId) ?? EMPTY_PARTS).some(isVisibleActivePart),
  );
}

export function messageError(message: ThreadMessage): string | null {
  if (message.role !== "assistant" || message.error === undefined) {
    return null;
  }
  const data = (message.error as { data?: { message?: unknown } }).data;
  const text = typeof data?.message === "string" ? data.message : null;
  return text ?? message.error.name;
}

function isTranscriptWorkPart(part: ThreadPart): part is WorkPart {
  if (part.type === "tool") {
    return part.tool !== "todowrite" && part.tool !== "todoread";
  }
  return (
    part.type === "subtask" ||
    part.type === "file" ||
    part.type === "patch" ||
    part.type === "agent"
  );
}

export function segmentAssistantTurn(
  messages: readonly AssistantThreadMessage[],
  partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>,
): readonly TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  for (const message of messages) {
    for (const part of partsByMessageId.get(message.id) ?? EMPTY_PARTS) {
      switch (part.type) {
        case "text":
          if (part.ignored !== true && part.text.length > 0) {
            blocks.push({ kind: "prose", key: part.id, part });
          }
          break;
        case "retry":
        case "compaction":
          blocks.push({ kind: "notice", key: part.id, part });
          break;
        case "reasoning":
          if (part.text.trim().length > 0) {
            blocks.push({ kind: "reasoning", key: part.id, part });
          }
          break;
        case "step-start":
        case "step-finish":
        case "snapshot":
          break;
        default: {
          if (part.type === "tool" && part.tool === "task") {
            blocks.push({ kind: "task", key: part.id, part });
            break;
          }
          if (!isTranscriptWorkPart(part)) {
            break;
          }
          const last = blocks[blocks.length - 1];
          if (last?.kind === "work") {
            blocks[blocks.length - 1] = { ...last, parts: [...last.parts, part] };
          } else {
            blocks.push({ kind: "work", key: part.id, parts: [part] });
          }
        }
      }
    }
    const error = messageError(message);
    if (error !== null) {
      blocks.push({ kind: "error", key: `error:${message.id}`, message: error });
    }
  }
  return blocks;
}
