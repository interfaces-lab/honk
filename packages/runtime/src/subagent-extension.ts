import {
  DefaultResourceLoader,
  defineTool,
  type ExtensionContext,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { Type, type Model } from "@earendil-works/pi-ai";
import {
  AGENT_THINKING_LEVELS,
  ThreadId,
  type AgentModelPolicy,
  type AgentRuntimeEvent,
  type AgentThinkingLevel,
  type SubagentActivityDetails,
  type SubagentActivityKind,
  type SubagentActivityPayload,
  type SubagentMode,
  type SubagentRunSnapshot,
  type SubagentRunState,
  type SubagentToolDetails,
} from "@honk/contracts";
import { ThreadAgentRuntime } from "./thread-agent-runtime";
import {
  accountIdFromProvider,
  authProviderIdFromPiModel,
  modelIdFromPiModel,
} from "./auth-model-policy";
import {
  childCanFanOut,
  resolveSubagentModel,
  resolveSubagentProfile,
  subagentSystemPromptForChild,
  type ResolvedSubagentProfile,
  type SubagentProfileOverrides,
} from "./subagent-profiles";
import { normalizeAdditionalExtensionPaths } from "./extension-paths";
import { backgroundSubagentControllerForSession } from "./background-subagents";
import {
  DEFAULT_SUBAGENT_BUDGET_LIMITS,
  createSubagentBudgetController,
  disposeLoadedSubagentRuntimes,
  evictIdleSubagentRuntimes,
  truncateSubagentOutputForParent,
  type LoadedSubagentRuntime,
  type SubagentBudgetController,
} from "./subagent-budget";

const MAX_TASK_DESCRIPTION_LENGTH = 80;
// Absolute cap on subagent nesting depth. The top-level agent is depth 0; its children are depth 1.
// A child only receives the `subagent` tool when its profile authorizes fanout AND its depth is below
// this cap, so recursive fan-out is bounded. A profile may tighten (never widen) this.
const DEFAULT_MAX_SUBAGENT_DEPTH = 1;
// Pi forwards every child SSE chunk. Publishing parent progress on each one re-copies the combined
// activities array (across all concurrent children) and re-broadcasts it per chunk — the O(n^2)
// source. Throttle to ~10 Hz (trailing edge, flushed on completion) so the live tray stays responsive
// without flooding the host. The final tool result is computed unthrottled, so nothing is lost.
const SUBAGENT_PUBLISH_INTERVAL_MS = 100;
// The throttle bounds publish frequency; this bounds publish size. Each live publish used to carry
// the whole accumulated activities array, so a long run grew O(n) per tick. The renderer upserts by
// id from every tick and retains at most 500 activities (MAX_SUBAGENT_ACTIVITIES in
// subagent-activity-store.ts), so a live tail of the same size renders identically. The final tool
// result stays uncapped: completed-run history must survive restarts.
export const MAX_LIVE_SUBAGENT_ACTIVITIES = 500;
// Cap any single progress detail we mirror into the parent. The child's full output lives in its own
// session, and the final answer is returned as the tool result; the parent only needs a bounded
// preview for the live tray. Assistant/reasoning text keeps its head (the message as written); command
// and tool output keeps its tail (the most recent output).
const MAX_SUBAGENT_TEXT_DETAIL_CHARS = 16_000;
const MAX_SUBAGENT_OUTPUT_DETAIL_CHARS = 8_000;
const MAX_SUBAGENT_DATA_STRING_CHARS = 4_000;
const MAX_SUBAGENT_DATA_ARRAY_ITEMS = 50;
const MAX_SUBAGENT_DATA_DEPTH = 3;
const SUBAGENT_ACTIVITY_DATA_BODY_KEYS = new Set([
  "activities",
  "content",
  "messages",
  "output",
  "partialResult",
  "result",
  "stderr",
  "stdout",
  "text",
]);
const AGENT_THINKING_LEVEL_SET: ReadonlySet<ThinkingLevel> = new Set(AGENT_THINKING_LEVELS);

function isAgentThinkingLevel(level: ThinkingLevel): level is AgentThinkingLevel {
  return AGENT_THINKING_LEVEL_SET.has(level);
}

function normalizeAgentThinkingLevel(value: string | undefined): AgentThinkingLevel | null {
  return value && (AGENT_THINKING_LEVELS as readonly string[]).includes(value)
    ? (value as AgentThinkingLevel)
    : null;
}

interface SubagentExtensionOptions {
  readonly agentDir: string;
  readonly extensionPaths?: readonly string[];
  // Depth of the agent this extension is registered on (0 = top-level). Threaded to children so the
  // recursion guard can bound nesting in-process (there is no child process / env to carry it).
  readonly depth?: number;
  readonly maxSubagentDepth?: number;
}

interface SubagentTask {
  readonly prompt: string;
  readonly description: string | null;
  readonly cwd: string | null;
  readonly step: number | null;
  // Supplemental context prepended to the child's first message (the child cannot see this thread).
  readonly context: string | null;
}

interface MutableSubagentRun {
  readonly subagentThreadId: string;
  readonly agentId: string;
  readonly nickname: string;
  readonly role: string;
  readonly model: string | null;
  readonly prompt: string;
  readonly parentThreadId: string;
  readonly parentItemId: string;
  state: SubagentRunState;
  finalText: string | null;
  errorMessage: string | null;
  lastAssistantText: string;
  lastAssistantTextItemId: string | null;
  lastThinkingText: string;
  lastThinkingTextItemId: string | null;
}

interface SubagentExecutionState {
  readonly mode: SubagentMode;
  readonly runs: MutableSubagentRun[];
  readonly activities: SubagentActivityDetails[];
  readonly activityIndexById: Map<string, number>;
  sequence: number;
}

const TaskItem = Type.Object({
  prompt: Type.String({ description: "Specific prompt to run in the subagent." }),
  description: Type.Optional(
    Type.String({
      description:
        "Short visible work label shown while this subagent runs. Prefer a present-participle phrase like 'researching session IDs' or 'checking release scripts'.",
    }),
  ),
  agent: Type.Optional(
    Type.String({
      description:
        "Specialist for this task. Use 'librarian' for fast codebase research or 'oracle' for deep analysis. Omit for the default Worker; 'general-purpose' is accepted for legacy/default compatibility but is not preferred.",
    }),
  ),
  model: Type.Optional(Type.String({ description: "Override model id for this task." })),
  context: Type.Optional(Type.String({ description: "Extra context to give this task." })),
  cwd: Type.Optional(Type.String({ description: "Working directory for this subagent run." })),
});

const ChainItem = Type.Object({
  prompt: Type.String({
    description: "Specific prompt. Use {previous} to include the prior step output.",
  }),
  description: Type.Optional(
    Type.String({
      description:
        "Short visible work label shown while this chain step runs. Prefer a present-participle phrase like 'reviewing architecture' or 'working through type errors'.",
    }),
  ),
  agent: Type.Optional(
    Type.String({
      description:
        "Specialist for this step. Use 'librarian' for fast codebase research or 'oracle' for deep analysis. Omit for the default Worker; 'general-purpose' is accepted for legacy/default compatibility but is not preferred.",
    }),
  ),
  model: Type.Optional(Type.String({ description: "Override model id for this step." })),
  context: Type.Optional(Type.String({ description: "Extra context to give this step." })),
  cwd: Type.Optional(Type.String({ description: "Working directory for this chain step." })),
});

const SubagentParams = Type.Object({
  prompt: Type.Optional(Type.String({ description: "Specific prompt for a single subagent." })),
  description: Type.Optional(
    Type.String({
      description:
        "Short visible work label shown while the subagent runs. Prefer a present-participle phrase like 'researching session IDs', 'checking release scripts', 'reviewing architecture', or 'working through type errors'.",
    }),
  ),
  agent: Type.Optional(
    Type.String({
      description:
        "Default specialist for all tasks. Use 'librarian' for fast codebase research or 'oracle' for deep analysis. Omit for the default Worker; 'general-purpose' is accepted for legacy/default compatibility but is not preferred. Per-task agent overrides this.",
    }),
  ),
  model: Type.Optional(Type.String({ description: "Default override model id for all tasks." })),
  thinkingLevel: Type.Optional(
    Type.String({ description: "Override thinking level (off, low, medium, high, xhigh)." }),
  ),
  tools: Type.Optional(
    Type.Array(Type.String(), {
      description: "Override tool allowlist for the subagents (e.g. read, grep, find, ls).",
    }),
  ),
  context: Type.Optional(Type.String({ description: "Shared context given to every task." })),
  runInBackground: Type.Optional(
    Type.Boolean({
      description:
        "Start the subagent work in the background and return immediately. Only use in Honk Multitask mode.",
    }),
  ),
  tasks: Type.Optional(Type.Array(TaskItem, { description: "Parallel subagent tasks." })),
  chain: Type.Optional(Type.Array(ChainItem, { description: "Sequential subagent tasks." })),
  cwd: Type.Optional(Type.String({ description: "Working directory for single mode." })),
});

function nowIso(): string {
  return new Date().toISOString();
}

function clampDetailHead(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n… [truncated]`;
}

function clampDetailTail(value: string, max: number): string {
  return value.length <= max ? value : `… [truncated]\n${value.slice(value.length - max)}`;
}

interface TrailingThrottle {
  readonly schedule: () => void;
  readonly flush: () => void;
}

// Leading + trailing throttle: the first call fires immediately, subsequent calls within the window
// collapse into a single trailing call, and flush() forces an immediate final call (used on
// completion so the tray always lands on the terminal state). fn re-reads current state at call time.
function createTrailingThrottle(fn: () => void, intervalMs: number): TrailingThrottle {
  let lastRun = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    lastRun = Date.now();
    fn();
  };
  return {
    schedule: () => {
      if (timer !== null) {
        return;
      }
      const elapsed = Date.now() - lastRun;
      if (elapsed >= intervalMs) {
        run();
      } else {
        timer = setTimeout(run, intervalMs - elapsed);
      }
    },
    flush: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      run();
    },
  };
}

function createExecutionState(mode: SubagentMode): SubagentExecutionState {
  return {
    mode,
    runs: [],
    activities: [],
    activityIndexById: new Map(),
    sequence: 0,
  };
}

function runSnapshot(run: MutableSubagentRun): SubagentRunSnapshot {
  return {
    subagentThreadId: run.subagentThreadId,
    agentId: run.agentId,
    nickname: run.nickname,
    role: run.role,
    model: run.model,
    prompt: run.prompt,
    state: run.state,
    finalText: run.finalText,
    errorMessage: run.errorMessage,
  };
}

function toolDetails(state: SubagentExecutionState): SubagentToolDetails {
  return {
    mode: state.mode,
    runs: state.runs.map(runSnapshot),
    activities: [...state.activities],
  };
}

export function capLiveSubagentActivities(details: SubagentToolDetails): SubagentToolDetails {
  if (details.activities.length <= MAX_LIVE_SUBAGENT_ACTIVITIES) {
    return details;
  }
  return { ...details, activities: details.activities.slice(-MAX_LIVE_SUBAGENT_ACTIVITIES) };
}

function basePayload(
  run: MutableSubagentRun,
  overrides: Partial<SubagentActivityPayload>,
): SubagentActivityPayload {
  return {
    subagentThreadId: run.subagentThreadId,
    parentThreadId: run.parentThreadId,
    parentItemId: run.parentItemId,
    agentId: run.agentId,
    nickname: run.nickname,
    role: run.role,
    model: run.model,
    prompt: run.prompt,
    state: null,
    itemType: null,
    itemId: null,
    status: null,
    title: null,
    detail: null,
    data: null,
    ...overrides,
  };
}

function pushActivity(
  state: SubagentExecutionState,
  run: MutableSubagentRun,
  kind: SubagentActivityKind,
  summary: string,
  payload: Partial<SubagentActivityPayload>,
): void {
  const id = subagentActivityId(run, kind, payload);
  const existingIndex = state.activityIndexById.get(id);
  const previousActivity =
    existingIndex !== undefined ? state.activities[existingIndex] : undefined;
  const sequence = previousActivity?.sequence ?? nextActivitySequence(state);
  const activity: SubagentActivityDetails = {
    id,
    kind,
    tone: kind === "subagent.thread.state.changed" && payload.state === "failed" ? "error" : "info",
    summary,
    createdAt: nowIso(),
    sequence,
    payload: basePayload(run, payload),
  };
  if (existingIndex !== undefined && state.activities[existingIndex]) {
    state.activities[existingIndex] = activity;
    return;
  }
  state.activityIndexById.set(id, state.activities.length);
  state.activities.push(activity);
}

function nextActivitySequence(state: SubagentExecutionState): number {
  state.sequence += 1;
  return state.sequence;
}

function subagentActivityId(
  run: MutableSubagentRun,
  kind: SubagentActivityKind,
  payload: Partial<SubagentActivityPayload>,
): string {
  const base = `runtime-subagent:${run.parentItemId}:${run.subagentThreadId}`;
  switch (kind) {
    case "subagent.thread.started":
      return `${base}:thread`;
    case "subagent.thread.state.changed":
      return `${base}:state`;
    case "subagent.item.started":
    case "subagent.item.updated":
    case "subagent.item.completed": {
      const itemId = payload.itemId?.trim();
      return `${base}:item:${itemId ?? "missing"}`;
    }
  }
}

function policyThinkingLevel(level: ThinkingLevel): AgentModelPolicy["thinkingLevel"] | null {
  return isAgentThinkingLevel(level) ? level : null;
}

function createMutableRun(input: {
  readonly parentThreadId: string;
  readonly toolCallId: string;
  readonly task: SubagentTask;
  readonly role: string;
  readonly model: string | null;
  readonly state?: SubagentRunState;
}): MutableSubagentRun {
  const subagentThreadId = `${input.parentThreadId}:subagent:${input.toolCallId}:${crypto.randomUUID()}`;
  const title = taskDisplayName(input.task);
  return {
    subagentThreadId,
    agentId: subagentThreadId,
    nickname: title,
    role: input.role,
    model: input.model,
    prompt: input.task.prompt,
    parentThreadId: input.parentThreadId,
    parentItemId: input.toolCallId,
    state: input.state ?? "running",
    finalText: null,
    errorMessage: null,
    lastAssistantText: "",
    lastAssistantTextItemId: null,
    lastThinkingText: "",
    lastThinkingTextItemId: null,
  };
}

function taskDisplayName(task: SubagentTask): string {
  const description = task.description?.trim();
  if (description) {
    return description;
  }
  const prompt = task.prompt.trim().replace(/\s+/g, " ");
  if (prompt.length <= MAX_TASK_DESCRIPTION_LENGTH) {
    return prompt;
  }
  return `${prompt.slice(0, MAX_TASK_DESCRIPTION_LENGTH - 3)}...`;
}

function toolItemTypeForName(toolName: string): string {
  switch (toolName) {
    case "bash":
      return "command_execution";
    case "read":
      return "file_read";
    case "grep":
    case "find":
    case "ls":
      return "file_search";
    case "edit":
    case "write":
      return "file_change";
    default:
      return "dynamic_tool_call";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return Object.fromEntries(Object.entries(value));
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(Object.entries(value));
}

function compactSubagentDataString(value: string): string {
  if (value.length <= MAX_SUBAGENT_DATA_STRING_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_SUBAGENT_DATA_STRING_CHARS)}\n… [truncated]`;
}

function compactSubagentMetadataValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return compactSubagentDataString(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_SUBAGENT_DATA_DEPTH) {
      return undefined;
    }
    const compacted = value
      .slice(0, MAX_SUBAGENT_DATA_ARRAY_ITEMS)
      .map((entry) => compactSubagentMetadataValue(entry, depth + 1))
      .filter((entry) => entry !== undefined);
    return compacted.length > 0 ? compacted : undefined;
  }
  const record = asObjectRecord(value);
  if (!record || depth >= MAX_SUBAGENT_DATA_DEPTH) {
    return undefined;
  }
  const entries = Object.entries(record)
    .filter(([key]) => !SUBAGENT_ACTIVITY_DATA_BODY_KEYS.has(key))
    .map(([key, entry]) => [key, compactSubagentMetadataValue(entry, depth + 1)] as const)
    .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function compactSubagentToolResult(value: unknown): unknown {
  const record = asObjectRecord(value);
  if (!record) {
    return undefined;
  }
  const entries = Object.entries(record)
    .filter(([key]) => !SUBAGENT_ACTIVITY_DATA_BODY_KEYS.has(key))
    .map(([key, entry]) => [key, compactSubagentMetadataValue(entry, 1)] as const)
    .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function compactSubagentActivityData(data: unknown): Record<string, unknown> | null {
  const record = asObjectRecord(data);
  if (!record) {
    return null;
  }
  const entries = Object.entries(record)
    .filter(([key]) => key !== "result" && key !== "partialResult")
    .map(([key, entry]) => [key, compactSubagentMetadataValue(entry, 0)] as const)
    .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined);

  const result = compactSubagentToolResult(record.result);
  const partialResult = compactSubagentToolResult(record.partialResult);
  if (result !== undefined) {
    entries.push(["result", result]);
  }
  if (partialResult !== undefined) {
    entries.push(["partialResult", partialResult]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function toolResultText(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => toolResultText(entry))
      .filter((entry): entry is string => entry !== null);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of ["stdout", "stderr", "output", "content", "text", "message", "result"]) {
    const text = toolResultText(record[key]);
    if (text) {
      return text;
    }
  }
  return null;
}

function captureChildEvent(
  state: SubagentExecutionState,
  run: MutableSubagentRun,
  event: AgentRuntimeEvent,
): void {
  if (
    (event.type === "message.updated" || event.type === "message.completed") &&
    event.messageRole === "assistant"
  ) {
    const assistantItemId = `assistant:${event.turnId ?? event.id}`;
    const eventText = event.text?.trim();
    const text =
      eventText ||
      (event.type === "message.completed" && run.lastAssistantTextItemId === assistantItemId
        ? run.lastAssistantText
        : null);
    if (text) {
      const textChanged = text !== run.lastAssistantText;
      if (textChanged) {
        run.lastAssistantText = text;
        run.lastAssistantTextItemId = assistantItemId;
      }
      if (textChanged || event.type === "message.completed") {
        pushActivity(
          state,
          run,
          event.type === "message.completed" ? "subagent.item.completed" : "subagent.item.updated",
          "Subagent response",
          {
            itemType: "assistant_message",
            itemId: assistantItemId,
            status: event.type === "message.completed" ? "completed" : "running",
            title: "Assistant",
            detail: clampDetailHead(text, MAX_SUBAGENT_TEXT_DETAIL_CHARS),
          },
        );
      }
    }

    const thinkingItemId = `reasoning:${event.turnId ?? event.id}`;
    const eventThinking = event.thinking?.trim();
    const thinking =
      eventThinking ||
      (event.type === "message.completed" && run.lastThinkingTextItemId === thinkingItemId
        ? run.lastThinkingText
        : null);
    if (thinking) {
      const thinkingChanged = thinking !== run.lastThinkingText;
      if (thinkingChanged) {
        run.lastThinkingText = thinking;
        run.lastThinkingTextItemId = thinkingItemId;
      }
      if (thinkingChanged || event.type === "message.completed") {
        pushActivity(
          state,
          run,
          event.type === "message.completed" ? "subagent.item.completed" : "subagent.item.updated",
          "Subagent reasoning",
          {
            itemType: "reasoning",
            itemId: thinkingItemId,
            status: event.type === "message.completed" ? "completed" : "running",
            title: "Reasoning",
            detail: clampDetailHead(thinking, MAX_SUBAGENT_TEXT_DETAIL_CHARS),
          },
        );
      }
    }
  }

  if (
    event.type === "tool.started" ||
    event.type === "tool.updated" ||
    event.type === "tool.completed"
  ) {
    const data = asRecord(event.data);
    const toolCallId = typeof data?.toolCallId === "string" ? data.toolCallId : event.id;
    const toolName = typeof data?.toolName === "string" ? data.toolName : "tool";
    const result = event.type === "tool.completed" ? data?.result : data?.partialResult;
    const rawDetail = toolResultText(result);
    const detail =
      rawDetail === null ? null : clampDetailTail(rawDetail, MAX_SUBAGENT_OUTPUT_DETAIL_CHARS);
    pushActivity(
      state,
      run,
      event.type === "tool.started"
        ? "subagent.item.started"
        : event.type === "tool.completed"
          ? "subagent.item.completed"
          : "subagent.item.updated",
      event.summary ?? toolName,
      {
        itemType: toolItemTypeForName(toolName),
        itemId: toolCallId,
        status: event.type === "tool.completed" ? "completed" : "running",
        title: toolName,
        detail,
        data: compactSubagentActivityData(data),
      },
    );
  }
}

interface PreparedSubagentTask {
  readonly task: SubagentTask;
  readonly profile: ResolvedSubagentProfile;
  readonly childModel: Model<string> | undefined;
  readonly childThinkingLevel: ThinkingLevel;
  readonly run: MutableSubagentRun;
}

function prepareSubagentTask(input: {
  readonly state: SubagentExecutionState;
  readonly parentThreadId: string;
  readonly toolCallId: string;
  readonly task: SubagentTask;
  readonly ctx: ExtensionContext;
  readonly thinkingLevel: ThinkingLevel;
  readonly profile: ResolvedSubagentProfile;
  readonly notify: (() => void) | undefined;
}): PreparedSubagentTask {
  const profile = input.profile;
  // Resolve the child's model from the profile/override id when it exists in the registry; otherwise
  // inherit the parent's current model. Thinking level falls back to the parent's the same way.
  const childModel =
    resolveSubagentModel(input.ctx.modelRegistry, profile.model) ??
    (input.ctx.model as Model<string> | undefined);
  const childThinkingLevel: ThinkingLevel = profile.thinkingLevel ?? input.thinkingLevel;

  const run = createMutableRun({
    parentThreadId: input.parentThreadId,
    toolCallId: input.toolCallId,
    task: input.task,
    role: profile.name,
    model: childModel?.id ?? null,
    state: "queued",
  });
  input.state.runs.push(run);
  pushActivity(input.state, run, "subagent.thread.started", "Starting up", {
    state: "queued",
  });
  pushActivity(input.state, run, "subagent.item.completed", "Subagent task", {
    itemType: "user_message",
    itemId: `task:${run.subagentThreadId}`,
    status: "completed",
    title: "Task",
    detail: input.task.prompt,
  });
  input.notify?.();
  return { task: input.task, profile, childModel, childThinkingLevel, run };
}

function markPreparedSubagentRunning(input: {
  readonly state: SubagentExecutionState;
  readonly prepared: PreparedSubagentTask;
  readonly notify: (() => void) | undefined;
}): void {
  const { prepared } = input;
  prepared.run.state = "running";
  pushActivity(
    input.state,
    prepared.run,
    "subagent.thread.state.changed",
    `Started ${taskDisplayName(prepared.task)}`,
    { state: "running" },
  );
  input.notify?.();
}

function markPreparedSubagentNotStarted(input: {
  readonly state: SubagentExecutionState;
  readonly prepared: PreparedSubagentTask;
  readonly signal: AbortSignal | undefined;
  readonly error: unknown;
  readonly notify: (() => void) | undefined;
}): MutableSubagentRun {
  const run = input.prepared.run;
  run.state = input.signal?.aborted ? "aborted" : "failed";
  run.errorMessage =
    input.error instanceof Error
      ? input.error.message
      : run.state === "aborted"
        ? "Subagent aborted."
        : "Subagent failed before it started.";
  pushActivity(input.state, run, "subagent.thread.state.changed", run.errorMessage, {
    state: run.state,
    detail: run.errorMessage,
  });
  input.notify?.();
  return run;
}

async function runSubagentTask(input: {
  readonly state: SubagentExecutionState;
  readonly prepared: PreparedSubagentTask;
  readonly agentDir: string;
  readonly extensionPaths: readonly string[];
  readonly ctx: ExtensionContext;
  readonly signal: AbortSignal | undefined;
  readonly depth: number;
  readonly maxSubagentDepth: number;
  readonly loadedChildren: Map<string, LoadedSubagentRuntime>;
  readonly notify: (() => void) | undefined;
}): Promise<MutableSubagentRun> {
  const { childModel, childThinkingLevel, profile, run, task } = input.prepared;
  const title = taskDisplayName(task);

  // A child may itself fan out only when its resolved tools include "subagent" and it is still below
  // the (possibly profile-tightened) depth cap. Otherwise it gets no fanout extension at all.
  const childDepth = input.depth + 1;
  const effectiveMaxDepth =
    profile.maxSubagentDepth > 0
      ? Math.min(input.maxSubagentDepth, profile.maxSubagentDepth)
      : input.maxSubagentDepth;
  const childExtensionFactories: ExtensionFactory[] =
    childCanFanOut(profile) && childDepth < effectiveMaxDepth
      ? [
          createSubagentExtension({
            agentDir: input.agentDir,
            extensionPaths: input.extensionPaths,
            depth: childDepth,
            maxSubagentDepth: effectiveMaxDepth,
          }),
        ]
      : [];

  const resourceLoader = new DefaultResourceLoader({
    cwd: task.cwd ?? input.ctx.cwd,
    agentDir: input.agentDir,
    additionalExtensionPaths: profile.resourceAccess.extensions
      ? normalizeAdditionalExtensionPaths(input.extensionPaths, input.ctx.cwd)
      : [],
    extensionFactories: childExtensionFactories,
    appendSystemPrompt: subagentSystemPromptForChild(profile),
    noExtensions: !profile.resourceAccess.extensions,
    noSkills: !profile.resourceAccess.skills,
    noPromptTemplates: !profile.resourceAccess.promptTemplates,
    noThemes: !profile.resourceAccess.themes,
  });
  await resourceLoader.reload();

  const productThinkingLevel = policyThinkingLevel(childThinkingLevel);
  const modelSelection: AgentModelPolicy["modelSelection"] = childModel
    ? {
        type: "explicit",
        authProviderId: authProviderIdFromPiModel(childModel),
        accountId: accountIdFromProvider(childModel.provider),
        modelId: modelIdFromPiModel(childModel),
      }
    : { type: "pi-managed" };
  const runtime = await ThreadAgentRuntime.create({
    threadId: ThreadId.make(run.subagentThreadId),
    cwd: task.cwd ?? input.ctx.cwd,
    agentDir: input.agentDir,
    ...(childModel ? { model: childModel } : {}),
    thinkingLevel: childThinkingLevel,
    ...(profile.tools ? { tools: [...profile.tools] } : {}),
    modelRegistry: input.ctx.modelRegistry,
    resourceLoader,
    policy: {
      agentMode: profile.agentMode,
      interactionMode: "agent",
      modelSelection,
      fast: false,
      thinkingLevel: productThinkingLevel,
      // The effective allowlist is driven by the `tools` option above (create derives the policy's
      // allowedToolNames from it); leave this empty so we don't fight the branded policy type.
      allowedToolNames: [],
      excludedToolNames: [],
    },
  });
  input.loadedChildren.set(run.subagentThreadId, {
    active: true,
    disposed: false,
    lastUsedAt: Date.now(),
    dispose: () => runtime.dispose(),
  });

  const unsubscribe = runtime.subscribe((event) => {
    captureChildEvent(input.state, run, event);
    input.notify?.();
  });
  const abortChild = () => {
    void runtime.abort();
  };
  input.signal?.addEventListener("abort", abortChild, { once: true });

  try {
    await runtime.bindExtensions();
    if (input.signal?.aborted) {
      throw new Error("Subagent aborted.");
    }
    const childMessage = task.context
      ? `Context:\n${task.context}\n\nTask:\n${task.prompt}`
      : task.prompt;
    await runtime.sendMessage(childMessage, {
      clientMessageId: null,
      replacesClientMessageId: null,
      interactionMode: "agent",
      sourceProposedPlan: null,
      images: [],
      expandPromptTemplates: null,
      source: "extension",
      streamingBehavior: null,
    });
    await runtime.session.agent.waitForIdle();
    run.finalText = run.lastAssistantText.trim().length > 0 ? run.lastAssistantText : null;
    run.state = input.signal?.aborted ? "aborted" : "completed";
    pushActivity(input.state, run, "subagent.thread.state.changed", `Completed ${title}`, {
      state: run.state,
    });
  } catch (error) {
    run.state = input.signal?.aborted ? "aborted" : "failed";
    run.errorMessage = error instanceof Error ? error.message : "Subagent failed.";
    pushActivity(input.state, run, "subagent.thread.state.changed", run.errorMessage, {
      state: run.state,
      detail: run.errorMessage,
    });
  } finally {
    input.signal?.removeEventListener("abort", abortChild);
    unsubscribe();
    const loaded = input.loadedChildren.get(run.subagentThreadId);
    if (loaded) {
      loaded.active = false;
      loaded.lastUsedAt = Date.now();
    }
    evictIdleSubagentRuntimes({
      loadedChildren: input.loadedChildren,
      maxLoadedIdleChildren: DEFAULT_SUBAGENT_BUDGET_LIMITS.maxLoadedIdleChildren,
    });
    input.notify?.();
  }

  return run;
}

async function runSubagentTasksWithBudget(input: {
  readonly preparedTasks: readonly PreparedSubagentTask[];
  readonly parentSessionId: string;
  readonly toolCallId: string;
  readonly budget: SubagentBudgetController;
  readonly signal: AbortSignal | undefined;
  readonly runTask: (prepared: PreparedSubagentTask, index: number) => Promise<MutableSubagentRun>;
  readonly onNotStarted: (
    prepared: PreparedSubagentTask,
    error: unknown,
    index: number,
  ) => MutableSubagentRun;
  readonly onStarted: (prepared: PreparedSubagentTask, index: number) => void;
}): Promise<MutableSubagentRun[]> {
  const results: MutableSubagentRun[] = Array.from({ length: input.preparedTasks.length });

  await Promise.all(
    input.preparedTasks.map(async (prepared, index) => {
      let lease: Awaited<ReturnType<SubagentBudgetController["acquireSlot"]>> | null = null;
      try {
        lease = await input.budget.acquireSlot({
          parentSessionId: input.parentSessionId,
          toolCallId: input.toolCallId,
          profileName: prepared.profile.name,
          signal: input.signal,
        });
        input.onStarted(prepared, index);
        results[index] = await input.runTask(prepared, index);
      } catch (error) {
        if (prepared.run.state === "queued" || prepared.run.state === "running") {
          results[index] = input.onNotStarted(prepared, error, index);
          return;
        }
        throw error;
      } finally {
        lease?.release();
      }
    }),
  );
  return results;
}

function resultTextForRun(run: MutableSubagentRun): string {
  if (run.state === "failed" || run.state === "aborted") {
    return run.errorMessage ?? `${run.nickname} ${run.state}.`;
  }
  return run.finalText ?? "(no output)";
}

function subagentToolOverride(tools: readonly string[]): readonly string[] {
  return tools.filter((tool) => tool !== "subagent");
}

function backgroundStartedText(details: SubagentToolDetails): string {
  if (details.mode === "chain") {
    return "Subagent chain running.";
  }
  return details.runs.length === 1
    ? "1 subagent running."
    : `${details.runs.length} subagents running.`;
}

function safeNotificationText(text: string): string {
  return text.replaceAll("</response>", "</ response>").replaceAll("</agent_notification>", "</ agent_notification>");
}

function backgroundNotificationForDetails(details: SubagentToolDetails): string | null {
  if (details.runs.length === 0) {
    return null;
  }
  const text = details.runs
    .map((run) => {
      const status =
        run.state === "completed" ? "success" : run.state === "aborted" ? "aborted" : "error";
      const response = safeNotificationText(
        truncateSubagentOutputForParent({
          text: run.finalText ?? run.errorMessage ?? run.state,
          maxBytes: DEFAULT_SUBAGENT_BUDGET_LIMITS.maxParentVisibleOutputBytesPerRun,
        }),
      );
      return [
        "<agent_notification>",
        "kind: subagent",
        `agent_id: ${run.subagentThreadId}`,
        `status: ${status}`,
        `title: ${run.nickname}`,
        "response:",
        "<response>",
        response,
        "</response>",
        "</agent_notification>",
      ].join("\n");
    })
    .join("\n\n");
  return truncateSubagentOutputForParent({
    text,
    maxBytes: DEFAULT_SUBAGENT_BUDGET_LIMITS.maxParentVisibleOutputBytesPerToolCall,
  });
}

function subagentDetailsHasError(details: SubagentToolDetails): boolean {
  return details.runs.some((run) => run.state === "failed" || run.state === "aborted");
}

export function createSubagentExtension(options: SubagentExtensionOptions): ExtensionFactory {
  const depth = options.depth ?? 0;
  const maxSubagentDepth = options.maxSubagentDepth ?? DEFAULT_MAX_SUBAGENT_DEPTH;
  const extensionPaths = options.extensionPaths ?? [];
  const budget = createSubagentBudgetController(DEFAULT_SUBAGENT_BUDGET_LIMITS);
  const loadedChildren = new Map<string, LoadedSubagentRuntime>();
  return (pi) => {
    if (typeof pi.on === "function") {
      pi.on("session_shutdown", () => {
        disposeLoadedSubagentRuntimes(loadedChildren);
      });
    }
    // Recursion guard: an agent at or beyond the depth cap never receives the subagent tool, so it
    // cannot fan out further no matter what its prompt asks. Children only reach this code when their
    // profile authorized fanout (see runSubagentTask), so the cap is the only remaining gate here.
    if (depth >= maxSubagentDepth) {
      return;
    }
    pi.registerTool(
      defineTool({
        name: "subagent",
        label: "Subagent",
        description:
          "Delegate a focused task to a separate subagent running in its own context. In Honk Multitask mode, this is the primary way to start background implementation, research, review, or verification work. Omit agent for the default Worker, use librarian for fast codebase research, or oracle for deep analysis and debugging. Include a concise visible description for the GUI while it runs. Supports single prompt, parallel tasks, and chain steps where {previous} carries the prior step output.",
        promptSnippet:
          "Use subagent for independent implementation, research, review, or verification work; in Honk Multitask mode set runInBackground: true before doing broad local work. Give it complete context, a precise expected output, and a concise present-participle description shown while it runs.",
        promptGuidelines: [
          "In Honk Multitask mode, use this tool early with runInBackground: true for non-trivial work instead of doing all exploration and edits yourself.",
          "Omit agent for normal Worker/default tasks; include a short visible description such as 'working through type errors'.",
          "Use agent: 'librarian' for fast codebase reconnaissance and file/symbol mapping; pair it with a description such as 'researching session IDs'.",
          "Use agent: 'oracle' for Oracle-style deep reasoning, debugging, architecture analysis, and tradeoff review; pair it with a description such as 'manifesting a migration plan'.",
          "The legacy value 'general-purpose' is accepted but not preferred; omit agent for default Worker tasks instead.",
          "Give each subagent all required context: goal, relevant files, constraints, and expected output. The child cannot see this conversation unless you pass context.",
          "Use parallel tasks only when the tasks are independent.",
          "Use chain when each step depends on the previous step's output via {previous}.",
          "In Honk Multitask mode, set runInBackground: true so independent work continues while the parent returns control.",
          "Do not delegate trivial work you can do with one local read or search.",
        ],
        parameters: SubagentParams,
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          const agentDir = options.agentDir;
          const hasChain = (params.chain?.length ?? 0) > 0;
          const hasTasks = (params.tasks?.length ?? 0) > 0;
          const hasSingle = Boolean(params.prompt);
          const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
          const mode: SubagentMode = hasChain ? "chain" : hasTasks ? "parallel" : "single";
          const thinkingOverride = normalizeAgentThinkingLevel(params.thinkingLevel);
          const sharedOverrides: SubagentProfileOverrides = {
            ...(params.model ? { model: params.model } : {}),
            ...(thinkingOverride ? { thinkingLevel: thinkingOverride } : {}),
            ...(params.tools && params.tools.length > 0
              ? { tools: subagentToolOverride(params.tools) }
              : {}),
          };
          // Resolve a built-in profile per task, then apply per-call overrides. Per-task agent/model
          // values win over the shared defaults. Unknown agent types throw before any child starts.
          const resolveProfileForTask = (taskAgent?: string, taskModel?: string) =>
            resolveSubagentProfile({
              name: taskAgent ?? params.agent ?? null,
              overrides: { ...sharedOverrides, ...(taskModel ? { model: taskModel } : {}) },
            });
          const state = createExecutionState(mode);
          const runInBackground = params.runInBackground === true;
          let backgroundController = runInBackground
            ? backgroundSubagentControllerForSession(ctx.sessionManager.getSessionId())
            : null;
          let backgroundRegistered = false;
          let canPublishToolUpdates = true;
          // Compute + publish the combined details at most ~10 Hz (trailing edge). runSubagentTask
          // calls `notify()` on every child event; the throttle reads the current `state` only when
          // it actually fires, so the expensive `toolDetails` copy no longer runs per child chunk.
          const publisher = onUpdate || backgroundController
            ? createTrailingThrottle(() => {
                const details = capLiveSubagentActivities(toolDetails(state));
                if (onUpdate && canPublishToolUpdates) {
                  onUpdate({
                    content: [{ type: "text", text: summarizeSubagentDetails(details) }],
                    details,
                  });
                }
                if (backgroundRegistered) {
                  backgroundController?.emitBackgroundSubagentUpdate(toolCallId);
                }
              }, SUBAGENT_PUBLISH_INTERVAL_MS)
            : null;
          const notify = publisher ? () => publisher.schedule() : undefined;

          if (modeCount !== 1) {
            const details = toolDetails(state);
            return {
              content: [
                {
                  type: "text",
                  text: "Invalid subagent parameters. Provide exactly one of prompt, tasks, or chain.",
                },
              ],
              details,
            };
          }

          const requestedTaskCount = hasChain
            ? (params.chain?.length ?? 0)
            : hasTasks
              ? (params.tasks?.length ?? 0)
              : hasSingle
                ? 1
                : 0;
          if (!budget.canAcceptTaskCount(requestedTaskCount)) {
            const details = toolDetails(state);
            return {
              content: [
                {
                  type: "text",
                  text: `Too many subagent tasks. Max is ${DEFAULT_SUBAGENT_BUDGET_LIMITS.maxTasksPerToolCall}.`,
                },
              ],
              details,
            };
          }

          if (runInBackground) {
            if (!backgroundController || !backgroundController.canRunBackgroundSubagent()) {
              const details = toolDetails(state);
              return {
                content: [
                  {
                    type: "text",
                    text: "Background subagents are only available in Honk Multitask mode.",
                  },
                ],
                details,
              };
            }
            if (!backgroundController.activeBackgroundSubagentTurnId()) {
              const details = toolDetails(state);
              return {
                content: [
                  {
                    type: "text",
                    text: "Cannot start background subagents before a parent turn is active.",
                  },
                ],
                details,
              };
            }
          }

          if (params.agent !== undefined) {
            resolveSubagentProfile({ name: params.agent, overrides: sharedOverrides });
          }
          const chainProfiles = params.chain?.map((step) =>
            resolveProfileForTask(step.agent, step.model),
          );
          const taskProfiles = params.tasks?.map((task) =>
            resolveProfileForTask(task.agent, task.model),
          );
          const singleProfile = params.prompt ? resolveProfileForTask(undefined, undefined) : null;
          const parentSessionId = ctx.sessionManager.getSessionId();

          const executePreparedTasks = async (
            preparedTasks: readonly PreparedSubagentTask[],
            runSignal: AbortSignal | undefined,
          ): Promise<MutableSubagentRun[]> => {
            return runSubagentTasksWithBudget({
              preparedTasks,
              parentSessionId,
              toolCallId,
              budget,
              signal: runSignal,
              runTask: (prepared) =>
                runSubagentTask({
                  state,
                  prepared,
                  agentDir,
                  extensionPaths,
                  ctx,
                  signal: runSignal,
                  depth,
                  maxSubagentDepth,
                  loadedChildren,
                  notify,
                }),
              onStarted: (prepared) => {
                markPreparedSubagentRunning({ state, prepared, notify });
              },
              onNotStarted: (prepared, error) =>
                markPreparedSubagentNotStarted({
                  state,
                  prepared,
                  signal: runSignal,
                  error,
                  notify,
                }),
            });
          };

          const executeRuns = async (runSignal: AbortSignal | undefined): Promise<void> => {
            if (params.chain && params.chain.length > 0) {
              let previousOutput = "";
              for (let index = 0; index < params.chain.length; index += 1) {
                const step = params.chain[index];
                if (!step) {
                  continue;
                }
                const prepared = prepareSubagentTask({
                  state,
                  parentThreadId: parentSessionId,
                  toolCallId,
                  task: {
                    prompt: step.prompt.replaceAll("{previous}", previousOutput),
                    description: step.description ?? null,
                    cwd: step.cwd ?? null,
                    step: index + 1,
                    context: step.context ?? params.context ?? null,
                  },
                  ctx,
                  thinkingLevel: pi.getThinkingLevel(),
                  profile: chainProfiles?.[index] ?? resolveProfileForTask(step.agent, step.model),
                  notify,
                });
                const [run] = await executePreparedTasks([prepared], runSignal);
                if (!run) {
                  break;
                }
                previousOutput = resultTextForRun(run);
                if (run.state !== "completed") {
                  break;
                }
              }
            } else if (params.tasks && params.tasks.length > 0) {
              const preparedTasks = params.tasks.map((task, index) =>
                prepareSubagentTask({
                  state,
                  parentThreadId: parentSessionId,
                  toolCallId,
                  task: {
                    prompt: task.prompt,
                    description: task.description ?? null,
                    cwd: task.cwd ?? null,
                    step: null,
                    context: task.context ?? params.context ?? null,
                  },
                  ctx,
                  thinkingLevel: pi.getThinkingLevel(),
                  profile: taskProfiles?.[index] ?? resolveProfileForTask(task.agent, task.model),
                  notify,
                }),
              );
              await executePreparedTasks(preparedTasks, runSignal);
            } else if (params.prompt) {
              const prepared = prepareSubagentTask({
                state,
                parentThreadId: parentSessionId,
                toolCallId,
                task: {
                  prompt: params.prompt,
                  description: params.description ?? null,
                  cwd: params.cwd ?? null,
                  step: null,
                  context: params.context ?? null,
                },
                ctx,
                thinkingLevel: pi.getThinkingLevel(),
                profile: singleProfile!,
                notify,
              });
              await executePreparedTasks([prepared], runSignal);
            }
          };

          if (runInBackground && backgroundController) {
            const backgroundAbort = new AbortController();
            const abortBeforeReturn = () => {
              backgroundAbort.abort();
            };
            signal?.addEventListener("abort", abortBeforeReturn, { once: true });
            const completion = executeRuns(backgroundAbort.signal).then(() => {
              publisher?.flush();
              const details = toolDetails(state);
              return {
                details,
                isError: subagentDetailsHasError(details),
                notificationText: backgroundNotificationForDetails(details),
              };
            });
            const turnId = backgroundController.activeBackgroundSubagentTurnId();
            backgroundController.registerBackgroundSubagent({
              toolCallId,
              turnId,
              currentDetails: () => toolDetails(state),
              currentLiveDetails: () => capLiveSubagentActivities(toolDetails(state)),
              summarize: summarizeSubagentDetails,
              abort: () => {
                backgroundAbort.abort();
              },
              completion,
            });
            backgroundRegistered = true;
            publisher?.flush();
            canPublishToolUpdates = false;
            signal?.removeEventListener("abort", abortBeforeReturn);
            const details = capLiveSubagentActivities(toolDetails(state));
            return {
              content: [{ type: "text", text: backgroundStartedText(details) }],
              details,
            };
          }

          await executeRuns(signal);

          publisher?.flush();
          const details = toolDetails(state);
          return {
            content: [{ type: "text", text: summarizeSubagentDetails(details) }],
            details,
          };
        },
      }),
    );
  };
}

