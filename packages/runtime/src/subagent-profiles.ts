import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import {
  AGENT_MODES,
  AGENT_THINKING_LEVELS,
  type AgentMode,
  type AgentThinkingLevel,
  type SubagentScope,
} from "@multi/contracts";

// A subagent profile is the resolved specialization a child runs with: which model and thinking
// level, which tools it may use, what system prompt specializes it, how much of the host's resources
// it inherits, and how deep it may itself fan out. Resolution order is builtin < user < project <
// per-call overrides, mirroring pi-subagents (named .md agents) but resolved for multi's in-process
// embedding rather than a spawned CLI.

export interface SubagentResourceAccess {
  readonly extensions: boolean;
  readonly skills: boolean;
  readonly promptTemplates: boolean;
  readonly themes: boolean;
}

export interface ResolvedSubagentProfile {
  readonly name: string;
  readonly description: string;
  readonly source: "builtin" | "user" | "project" | "override";
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

// Inspection tools for the recon/analysis specialists. multi excludes the pi builtin `read`
// (it reads via its fff extension, which children do not load), so file content is reached through
// bash; grep/find/ls cover search and listing.
const READONLY_TOOLS = ["grep", "find", "ls", "bash"] as const;

const BUILTIN_SUBAGENT_PROFILES: Record<string, ResolvedSubagentProfile> = {
  [DEFAULT_SUBAGENT_AGENT_NAME]: {
    name: DEFAULT_SUBAGENT_AGENT_NAME,
    description: "General-purpose subagent that inherits the parent's tools and model.",
    source: "builtin",
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
    description: "Fast codebase reconnaissance; read-only.",
    source: "builtin",
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
    description: "Deep analysis, architecture, and debugging advisor; read-only.",
    source: "builtin",
    systemPrompt: ORACLE_PROMPT,
    model: null,
    thinkingLevel: "xhigh",
    tools: [...READONLY_TOOLS],
    agentMode: "deep",
    resourceAccess: NARROW_RESOURCE_ACCESS,
    maxSubagentDepth: 0,
  },
};

export function builtinSubagentProfileNames(): readonly string[] {
  return Object.keys(BUILTIN_SUBAGENT_PROFILES);
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseToolList(value: unknown): readonly string[] | null {
  if (Array.isArray(value)) {
    const tools = value.map((entry) => asTrimmedString(entry)).filter((t): t is string => t !== null);
    return tools.length > 0 ? tools : null;
  }
  const text = asTrimmedString(value);
  if (!text) {
    return null;
  }
  const tools = text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return tools.length > 0 ? tools : null;
}

function normalizeThinkingLevel(value: unknown): AgentThinkingLevel | null {
  const text = asTrimmedString(value);
  return text && (AGENT_THINKING_LEVELS as readonly string[]).includes(text)
    ? (text as AgentThinkingLevel)
    : null;
}

function normalizeAgentMode(value: unknown): AgentMode {
  const text = asTrimmedString(value);
  return text && (AGENT_MODES as readonly string[]).includes(text) ? (text as AgentMode) : "smart";
}

function normalizeMaxDepth(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function profileFromAgentFile(
  content: string,
  source: "user" | "project",
  fallbackName: string,
): ResolvedSubagentProfile | null {
  let parsed: { frontmatter: Record<string, unknown>; body: string };
  try {
    parsed = parseFrontmatter<Record<string, unknown>>(content);
  } catch {
    return null;
  }
  const fm = parsed.frontmatter;
  const name = asTrimmedString(fm.name) ?? fallbackName;
  const systemPrompt = parsed.body.trim().length > 0 ? parsed.body.trim() : null;
  return {
    name,
    description: asTrimmedString(fm.description) ?? `${source} agent ${name}`,
    source,
    systemPrompt,
    model: asTrimmedString(fm.model),
    thinkingLevel: normalizeThinkingLevel(fm.thinkingLevel),
    tools: parseToolList(fm.tools),
    agentMode: normalizeAgentMode(fm.agentMode),
    resourceAccess: {
      extensions: asBoolean(fm.inheritExtensions, false),
      skills: asBoolean(fm.inheritSkills, false),
      promptTemplates: asBoolean(fm.inheritPromptTemplates, false),
      themes: asBoolean(fm.inheritThemes, false),
    },
    maxSubagentDepth: normalizeMaxDepth(fm.maxSubagentDepth),
  };
}

function loadAgentsFromDir(
  dir: string,
  source: "user" | "project",
): Map<string, ResolvedSubagentProfile> {
  const result = new Map<string, ResolvedSubagentProfile>();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".md")) {
      continue;
    }
    const filePath = join(dir, entry);
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const fallbackName = entry.slice(0, -3);
    const profile = profileFromAgentFile(content, source, fallbackName);
    if (profile) {
      result.set(profile.name, profile);
    }
  }
  return result;
}

