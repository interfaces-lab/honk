import {
  HONK_AGENT_PAIRINGS,
  HONK_MODEL_IDS,
  honkFusionAgentName,
  type HonkModelArm,
} from "./pairing";

export const HONK_MODE_IDS = ["build", "ask", "plan", "debug"] as const;

export type HonkModeId = (typeof HONK_MODE_IDS)[number];

export const HONK_DEFAULT_MODE: HonkModeId = "build";

export type HonkPermissionAction = "allow" | "ask" | "deny";
export type HonkPermissionRule =
  | HonkPermissionAction
  | Readonly<Record<string, HonkPermissionAction>>;
export type HonkPermissionConfig = Readonly<Record<string, HonkPermissionRule>>;

export interface HonkModeDefinition {
  readonly id: HonkModeId;
  readonly agent: string;
  readonly label: string;
  readonly description: string;
  readonly prompt: string | null;
  readonly permission: HonkPermissionConfig;
}

export interface HonkPresetAgentDefinition {
  readonly agent: string;
  readonly label: string;
  readonly description: string;
  readonly model: HonkModelArm;
  readonly prompt: string;
}

export interface HonkFusionAgentDefinition {
  readonly agent: string;
  readonly description: string;
  readonly permission: HonkPermissionConfig;
}

export function honkModeAgentName(mode: HonkModeId): string {
  return `honk-${mode}`;
}

export const HONK_BASE_SYSTEM = `You are an expert coding assistant operating inside Honk. You help users by reading files, executing commands, editing code, and writing new files.

Guidelines:
- Be concise in your responses.
- Show file paths clearly when working with files.`;

// Preset agents: invocable helpers with pinned models, never user-selectable.
// Available as task targets from every primary mode, Fusion or single model.
export const HONK_PRESET_AGENTS: readonly HonkPresetAgentDefinition[] = [
  {
    agent: "honk-review",
    label: "Review",
    description: "Bug identification and code-review assistance.",
    model: { providerID: "openai", id: "gpt-5.5", variant: "medium" },
    prompt:
      "Review the referenced code for bugs, regressions, and risky patterns. Verify each finding against the actual code before reporting it, cite file references with severity, and do not edit files.",
  },
  {
    agent: "honk-search",
    label: "Search",
    description: "Fast investigation and analysis across code and documentation.",
    model: { ...HONK_MODEL_IDS.luna, variant: "max" },
    prompt:
      "Investigate the delegated problem using the repository and available research tools. Trace the relevant files, symbols, call sites, behavior, and documentation; analyze what they imply; and return a concise answer with precise references. Do not edit files.",
  },
  {
    agent: "honk-oracle",
    label: "Oracle",
    description: "Complex reasoning and planning on code.",
    model: { ...HONK_MODEL_IDS.sol, variant: "high" },
    prompt:
      "Reason deeply about the referenced code. Produce plans, trade-off analyses, and design guidance grounded in what the code actually does. Do not edit files.",
  },
  {
    agent: "honk-opus",
    label: "Opus",
    description: "Frontier second opinion on hard or ambiguous problems.",
    model: { ...HONK_MODEL_IDS.opus5, variant: "high" },
    prompt:
      "Give a rigorous second opinion on the referenced problem. Check the reasoning against what the code actually does, state where you disagree and why, and call out the assumptions the answer rests on. Do not edit files.",
  },
  {
    agent: "honk-librarian",
    label: "Librarian",
    description: "Large-scale retrieval and research on external code.",
    model: { ...HONK_MODEL_IDS.sol, variant: "medium" },
    prompt:
      "Research external code and documentation at scale. Summarize findings with sources and exact references. Do not edit files.",
  },
  {
    agent: "honk-read-thread",
    label: "Read Thread",
    description: "Reading and summarizing other threads.",
    model: { ...HONK_MODEL_IDS.glm, variant: "medium" },
    prompt:
      "Read and summarize the referenced threads or transcripts. Report the decisions, state, and open questions that matter to the requesting thread. Do not edit files.",
  },
];

// The claude-code provider exposes the task tool through a static MCP proxy
// description that cannot enumerate agents, so primary agents learn their
// delegation targets from the system prompt instead.
export const HONK_DELEGATION_PROMPT = [
  "Delegation: the task tool runs one of these preset subagents. Valid subagent_type values:",
  ...HONK_PRESET_AGENTS.map((preset) => `- ${preset.agent}: ${preset.description}`),
].join("\n");

