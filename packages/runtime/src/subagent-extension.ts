import {
  DefaultResourceLoader,
  defineTool,
  type ExtensionContext,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
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
} from "@multi/contracts";
import { ThreadAgentRuntime } from "./thread-agent-runtime";
import {
  accountIdFromProvider,
  authProviderIdFromPiModel,
  modelIdFromPiModel,
} from "./auth-model-policy";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const MAX_TASK_DESCRIPTION_LENGTH = 80;
const AGENT_THINKING_LEVEL_SET: ReadonlySet<ThinkingLevel> = new Set(AGENT_THINKING_LEVELS);

function isAgentThinkingLevel(level: ThinkingLevel): level is AgentThinkingLevel {
  return AGENT_THINKING_LEVEL_SET.has(level);
}

interface SubagentExtensionOptions {
  readonly agentDir: string;
}

interface SubagentTask {
  readonly prompt: string;
  readonly description: string | null;
  readonly cwd: string | null;
  readonly step: number | null;
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
  lastThinkingText: string;
}

interface SubagentExecutionState {
  readonly mode: SubagentMode;
  readonly agentScope: "user";
  readonly projectAgentsDir: string | null;
  readonly runs: MutableSubagentRun[];
  readonly activities: SubagentActivityDetails[];
  sequence: number;
}