function summarizeSubagentDetails(details: SubagentToolDetails): string {
  if (details.runs.length === 0) {
    return "No subagents ran.";
  }
  const queued = details.runs.filter((run) => run.state === "queued").length;
  const running = details.runs.filter((run) => run.state === "running").length;
  const completed = details.runs.filter((run) => run.state === "completed").length;
  const failed = details.runs.filter((run) => run.state === "failed").length;
  const aborted = details.runs.filter((run) => run.state === "aborted").length;
  const summary = summarizeSubagentRunCounts({
    total: details.runs.length,
    queued,
    running,
    completed,
    failed,
    aborted,
  });
  const outputs = details.runs.map(
    (run) =>
      `### ${run.nickname}\n\n${truncateSubagentOutputForParent({
        text: run.finalText ?? run.errorMessage ?? run.state,
        maxBytes: DEFAULT_SUBAGENT_BUDGET_LIMITS.maxParentVisibleOutputBytesPerRun,
      })}`,
  );
  return truncateSubagentOutputForParent({
    text: `${summary}\n\n${outputs.join("\n\n---\n\n")}`,
    maxBytes: DEFAULT_SUBAGENT_BUDGET_LIMITS.maxParentVisibleOutputBytesPerToolCall,
  });
}

function summarizeSubagentRunCounts(input: {
  readonly total: number;
  readonly queued: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly aborted: number;
}): string {
  const active = input.queued + input.running;
  if (active > 0) {
    return input.running > 0
      ? `${active} ${pluralize("subagent", active)} running`
      : active === 1
        ? "Starting up"
        : `${active} subagents starting`;
  }
  if (input.failed > 0) {
    return input.failed === 1 ? "Background task failed" : "Background tasks failed";
  }
  if (input.aborted > 0) {
    return input.aborted === 1 ? "Background task stopped" : "Background tasks stopped";
  }
  if (input.completed > 0) {
    return input.completed === 1 ? "Background task completed" : "Background tasks completed";
  }
  return `${input.total} ${pluralize("subagent", input.total)}`;
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}
