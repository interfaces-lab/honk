import { gitAgentActionFromMetadata, type GitAgentActionId } from "../lib/git-agent-actions";
import type { ThreadViewState } from "../open-code-view";
import { toolTodos, type ToolTodo } from "../tool-part-projection";
import { QUEUED_TASKS_METADATA_KEY } from "./queued-tasks";
import { projectPlanTasks } from "./plan-todo-projection";

export type ThreadMessage = ThreadViewState["messages"][number];
export type ThreadPart = ThreadViewState["parts"][number];
export type ToolPart = Extract<ThreadPart, { readonly type: "tool" }>;
export type TextPart = Extract<ThreadPart, { readonly type: "text" }>;
export type ReasoningPart = Extract<ThreadPart, { readonly type: "reasoning" }>;
export type FilePart = Extract<ThreadPart, { readonly type: "file" }>;
export type WorkPart = Extract<
  ThreadPart,
  { readonly type: "tool" | "subtask" | "file" | "agent" }
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

export type TranscriptTodoSummary =
  | {
      readonly kind: "plan";
      readonly planKey: string;
      readonly messageID: string;
      readonly title: string;
      readonly tasks: readonly ToolTodo[];
      readonly isActive: boolean;
      readonly canRestoreCheckpoint: boolean;
    }
  | {
      readonly kind: "todo";
      readonly tasks: readonly ToolTodo[];
    };