const TaskItem = Type.Object({
  prompt: Type.String({ description: "Specific prompt to run in the subagent." }),
  description: Type.Optional(
    Type.String({ description: "Short display label for this subagent task." }),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory for this subagent run." })),
});

const ChainItem = Type.Object({
  prompt: Type.String({
    description: "Specific prompt. Use {previous} to include the prior step output.",
  }),
  description: Type.Optional(
    Type.String({ description: "Short display label for this chain step." }),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory for this chain step." })),
});

const SubagentParams = Type.Object({
  prompt: Type.Optional(Type.String({ description: "Specific prompt for a single subagent." })),
  description: Type.Optional(
    Type.String({ description: "Short display label for the single subagent task." }),
  ),
  tasks: Type.Optional(Type.Array(TaskItem, { description: "Parallel subagent tasks." })),
  chain: Type.Optional(Type.Array(ChainItem, { description: "Sequential subagent tasks." })),
  cwd: Type.Optional(Type.String({ description: "Working directory for single mode." })),
});

function nowIso(): string {
  return new Date().toISOString();
}

function createExecutionState(mode: SubagentMode): SubagentExecutionState {
  return {
    mode,
    agentScope: "user",
    projectAgentsDir: null,
    runs: [],
    activities: [],
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
    agentScope: state.agentScope,
    projectAgentsDir: state.projectAgentsDir,
    runs: state.runs.map(runSnapshot),
    activities: [...state.activities],
  };
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
  state.sequence += 1;
  state.activities.push({
    id: `runtime-subagent:${run.parentItemId}:${run.subagentThreadId}:${state.sequence}`,
    kind,
    tone: kind === "subagent.thread.state.changed" && payload.state === "failed" ? "error" : "info",
    summary,
    createdAt: nowIso(),
    sequence: state.sequence,
    payload: basePayload(run, payload),
  });
}

function modelLabel(ctx: ExtensionContext): string | null {
  return ctx.model?.id ?? null;
}

function policyThinkingLevel(level: ThinkingLevel): AgentModelPolicy["thinkingLevel"] | null {
  return isAgentThinkingLevel(level) ? level : null;
}

function createMutableRun(input: {
  readonly parentThreadId: string;
  readonly toolCallId: string;
  readonly task: SubagentTask;
  readonly ctx: ExtensionContext;
}): MutableSubagentRun {
  const subagentThreadId = `${input.parentThreadId}:subagent:${input.toolCallId}:${crypto.randomUUID()}`;
  const title = taskDisplayName(input.task);
  return {
    subagentThreadId,
    agentId: subagentThreadId,
    nickname: title,
    role: "general-purpose",
    model: modelLabel(input.ctx),
    prompt: input.task.prompt,
    parentThreadId: input.parentThreadId,
    parentItemId: input.toolCallId,
    state: "running",
    finalText: null,
    errorMessage: null,
    lastAssistantText: "",
    lastThinkingText: "",
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
  if (event.type === "message.updated" || event.type === "message.completed") {
    const text = event.text?.trim();
    if (text && text !== run.lastAssistantText) {
      run.lastAssistantText = text;
      run.finalText = text;
      pushActivity(
        state,
        run,
        event.type === "message.completed" ? "subagent.item.completed" : "subagent.item.updated",
        "Subagent response",
        {
          itemType: "assistant_message",
          itemId: `assistant:${event.turnId ?? event.id}`,
          status: event.type === "message.completed" ? "completed" : "running",
          title: "Assistant",
          detail: text,
        },
      );
    }

    const thinking = event.thinking?.trim();
    if (thinking && thinking !== run.lastThinkingText) {
      run.lastThinkingText = thinking;
      pushActivity(
        state,
        run,
        event.type === "message.completed" ? "subagent.item.completed" : "subagent.item.updated",
        "Subagent reasoning",
        {
          itemType: "reasoning",
          itemId: `reasoning:${event.turnId ?? event.id}`,
          status: event.type === "message.completed" ? "completed" : "running",
          title: "Reasoning",
          detail: thinking,
        },
      );
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
    const detail = toolResultText(result);
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
        data,
      },
    );
  }
}

async function runSubagentTask(input: {
  readonly state: SubagentExecutionState;
  readonly parentThreadId: string;
  readonly toolCallId: string;
  readonly task: SubagentTask;
  readonly agentDir: string;
  readonly ctx: ExtensionContext;
  readonly signal: AbortSignal | undefined;
  readonly thinkingLevel: ThinkingLevel;
  readonly onUpdate: ((details: SubagentToolDetails) => void) | undefined;
}): Promise<MutableSubagentRun> {
  const run = createMutableRun({
    parentThreadId: input.parentThreadId,
    toolCallId: input.toolCallId,
    task: input.task,
    ctx: input.ctx,
  });
  const title = taskDisplayName(input.task);
  input.state.runs.push(run);
  pushActivity(input.state, run, "subagent.thread.started", `Started ${title}`, {
    state: "running",
  });
  pushActivity(input.state, run, "subagent.item.completed", "Subagent task", {
    itemType: "user_message",
    itemId: `task:${run.subagentThreadId}`,
    status: "completed",
    title: "Task",
    detail: input.task.prompt,
  });
  input.onUpdate?.(toolDetails(input.state));

  const resourceLoader = new DefaultResourceLoader({
    cwd: input.task.cwd ?? input.ctx.cwd,
    agentDir: input.agentDir,
    extensionFactories: [],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  const productThinkingLevel = policyThinkingLevel(input.thinkingLevel);
  const modelSelection: AgentModelPolicy["modelSelection"] = input.ctx.model
    ? {
        type: "explicit",
        authProviderId: authProviderIdFromPiModel(input.ctx.model),
        accountId: accountIdFromProvider(input.ctx.model.provider),
        modelId: modelIdFromPiModel(input.ctx.model),
      }
    : { type: "pi-managed" };
  const runtime = await ThreadAgentRuntime.create({
    threadId: ThreadId.make(run.subagentThreadId),
    cwd: input.task.cwd ?? input.ctx.cwd,
    agentDir: input.agentDir,
    ...(input.ctx.model ? { model: input.ctx.model } : {}),
    thinkingLevel: input.thinkingLevel,
    modelRegistry: input.ctx.modelRegistry,
    resourceLoader,
    policy: {
      agentMode: "smart",
      interactionMode: "agent",
      modelSelection,
      thinkingLevel: productThinkingLevel,
      allowedToolNames: [],
      excludedToolNames: [],
    },
  });

  const unsubscribe = runtime.subscribe((event) => {
    captureChildEvent(input.state, run, event);
    input.onUpdate?.(toolDetails(input.state));
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
    await runtime.sendMessage(input.task.prompt, {
      clientMessageId: null,
      interactionMode: "agent",
      sourceProposedPlan: null,
      images: [],
      expandPromptTemplates: null,
      source: "extension",
      streamingBehavior: null,
    });
    await runtime.session.agent.waitForIdle();
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
    runtime.dispose();
    input.onUpdate?.(toolDetails(input.state));
  }

  return run;
}

async function mapWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const results: TOut[] = Array.from({ length: items.length });
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      const item = items[index];
      if (item !== undefined) {
        results[index] = await fn(item, index);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function resultTextForRun(run: MutableSubagentRun): string {
  if (run.state === "failed" || run.state === "aborted") {
    return run.errorMessage ?? `${run.nickname} ${run.state}.`;
  }
  return run.finalText ?? "(no output)";
}

export function createSubagentExtension(options: SubagentExtensionOptions): ExtensionFactory {
  return (pi) => {
    pi.registerTool(
      defineTool({
        name: "subagent",
        label: "Subagent",
        description:
          "Spawn embedded child Pi sessions for specific task prompts with isolated context.",
        promptSnippet:
          "Use subagent to run isolated research, planning, review, or implementation work from a specific prompt.",
        promptGuidelines: [
          "Write the prompt with all context the subagent needs; do not rely on a named subagent role.",
          "Use parallel tasks when delegated work can run independently.",
          "Use chain mode when each step should receive the previous step output through {previous}.",
        ],
        parameters: SubagentParams,
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          const agentDir = options.agentDir;
          const hasChain = (params.chain?.length ?? 0) > 0;
          const hasTasks = (params.tasks?.length ?? 0) > 0;
          const hasSingle = Boolean(params.prompt);
          const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
          const mode: SubagentMode = hasChain ? "chain" : hasTasks ? "parallel" : "single";
          const state = createExecutionState(mode);
          const publish = onUpdate
            ? (details: SubagentToolDetails) => {
                onUpdate({
                  content: [{ type: "text", text: summarizeSubagentDetails(details) }],
                  details,
                });
              }
            : undefined;

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

          if (hasTasks && params.tasks && params.tasks.length > MAX_PARALLEL_TASKS) {
            const details = toolDetails(state);
            return {
              content: [
                {
                  type: "text",
                  text: `Too many parallel subagent tasks. Max is ${MAX_PARALLEL_TASKS}.`,
                },
              ],
              details,
            };
          }

          if (params.chain && params.chain.length > 0) {
            let previousOutput = "";
            for (let index = 0; index < params.chain.length; index += 1) {
              const step = params.chain[index];
              if (!step) {
                continue;
              }
              const run = await runSubagentTask({
                state,
                parentThreadId: ctx.sessionManager.getSessionId(),
                toolCallId,
                task: {
                  prompt: step.prompt.replaceAll("{previous}", previousOutput),
                  description: step.description ?? null,
                  cwd: step.cwd ?? null,
                  step: index + 1,
                },
                agentDir,
                ctx,
                signal,
                thinkingLevel: pi.getThinkingLevel(),
                onUpdate: publish,
              });
              previousOutput = resultTextForRun(run);
              if (run.state !== "completed") {
                break;
              }
            }
          } else if (params.tasks && params.tasks.length > 0) {
            await mapWithConcurrency(params.tasks, MAX_CONCURRENCY, (task) =>
              runSubagentTask({
                state,
                parentThreadId: ctx.sessionManager.getSessionId(),
                toolCallId,
                task: {
                  prompt: task.prompt,
                  description: task.description ?? null,
                  cwd: task.cwd ?? null,
                  step: null,
                },
                agentDir,
                ctx,
                signal,
                thinkingLevel: pi.getThinkingLevel(),
                onUpdate: publish,
              }),
            );
          } else if (params.prompt) {
            await runSubagentTask({
              state,
              parentThreadId: ctx.sessionManager.getSessionId(),
              toolCallId,
              task: {
                prompt: params.prompt,
                description: params.description ?? null,
                cwd: params.cwd ?? null,
                step: null,
              },
              agentDir,
              ctx,
              signal,
              thinkingLevel: pi.getThinkingLevel(),
              onUpdate: publish,
            });
          }

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
  const completed = details.runs.filter((run) => run.state === "completed").length;
  const failed = details.runs.filter((run) => run.state === "failed").length;
  const aborted = details.runs.filter((run) => run.state === "aborted").length;
  const parts = [`Subagents: ${completed}/${details.runs.length} completed`];
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }
  if (aborted > 0) {
    parts.push(`${aborted} aborted`);
  }
  const outputs = details.runs.map(
    (run) => `### ${run.nickname}\n\n${run.finalText ?? run.errorMessage ?? run.state}`,
  );
  return `${parts.join(", ")}\n\n${outputs.join("\n\n---\n\n")}`;
}
