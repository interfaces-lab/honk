import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import {
  type AgentMode,
  type AgentThinkingLevel,
} from "@honk/contracts";

// A subagent profile is the resolved specialization a child runs with: which model and thinking
// level, which tools it may use, what system prompt specializes it, how much of the host's resources
// it inherits, and how deep it may itself fan out. Resolution is intentionally limited to Honk-owned
// built-ins plus per-call model/tool overrides.

export interface SubagentResourceAccess {
  readonly extensions: boolean;
  readonly skills: boolean;
  readonly promptTemplates: boolean;
  readonly themes: boolean;
}

export interface ResolvedSubagentProfile {
  readonly name: string;
  // Appended to the base pi system prompt (never replaces it, so tool/safety guidance survives).
  readonly systemPrompt: string | null;
  // Model id ("provider/id" or bare id) to resolve against the registry; null = inherit the parent.
  readonly model: string | null;
  readonly thinkingLevel: AgentThinkingLevel | null;
  // Tool allowlist; null = inherit the parent's default tools. A child only gets the `subagent` tool
  // (and may itself fan out) when this list explicitly contains "subagent".
  readonly tools: readonly string[] | null;
  readonly agentMode: AgentMode;
  readonly resourceAccess: SubagentResourceAccess;
  // 0 = this agent may not fan out at all. Per-agent values can only tighten the global cap.
  readonly maxSubagentDepth: number;
}

export interface SubagentProfileOverrides {
  readonly model?: string | null;
  readonly thinkingLevel?: AgentThinkingLevel | null;
  readonly tools?: readonly string[] | null;
}

export const DEFAULT_SUBAGENT_AGENT_NAME = "general-purpose";

const NARROW_RESOURCE_ACCESS: SubagentResourceAccess = {
  extensions: false,
  skills: false,
  promptTemplates: false,
  themes: false,
};

const SCOUT_PROMPT = `You are a reconnaissance subagent. Quickly map the relevant parts of the codebase and report concise, accurate findings. Read and search aggressively, but do not modify anything. Return the specific files and symbols that matter with file:line references, plus a short summary of how they fit together. Prefer breadth and speed over exhaustive detail.`;

const ORACLE_PROMPT = `You are a deep-reasoning advisory subagent. Analyze the problem thoroughly: root-cause the issue, weigh design trade-offs, and recommend a concrete approach. Read and search to ground every claim in the actual code; do not modify files. Think carefully before answering, show the key reasoning that supports your recommendation, then end with a clear, actionable conclusion.`;

// Inspection tools for the recon/analysis specialists.
const READONLY_TOOLS = ["read", "grep", "find", "ls", "bash"] as const;

const BUILTIN_SUBAGENT_PROFILES: Record<string, ResolvedSubagentProfile> = {
  [DEFAULT_SUBAGENT_AGENT_NAME]: {
    name: DEFAULT_SUBAGENT_AGENT_NAME,
    systemPrompt: null,
    model: null,
    thinkingLevel: null,
    tools: null,
    agentMode: "smart",
    resourceAccess: NARROW_RESOURCE_ACCESS,
    maxSubagentDepth: 0,
  },
  scout: {
    name: "scout",
    systemPrompt: SCOUT_PROMPT,
    model: null,
    thinkingLevel: "medium",
    tools: [...READONLY_TOOLS],
    agentMode: "rush",
    resourceAccess: NARROW_RESOURCE_ACCESS,
    maxSubagentDepth: 0,
  },
  oracle: {
    name: "oracle",
    systemPrompt: ORACLE_PROMPT,
    model: null,
    thinkingLevel: "xhigh",
    tools: [...READONLY_TOOLS],
    agentMode: "deep",
    resourceAccess: NARROW_RESOURCE_ACCESS,
    maxSubagentDepth: 0,
  },
};

function applyOverrides(
  profile: ResolvedSubagentProfile,
  overrides: SubagentProfileOverrides | undefined,
): ResolvedSubagentProfile {
  if (!overrides) {
    return profile;
  }
  const next: ResolvedSubagentProfile = {
    ...profile,
    ...(overrides.model !== undefined ? { model: overrides.model } : {}),
    ...(overrides.thinkingLevel !== undefined ? { thinkingLevel: overrides.thinkingLevel } : {}),
    ...(overrides.tools !== undefined ? { tools: overrides.tools } : {}),
  };
  return next;
}

export function resolveSubagentProfile(input: {
  readonly name: string | null | undefined;
  readonly overrides?: SubagentProfileOverrides;
}): ResolvedSubagentProfile {
  const requested = input.name?.trim() || DEFAULT_SUBAGENT_AGENT_NAME;
  const base =
    BUILTIN_SUBAGENT_PROFILES[requested] ??
    BUILTIN_SUBAGENT_PROFILES[DEFAULT_SUBAGENT_AGENT_NAME]!;
  return applyOverrides(base, input.overrides);
}

// Resolve a model id ("provider/id" or a bare id) to a registry Model. Returns undefined when the
// name is absent or unknown, so the caller can fall back to inheriting the parent's model.
export function resolveSubagentModel(
  registry: ModelRegistry | undefined,
  name: string | null,
): Model<string> | undefined {
  const trimmed = name?.trim();
  if (!trimmed || !registry) {
    return undefined;
  }
  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    const found = registry.find(trimmed.slice(0, slash), trimmed.slice(slash + 1));
    if (found) {
      return found as Model<string>;
    }
  }
  return registry.getAll().find((model) => model.id === trimmed) as Model<string> | undefined;
}

export function subagentSystemPromptForChild(profile: ResolvedSubagentProfile): string[] {
  // A short boundary note keeps the child from trying to converse with the user, plus the profile's
  // specialization when it has one.
  const boundary =
    "You are running as a subagent launched by another agent to complete one delegated task. Complete the task and report your result; do not ask the user follow-up questions.";
  return profile.systemPrompt ? [boundary, profile.systemPrompt] : [boundary];
}

export function childCanFanOut(profile: ResolvedSubagentProfile): boolean {
  return (profile.tools ?? []).includes("subagent");
}