export type TranscriptRow =
  | {
      readonly kind: "human";
      readonly key: string;
      readonly turnKey: string;
      readonly message: UserThreadMessage;
      readonly parts: readonly ThreadPart[];
      readonly requiresRevertConfirmation: boolean;
      readonly todoSummary?: TranscriptTodoSummary;
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
// survive streaming updates: human rows key off the turn's user message id,
// work blocks key off their message id and ordinal, and other blocks key off
// their part id, so virtualizer measurements stay attached while parts grow in
// place.
export function buildTranscriptRows(
  turns: readonly ThreadTurn[],
  partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>,
  options: { readonly isThreadRunning: boolean; readonly showDiffSummary: boolean },
): readonly TranscriptRow[] {
  const genericTodo = genericTodoProjection(turns, partsByMessageId);
  const planTodos = planTodoProjection(turns, partsByMessageId);
  const latestPresentedTurnKey = turns.findLast((turn) => {
    if (turn.user === null) return false;
    const userParts = partsByMessageId.get(turn.user.id) ?? EMPTY_PARTS;
    return (
      hasVisibleUserMessage(userParts) ||
      planExecutionSummary(userParts) !== null ||
      isQueuedTasksStart(userParts)
    );
  })?.key;
  return turns.flatMap((turn, index) => {
    const isLastTurn = index === turns.length - 1;
    const isLatestPresentedTurn = turn.key === latestPresentedTurnKey;
    const diffs = gateTurnDiffs(turnDiffs(turn.user), turn, partsByMessageId);
    const userParts =
      turn.user === null ? EMPTY_PARTS : (partsByMessageId.get(turn.user.id) ?? EMPTY_PARTS);
    const planExecution = planExecutionSummary(userParts);
    const todoSummary =
      planExecution === null
        ? turn.key === genericTodo?.turnKey
          ? { kind: "todo" as const, tasks: genericTodo.tasks }
          : undefined
        : {
            ...planExecution,
            tasks: planTodos.get(planExecution.planKey) ?? planExecution.tasks,
            isActive: isLatestPresentedTurn && options.isThreadRunning,
            canRestoreCheckpoint: !isLatestPresentedTurn,
          };
    const rows: TranscriptRow[] = [];
    if (
      turn.user !== null &&
      (hasVisibleUserMessage(userParts) || planExecution !== null || isQueuedTasksStart(userParts))
    ) {
      rows.push({
        kind: "human",
        key: `human:${turn.key}`,
        turnKey: turn.key,
        message: turn.user,
        parts: userParts,
        requiresRevertConfirmation: !isLatestPresentedTurn || diffs.length > 0,
        ...(todoSummary === undefined ? {} : { todoSummary }),
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
const PLAN_EXECUTION_METADATA_KEY = "honkPlanExecution";

function planExecutionSummary(
  parts: readonly ThreadPart[],
): Omit<
  Extract<TranscriptTodoSummary, { readonly kind: "plan" }>,
  "canRestoreCheckpoint" | "isActive"
> | null {
  for (const part of parts) {
    if (part.type !== "text") continue;
    const marker = record(part.metadata?.[PLAN_EXECUTION_METADATA_KEY]);
    if (marker === undefined) continue;
    const planKey =
      typeof marker.planKey === "string" && marker.planKey.length > 0
        ? marker.planKey
        : typeof marker.planMessageID === "string" && marker.planMessageID.length > 0
          ? marker.planMessageID
          : part.messageID;
    const title = typeof marker.planTitle === "string" ? marker.planTitle : "Plan";
    const assignedSteps = Array.isArray(marker.assignedSteps) ? marker.assignedSteps : [];
    return {
      kind: "plan",
      planKey,
      messageID: part.messageID,
      title,
      tasks: assignedSteps.flatMap((value) => {
        const step = record(value);
        const id = step?.id;
        const content = step?.title;
        return typeof id === "string" && typeof content === "string"
          ? [{ id, content, status: "pending" as const }]
          : [];
      }),
    };
  }
  return null;
}

function planTodoProjection(
  turns: readonly ThreadTurn[],
  partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>,
): ReadonlyMap<string, readonly ToolTodo[]> {
  const states = new Map<
    string,
    {
      readonly order: readonly string[];
      readonly tasks: ReadonlyMap<string, ToolTodo>;
      readonly extras: readonly ToolTodo[];
      readonly assigned: readonly ToolTodo[];
    }
  >();
  let currentPlanKey: string | null = null;

  for (const turn of turns) {
    const userParts =
      turn.user === null ? EMPTY_PARTS : (partsByMessageId.get(turn.user.id) ?? EMPTY_PARTS);
    const summary = planExecutionSummary(userParts);
    if (summary !== null) currentPlanKey = summary.planKey;
    if (currentPlanKey === null) continue;
    if (summary === null && !isSyntheticTaskTurn(userParts)) continue;

    const current = states.get(currentPlanKey) ?? {
      order: [],
      tasks: new Map<string, ToolTodo>(),
      extras: [],
      assigned: [],
    };
    const assigned = summary?.tasks ?? current.assigned;
    const newIDs = (summary?.tasks ?? []).flatMap((task) =>
      task.id === undefined || current.tasks.has(task.id) ? [] : [task.id],
    );
    const tasks = new Map(current.tasks);
    for (const task of summary?.tasks ?? []) {
      if (task.id !== undefined && !tasks.has(task.id)) tasks.set(task.id, task);
    }

    const todos = latestTurnTodos(turn, partsByMessageId);
    if (todos === undefined) {
      states.set(currentPlanKey, {
        order: [...current.order, ...newIDs],
        tasks,
        extras: current.extras,
        assigned,
      });
      continue;
    }
    if (
      summary === null &&
      !todos.some((todo) =>
        assigned.some(
          (task) =>
            task.id !== undefined &&
            (todo.id === task.id || todo.content.trim() === task.content.trim()),
        ),
      )
    ) {
      continue;
    }

    const projection = projectPlanTasks(
      assigned.flatMap((task) =>
        task.id === undefined ? [] : [{ id: task.id, content: task.content }],
      ),
      todos,
    );
    for (const task of projection.assigned) {
      if (task.id !== undefined) tasks.set(task.id, task);
    }
    states.set(currentPlanKey, {
      order: [...current.order, ...newIDs],
      tasks,
      extras: projection.extras,
      assigned,
    });
  }

  return new Map(
    [...states].map(([planKey, state]) => [
      planKey,
      [
        ...state.order.flatMap((stepID) => {
          const task = state.tasks.get(stepID);
          return task === undefined ? [] : [task];
        }),
        ...state.extras,
      ],
    ]),
  );
}

function isSyntheticTaskTurn(parts: readonly ThreadPart[]): boolean {
  return parts.some(
    (part) =>
      part.type === "text" && part.synthetic === true && part.text.trimStart().startsWith("<task "),
  );
}

function latestTurnTodos(
  turn: ThreadTurn,
  partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>,
): readonly ToolTodo[] | undefined {
  for (let messageIndex = turn.assistants.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = turn.assistants[messageIndex];
    if (message === undefined) continue;
    const parts = partsByMessageId.get(message.id) ?? EMPTY_PARTS;
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part?.type !== "tool") continue;
      const todos = toolTodos(part);
      if (todos !== undefined) return todos;
    }
  }
  return undefined;
}

function genericTodoProjection(
  turns: readonly ThreadTurn[],
  partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>,
): { readonly turnKey: string; readonly tasks: readonly ToolTodo[] } | null {
  const updates = turns.flatMap((turn) => {
    const userParts =
      turn.user === null ? EMPTY_PARTS : (partsByMessageId.get(turn.user.id) ?? EMPTY_PARTS);
    // The synthetic queued-tasks kickoff does not opt into first-TodoWrite adjacency.
    // A fresh kickoff therefore renders the shared action surface without a tracker.
    if (planExecutionSummary(userParts) !== null || isQueuedTasksStart(userParts)) return [];
    const tasks = latestTurnTodos(turn, partsByMessageId);
    return tasks === undefined ? [] : [{ turnKey: turn.key, tasks }];
  });
  const first = updates[0];
  const latest = updates.at(-1);
  return first === undefined || latest === undefined
    ? null
    : { turnKey: first.turnKey, tasks: latest.tasks };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// Part events can settle while the session keeps working, so a tail work block follows
// thread liveness. Once prose, a task, or another block follows it, that block owns the
// live presentation and the finished work group must stay settled.
export function liveWorkRowKey(
  turns: readonly ThreadTurn[],
  rows: readonly TranscriptRow[],
  isThreadRunning: boolean,
): string | null {
  if (!isThreadRunning) return null;
  const lastTurnKey = turns[turns.length - 1]?.key;
  if (lastTurnKey === undefined) return null;
  const tail = rows.findLast((row) => row.turnKey === lastTurnKey && row.kind === "block");
  if (tail?.kind !== "block" || tail.block.kind !== "work") return null;
  return tail.key;
}

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

export function hasVisibleUserMessage(parts: readonly ThreadPart[]): boolean {
  return parts.some(
    (part) =>
      part.type === "file" ||
      (part.type === "text" && part.synthetic !== true && part.text.length > 0),
  );
}

// Sessions persisted before the rename still carry the old Multitask key.
const LEGACY_QUEUED_TASKS_METADATA_KEY = "honkMultitaskStart";

export function isQueuedTasksStart(parts: readonly ThreadPart[]): boolean {
  return parts.some(
    (part) =>
      part.type === "text" &&
      (record(part.metadata?.[QUEUED_TASKS_METADATA_KEY]) !== undefined ||
        record(part.metadata?.[LEGACY_QUEUED_TASKS_METADATA_KEY]) !== undefined),
  );
}

// A Git-action turn tags its first text part with the action id; the transcript
// renders it as a read-only card instead of an editable user bubble.
export function gitAgentActionForParts(parts: readonly ThreadPart[]): GitAgentActionId | null {
  for (const part of parts) {
    if (part.type !== "text") continue;
    const action = gitAgentActionFromMetadata(part.metadata);
    if (action !== null) return action;
  }
  return null;
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

// Turn-level summary diffs snapshot the whole working tree, so edits made
// concurrently by other sessions in the same directory leak into every turn.
// A receipt renders only when the turn could have produced the diff itself:
// an edit tool naming the file, or an opaque mutation channel (shell,
// delegated task) that could have touched anything.
function gateTurnDiffs(
  diffs: readonly RenderableThreadDiff[],
  turn: ThreadTurn,
  partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>,
): readonly RenderableThreadDiff[] {
  if (diffs.length === 0) return diffs;
  const toolParts = turn.assistants.flatMap((message) =>
    (partsByMessageId.get(message.id) ?? EMPTY_PARTS).filter(
      (part): part is ToolPart => part.type === "tool",
    ),
  );
  if (toolParts.some((part) => OPAQUE_MUTATION_TOOLS.has(canonicalToolName(part)))) {
    return diffs;
  }
  const editedFiles = toolParts
    .filter((part) => EDIT_TOOLS.has(canonicalToolName(part)))
    .flatMap(editToolFiles);
  return diffs.filter((diff) => editedFiles.some((file) => namesSameFile(file, diff.file)));
}

const EDIT_TOOLS = new Set(["edit", "write", "patch", "apply_patch"]);
const OPAQUE_MUTATION_TOOLS = new Set(["bash", "shell", "task"]);

// The MCP generation of Honk's own tools is the same call under a prefixed name.
function canonicalToolName(part: ToolPart): string {
  return part.tool.replace(/^honk_/, "");
}

function editToolFiles(part: ToolPart): readonly string[] {
  const inputPath = part.state.input.filePath ?? part.state.input.path;
  const metadata = part.state.status === "pending" ? undefined : part.state.metadata;
  const metadataFiles = metadata?.files;
  return [
    ...(typeof inputPath === "string" ? [inputPath] : []),
    ...(Array.isArray(metadataFiles) ? metadataFiles : []).flatMap((file: unknown) => {
      const path = record(file)?.relativePath ?? record(file)?.filePath;
      return typeof path === "string" ? [path] : [];
    }),
  ];
}

// Summary diff paths are repo-relative while edit tool inputs are absolute.
function namesSameFile(edited: string, file: string): boolean {
  return edited === file || edited.endsWith(`/${file}`) || file.endsWith(`/${edited}`);
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

export function transcriptPartsWithoutQuestions(
  parts: readonly ThreadPart[],
): readonly ThreadPart[] {
  return parts.filter((part) => part.type !== "tool" || part.tool !== "question");
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

// Server-emitted patch parts are working-tree snapshots, not steps the
// assistant took; rendering them as work invents "Edited" rows on turns that
// never edited anything, so they are dropped alongside step markers.
function isTranscriptWorkPart(part: ThreadPart): part is WorkPart {
  if (part.type === "tool") {
    return part.tool !== "todowrite" && part.tool !== "todoread";
  }
  return part.type === "subtask" || part.type === "file" || part.type === "agent";
}

export function segmentAssistantTurn(
  messages: readonly AssistantThreadMessage[],
  partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>,
): readonly TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  for (const message of messages) {
    // Work blocks key off the message id plus an ordinal, not the first part
    // id: persisted and projected transcript planes assign different part ids
    // to the same logical parts, and a part-id key would remount the block's
    // disclosure state whenever a refetch swaps planes.
    let workBlockOrdinal = 0;
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
            blocks.push({
              kind: "work",
              key: `work:${message.id}:${String(workBlockOrdinal)}`,
              parts: [part],
            });
            workBlockOrdinal += 1;
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
