import type { ThreadTokenUsageCategory, ThreadTokenUsageSnapshot } from "@honk/contracts";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";

export interface ContextUsageSnapshotSink {
  readonly publish: (snapshot: ThreadTokenUsageSnapshot) => void;
}

interface ContextUsageCategoryDefinition {
  readonly id: string;
  readonly label: string;
}

const STATIC_CATEGORY_ORDER = [
  "system_prompt",
  "tool_definitions",
  "rules",
  "skills",
  "mcp",
  "subagents",
  "summarized_conversation",
] as const;

type StaticCategoryId = (typeof STATIC_CATEGORY_ORDER)[number];

const CATEGORY_DEFINITIONS: Record<
  StaticCategoryId | "conversation",
  ContextUsageCategoryDefinition
> = {
  system_prompt: { id: "system_prompt", label: "System prompt" },
  tool_definitions: { id: "tool_definitions", label: "Tool definitions" },
  rules: { id: "rules", label: "Rules" },
  skills: { id: "skills", label: "Skills" },
  mcp: { id: "mcp", label: "MCP" },
  subagents: { id: "subagents", label: "Subagent definitions" },
  summarized_conversation: { id: "summarized_conversation", label: "Summarized conversation" },
  conversation: { id: "conversation", label: "Conversation" },
};

const SUBAGENT_TOOL_NAME = "subagent";

interface ContextUsageState {
  staticCategoryTokens: Map<StaticCategoryId, number>;
  cumulativeInputTokens: number;
  cumulativeCachedInputTokens: number;
  cumulativeOutputTokens: number;
  lastUsage: Usage | null;
  toolUses: number;
  turnStartedAtMs: number | null;
  lastTurnDurationMs: number | null;
}

function createInitialState(): ContextUsageState {
  return {
    staticCategoryTokens: new Map(),
    cumulativeInputTokens: 0,
    cumulativeCachedInputTokens: 0,
    cumulativeOutputTokens: 0,
    lastUsage: null,
    toolUses: 0,
    turnStartedAtMs: null,
    lastTurnDurationMs: null,
  };
}

function asNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function estimateTextTokens(text: unknown): number {
  return typeof text === "string" && text.length > 0 ? Math.ceil(text.length / 4) : 0;
}

function estimateContentTokens(content: unknown): number {
  if (typeof content === "string") {
    return estimateTextTokens(content);
  }
  if (!Array.isArray(content)) {
    return 0;
  }

  let tokens = 0;
  for (const block of content) {
    if (typeof block !== "object" || block === null) {
      continue;
    }
    const record = block as { readonly type?: unknown; readonly text?: unknown };
    if (record.type === "text") {
      tokens += estimateTextTokens(record.text);
    } else if (record.type === "image") {
      tokens += 1_200;
    }
  }
  return tokens;
}

function estimateMessageTokens(message: unknown): number {
  if (typeof message !== "object" || message === null) {
    return 0;
  }
  const record = message as {
    readonly role?: unknown;
    readonly content?: unknown;
    readonly command?: unknown;
    readonly output?: unknown;
    readonly summary?: unknown;
  };

  switch (record.role) {
    case "user":
    case "custom":
    case "toolResult":
      return estimateContentTokens(record.content);
    case "assistant": {
      if (!Array.isArray(record.content)) {
        return estimateTextTokens(record.content);
      }
      let tokens = 0;
      for (const block of record.content) {
        if (typeof block !== "object" || block === null) {
          continue;
        }
        const content = block as {
          readonly type?: unknown;
          readonly text?: unknown;
          readonly thinking?: unknown;
          readonly name?: unknown;
          readonly arguments?: unknown;
        };
        if (content.type === "text") {
          tokens += estimateTextTokens(content.text);
        } else if (content.type === "thinking") {
          tokens += estimateTextTokens(content.thinking);
        } else if (content.type === "toolCall") {
          let serializedArguments = "";
          try {
            serializedArguments = JSON.stringify(content.arguments ?? {}) ?? "";
          } catch {
            serializedArguments = "";
          }
          tokens += estimateTextTokens(content.name) + estimateTextTokens(serializedArguments);
        }
      }
      return tokens;
    }
    case "bashExecution": {
      const command = typeof record.command === "string" ? record.command : "";
      const output = typeof record.output === "string" ? record.output : "";
      return estimateTextTokens(`${command}${output}`);
    }
    case "branchSummary":
    case "compactionSummary":
      return estimateTextTokens(record.summary);
    default:
      return 0;
  }
}