function userAgentsDir(agentDir: string): string {
  return join(agentDir, "agents");
}

// Project agents live in the nearest `.multi/agents` directory at or above the working directory.
function findProjectAgentsDir(cwd: string): string | null {
  let current = cwd;
  for (;;) {
    const candidate = join(current, ".multi", "agents");
    try {
      if (statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // not here; keep walking up
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function mergedProfiles(input: {
  readonly scope: SubagentScope;
  readonly cwd: string;
  readonly agentDir: string;
}): Map<string, ResolvedSubagentProfile> {
  const merged = new Map<string, ResolvedSubagentProfile>(Object.entries(BUILTIN_SUBAGENT_PROFILES));
  if (input.scope === "user" || input.scope === "both") {
    for (const [name, profile] of loadAgentsFromDir(userAgentsDir(input.agentDir), "user")) {
      merged.set(name, profile);
    }
  }
  if (input.scope === "project" || input.scope === "both") {
    const projectDir = findProjectAgentsDir(input.cwd);
    if (projectDir) {
      for (const [name, profile] of loadAgentsFromDir(projectDir, "project")) {
        merged.set(name, profile);
      }
    }
  }
  return merged;
}

function applyOverrides(
  profile: ResolvedSubagentProfile,
  overrides: SubagentProfileOverrides | undefined,
): ResolvedSubagentProfile {
  if (!overrides) {
    return profile;
  }
  const next: ResolvedSubagentProfile = {
    ...profile,
    ...(overrides.model !== undefined ? { model: overrides.model, source: "override" } : {}),
    ...(overrides.thinkingLevel !== undefined
      ? { thinkingLevel: overrides.thinkingLevel, source: "override" }
      : {}),
    ...(overrides.tools !== undefined ? { tools: overrides.tools, source: "override" } : {}),
  };
  return next;
}

export function resolveSubagentProfile(input: {
  readonly name: string | null | undefined;
  readonly scope: SubagentScope;
  readonly cwd: string;
  readonly agentDir: string;
  readonly overrides?: SubagentProfileOverrides;
}): ResolvedSubagentProfile {
  const requested = asTrimmedString(input.name) ?? DEFAULT_SUBAGENT_AGENT_NAME;
  const merged = mergedProfiles({ scope: input.scope, cwd: input.cwd, agentDir: input.agentDir });
  const base =
    merged.get(requested) ??
    merged.get(DEFAULT_SUBAGENT_AGENT_NAME) ??
    BUILTIN_SUBAGENT_PROFILES[DEFAULT_SUBAGENT_AGENT_NAME]!;
  return applyOverrides(base, input.overrides);
}

// Resolve a model id ("provider/id" or a bare id) to a registry Model. Returns undefined when the
// name is absent or unknown, so the caller can fall back to inheriting the parent's model.
export function resolveSubagentModel(
  registry: ModelRegistry | undefined,
  name: string | null,
): Model<string> | undefined {
  const trimmed = asTrimmedString(name);
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