export const HONK_PRIMARY_SYSTEM = `${HONK_BASE_SYSTEM}\n\n${HONK_DELEGATION_PROMPT}`;

export function honkPresetAgentByName(
  agent: string | undefined,
): HonkPresetAgentDefinition | undefined {
  if (agent === undefined) return undefined;
  return HONK_PRESET_AGENTS.find((definition) => definition.agent === agent);
}

const PRESET_AGENT_ALLOWS: Readonly<Record<string, HonkPermissionAction>> = Object.fromEntries(
  HONK_PRESET_AGENTS.map((definition) => [definition.agent, "allow" as const]),
);

export const HONK_MODES: readonly HonkModeDefinition[] = [
  {
    id: "build",
    agent: honkModeAgentName("build"),
    label: "Build",
    description:
      "Main working mode on a single model: implements directly and can enlist preset agents for scoped research.",
    prompt: null,
    permission: {
      question: "allow",
      task: { "*": "deny", ...PRESET_AGENT_ALLOWS },
      honk_plan_submit: "deny",
      honk_debug_submit: "deny",
    },
  },
  {
    id: "ask",
    agent: honkModeAgentName("ask"),
    label: "Ask",
    description: "Read-only Q&A: answers questions about the code without changing anything.",
    prompt:
      "Ask mode: investigate the codebase without modifying files or system state, then answer concisely with concrete file references.",
    permission: {
      edit: "deny",
      bash: "ask",
      task: { "*": "deny", ...PRESET_AGENT_ALLOWS },
      question: "allow",
      honk_plan_submit: "deny",
      honk_debug_submit: "deny",
    },
  },
  {
    id: "plan",
    agent: honkModeAgentName("plan"),
    label: "Plan",
    description:
      "Read-only research that produces a concrete implementation plan as its final message.",
    prompt:
      "Plan mode: investigate without modifying files or system state. When ready, call the honk plan_submit tool (`honk_plan_submit`, exposed as `mcp__honk__plan_submit` on some providers) exactly once with the complete implementation plan, then reply with one short closing line.",
    permission: {
      edit: "deny",
      task: { "*": "deny", ...PRESET_AGENT_ALLOWS },
      question: "allow",
      honk_plan_submit: "allow",
      honk_debug_submit: "deny",
    },
  },
  {
    id: "debug",
    agent: honkModeAgentName("debug"),
    label: "Debug",
    description:
      "Diagnosis-focused: reproduces failures, traces root cause, and hands a verified fix to Build.",
    prompt:
      "Debug mode: investigate without modifying files or system state. Reproduce and observe the problem, trace it to a verified root cause, then call the honk debug_submit tool (`honk_debug_submit`, exposed as `mcp__honk__debug_submit` on some providers) exactly once with the diagnosis and smallest safe recommended fix. Do not apply the fix yourself; reply with one short closing line after recording it.",
    permission: {
      edit: "deny",
      bash: "allow",
      task: { "*": "deny", ...PRESET_AGENT_ALLOWS },
      question: "allow",
      honk_plan_submit: "deny",
      honk_debug_submit: "allow",
    },
  },
];

// Fusion build primaries: one per stop (ADR 0001). Behave like build, plus the
// paired sidekick as a delegation target.
export const HONK_FUSION_AGENTS: readonly HonkFusionAgentDefinition[] = HONK_AGENT_PAIRINGS.map(
  (pairing) => ({
    agent: honkFusionAgentName(pairing.stop),
    description: `Build with Fusion at the ${pairing.stop} stop: orchestrates a persistent sidekick that executes scoped work.`,
    permission: {
      question: "allow",
      task: { "*": "deny", "honk-sidekick-*": "allow", ...PRESET_AGENT_ALLOWS },
      honk_plan_submit: "deny",
      honk_debug_submit: "deny",
    },
  }),
);

export const HONK_SIDEKICK_PROMPT =
  "Execute the delegated task end to end with repository tools. Do not delegate, preserve unrelated changes, and verify the result. The orchestrator may run you in the background and check your progress mid-task: work in reviewable increments, never stop to ask a question — state the assumption and proceed — and finish with a report of changed files, checks run, and anything left incomplete.";

export const HONK_SIDE_CHAT_PROMPT =
  "This is a focused side conversation branched from a parent chat. Answer within this thread and do not delegate to other agents; use the parent_chat tool to consult or search the parent transcript when you need its context.";