function estimateSessionEntryTokens(entry: unknown): number {
  if (typeof entry !== "object" || entry === null) {
    return 0;
  }
  const record = entry as {
    readonly type?: unknown;
    readonly message?: unknown;
    readonly content?: unknown;
    readonly summary?: unknown;
  };
  if (record.type === "message") {
    return estimateMessageTokens(record.message);
  }
  if (record.type === "custom_message") {
    return estimateMessageTokens({ role: "custom", content: record.content });
  }
  if (record.type === "branch_summary") {
    return estimateMessageTokens({ role: "branchSummary", summary: record.summary });
  }
  return 0;
}

function asUsage(value: unknown): Usage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const usage = value as Partial<Usage>;
  if (
    typeof usage.input !== "number" ||
    typeof usage.output !== "number" ||
    typeof usage.cacheRead !== "number" ||
    typeof usage.cacheWrite !== "number"
  ) {
    return null;
  }
  return usage as Usage;
}

function assistantUsageForMessage(message: unknown): Usage | null {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const record = message as { role?: unknown; usage?: unknown };
  if (record.role !== "assistant") {
    return null;
  }
  return asUsage(record.usage);
}

function contextTokensForUsage(usage: Usage): number {
  const total = asNonNegativeInteger(usage.totalTokens);
  if (total > 0) {
    return total;
  }
  return (
    asNonNegativeInteger(usage.input) +
    asNonNegativeInteger(usage.output) +
    asNonNegativeInteger(usage.cacheRead) +
    asNonNegativeInteger(usage.cacheWrite)
  );
}

function estimateToolDefinitionTokens(tool: {
  readonly name: string;
  readonly description?: string;
  readonly parameters?: unknown;
  readonly promptGuidelines?: readonly string[] | undefined;
}): number {
  let serializedParameters = "";
  try {
    serializedParameters = tool.parameters === undefined ? "" : JSON.stringify(tool.parameters);
  } catch {
    serializedParameters = "";
  }
  return (
    estimateTextTokens(tool.name) +
    estimateTextTokens(tool.description ?? "") +
    estimateTextTokens(serializedParameters) +
    estimateTextTokens((tool.promptGuidelines ?? []).join("\n"))
  );
}

function isMcpToolName(name: string): boolean {
  return name.startsWith("mcp__") || name.startsWith("mcp_");
}

export function createContextUsageExtension(sink: ContextUsageSnapshotSink): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const state = createInitialState();

    const staticTokenTotal = () => {
      let total = 0;
      for (const tokens of state.staticCategoryTokens.values()) {
        total += Math.max(0, Math.round(tokens));
      }
      return total;
    };

    const estimateCurrentConversationTokens = (
      ctx: { readonly sessionManager: { readonly getBranch: () => readonly unknown[] } },
      compactionEntry: { readonly id?: unknown; readonly firstKeptEntryId?: unknown },
    ): number => {
      let branchEntries: readonly unknown[] = [];
      try {
        branchEntries = ctx.sessionManager.getBranch();
      } catch {
        return 0;
      }

      const compactionIndex = branchEntries.findIndex((entry) => {
        if (typeof entry !== "object" || entry === null) {
          return false;
        }
        const candidate = entry as { readonly id?: unknown; readonly type?: unknown };
        return candidate.type === "compaction" && candidate.id === compactionEntry.id;
      });
      const latestCompactionIndex =
        compactionIndex >= 0
          ? compactionIndex
          : branchEntries.findLastIndex((entry) => {
              if (typeof entry !== "object" || entry === null) {
                return false;
              }
              return (entry as { readonly type?: unknown }).type === "compaction";
            });

      if (latestCompactionIndex < 0) {
        let total = 0;
        for (const entry of branchEntries) {
          total += estimateSessionEntryTokens(entry);
        }
        return total;
      }

      let tokens = 0;
      let foundFirstKept = false;
      for (let index = 0; index < latestCompactionIndex; index += 1) {
        const entry = branchEntries[index];
        if (typeof entry === "object" && entry !== null) {
          const id = (entry as { readonly id?: unknown }).id;
          if (id === compactionEntry.firstKeptEntryId) {
            foundFirstKept = true;
          }
        }
        if (foundFirstKept) {
          tokens += estimateSessionEntryTokens(entry);
        }
      }
      for (let index = latestCompactionIndex + 1; index < branchEntries.length; index += 1) {
        tokens += estimateSessionEntryTokens(branchEntries[index]);
      }
      return tokens;
    };

    const recomputeToolCategories = () => {
      let toolDefinitionTokens = 0;
      let mcpTokens = 0;
      let subagentTokens = 0;
      for (const tool of pi.getAllTools()) {
        const tokens = estimateToolDefinitionTokens(tool);
        if (tool.name === SUBAGENT_TOOL_NAME) {
          subagentTokens += tokens;
        } else if (isMcpToolName(tool.name)) {
          mcpTokens += tokens;
        } else {
          toolDefinitionTokens += tokens;
        }
      }
      state.staticCategoryTokens.set("tool_definitions", toolDefinitionTokens);
      state.staticCategoryTokens.set("mcp", mcpTokens);
      state.staticCategoryTokens.set("subagents", subagentTokens);
    };

    const recordCompactionSummary = (summary: unknown) => {
      const tokens = estimateTextTokens(summary);
      if (tokens > 0) {
        state.staticCategoryTokens.set("summarized_conversation", tokens);
      }
    };

    const buildCategories = (usedTokens: number): ThreadTokenUsageCategory[] => {
      const staticEntries = STATIC_CATEGORY_ORDER.map((id) => ({
        id,
        tokens: Math.max(0, Math.round(state.staticCategoryTokens.get(id) ?? 0)),
      })).filter((entry) => entry.tokens > 0);

      const staticTotal = staticEntries.reduce((total, entry) => total + entry.tokens, 0);
      // Estimates can exceed the provider-reported context size; scale them down so the
      // breakdown never sums past what the model actually saw.
      const scale = staticTotal > usedTokens && staticTotal > 0 ? usedTokens / staticTotal : 1;

      const categories: ThreadTokenUsageCategory[] = [];
      let scaledTotal = 0;
      for (const entry of staticEntries) {
        const tokens = Math.max(0, Math.floor(entry.tokens * scale));
        if (tokens <= 0) {
          continue;
        }
        scaledTotal += tokens;
        categories.push({
          id: CATEGORY_DEFINITIONS[entry.id].id,
          label: CATEGORY_DEFINITIONS[entry.id].label,
          tokens,
        });
      }

      const conversationTokens = Math.max(0, usedTokens - scaledTotal);
      if (conversationTokens > 0) {
        categories.push({
          id: CATEGORY_DEFINITIONS.conversation.id,
          label: CATEGORY_DEFINITIONS.conversation.label,
          tokens: conversationTokens,
        });
      }
      return categories;
    };

    const publishSnapshot = (
      ctx: {
        readonly getContextUsage: () =>
          | { tokens: number | null; contextWindow: number }
          | undefined;
        readonly model: { contextWindow: number } | undefined;
      },
      options?: { readonly estimatedUsedTokens?: number },
    ) => {
      const contextUsage = ctx.getContextUsage();
      const lastUsedTokens = state.lastUsage ? contextTokensForUsage(state.lastUsage) : 0;
      const usedTokens =
        asNonNegativeInteger(contextUsage?.tokens) ||
        asNonNegativeInteger(options?.estimatedUsedTokens) ||
        lastUsedTokens;
      if (usedTokens <= 0) {
        return;
      }

      const maxTokens =
        asNonNegativeInteger(contextUsage?.contextWindow) ||
        asNonNegativeInteger(ctx.model?.contextWindow);
      const totalProcessedTokens =
        state.cumulativeInputTokens +
        state.cumulativeCachedInputTokens +
        state.cumulativeOutputTokens;

      sink.publish({
        usedTokens,
        ...(totalProcessedTokens > 0 ? { totalProcessedTokens } : {}),
        ...(maxTokens > 0 ? { maxTokens } : {}),
        categories: buildCategories(usedTokens),
        inputTokens: state.cumulativeInputTokens,
        cachedInputTokens: state.cumulativeCachedInputTokens,
        outputTokens: state.cumulativeOutputTokens,
        ...(state.lastUsage
          ? {
              lastUsedTokens,
              lastInputTokens: asNonNegativeInteger(state.lastUsage.input),
              lastCachedInputTokens: asNonNegativeInteger(state.lastUsage.cacheRead),
              lastOutputTokens: asNonNegativeInteger(state.lastUsage.output),
            }
          : {}),
        toolUses: state.toolUses,
        ...(state.lastTurnDurationMs !== null ? { durationMs: state.lastTurnDurationMs } : {}),
        compactsAutomatically: true,
      });
    };

    const publishPostCompactionSnapshot = (
      ctx: {
        readonly getContextUsage: () =>
          | { tokens: number | null; contextWindow: number }
          | undefined;
        readonly model: { contextWindow: number } | undefined;
        readonly sessionManager: { readonly getBranch: () => readonly unknown[] };
      },
      compactionEntry: { readonly id?: unknown; readonly firstKeptEntryId?: unknown },
    ) => {
      const estimatedUsedTokens =
        staticTokenTotal() + estimateCurrentConversationTokens(ctx, compactionEntry);
      state.lastUsage = null;
      publishSnapshot(ctx, { estimatedUsedTokens });
    };

    pi.on("session_start", (_event, ctx) => {
      state.cumulativeInputTokens = 0;
      state.cumulativeCachedInputTokens = 0;
      state.cumulativeOutputTokens = 0;
      state.toolUses = 0;
      state.lastUsage = null;
      state.staticCategoryTokens.delete("summarized_conversation");

      let latestCompactionEntry: {
        readonly id?: unknown;
        readonly firstKeptEntryId?: unknown;
      } | null = null;
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type === "compaction") {
          recordCompactionSummary(entry.summary);
          latestCompactionEntry = entry;
          state.lastUsage = null;
          continue;
        }
        if (entry.type !== "message") {
          continue;
        }
        const role = (entry.message as { role?: unknown }).role;
        if (role === "toolResult") {
          state.toolUses += 1;
          continue;
        }
        const usage = assistantUsageForMessage(entry.message);
        if (!usage) {
          continue;
        }
        state.cumulativeInputTokens += asNonNegativeInteger(usage.input);
        state.cumulativeCachedInputTokens += asNonNegativeInteger(usage.cacheRead);
        state.cumulativeOutputTokens += asNonNegativeInteger(usage.output);
        state.lastUsage = usage;
      }

      recomputeToolCategories();
      if (state.lastUsage) {
        publishSnapshot(ctx);
      } else if (latestCompactionEntry) {
        publishPostCompactionSnapshot(ctx, latestCompactionEntry);
      }
    });

    pi.on("before_agent_start", (event) => {
      const options = event.systemPromptOptions;
      const rulesTokens = (options.contextFiles ?? []).reduce(
        (total, file) => total + estimateTextTokens(file.content),
        0,
      );
      const skillsTokens = (options.skills ?? []).reduce(
        (total, skill) =>
          total + estimateTextTokens(skill.name) + estimateTextTokens(skill.description),
        0,
      );
      const systemPromptTokens = Math.max(
        0,
        estimateTextTokens(event.systemPrompt) - rulesTokens - skillsTokens,
      );
      state.staticCategoryTokens.set("system_prompt", systemPromptTokens);
      state.staticCategoryTokens.set("rules", rulesTokens);
      state.staticCategoryTokens.set("skills", skillsTokens);
      recomputeToolCategories();
    });

    pi.on("turn_start", () => {
      state.turnStartedAtMs = Date.now();
    });

    pi.on("tool_execution_end", () => {
      state.toolUses += 1;
    });

    pi.on("session_compact", (event, ctx) => {
      recordCompactionSummary(event.compactionEntry.summary);
      publishPostCompactionSnapshot(ctx, event.compactionEntry);
    });

    pi.on("turn_end", (event, ctx) => {
      const usage = assistantUsageForMessage(event.message);
      if (!usage || contextTokensForUsage(usage) <= 0) {
        return;
      }
      state.cumulativeInputTokens += asNonNegativeInteger(usage.input);
      state.cumulativeCachedInputTokens += asNonNegativeInteger(usage.cacheRead);
      state.cumulativeOutputTokens += asNonNegativeInteger(usage.output);
      state.lastUsage = usage;
      state.lastTurnDurationMs =
        state.turnStartedAtMs !== null ? Math.max(0, Date.now() - state.turnStartedAtMs) : null;
      publishSnapshot(ctx);
    });
  };
}
