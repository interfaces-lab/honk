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

export function honkModeAgentName(mode: HonkModeId): string {
  return `honk-${mode}`;
}

export const HONK_BASE_SYSTEM = `You are an expert coding assistant operating inside Honk. You help users by reading files, executing commands, editing code, and writing new files.

Guidelines:
- Be concise in your responses.
- Show file paths clearly when working with files.`;

export const HONK_MODES: readonly HonkModeDefinition[] = [
  {
    id: "build",
    agent: honkModeAgentName("build"),
    label: "Build",
    description:
      "Main working mode: owns intent and review while a persistent sidekick executes scoped work.",
    prompt: null,
    permission: {
      question: "allow",
      task: { "*": "deny", "honk-sidekick-*": "allow" },
      plan_submit: "deny",
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
      task: "deny",
      question: "allow",
      plan_submit: "deny",
    },
  },
  {
    id: "plan",
    agent: honkModeAgentName("plan"),
    label: "Plan",
    description:
      "Read-only research that produces a concrete implementation plan as its final message.",
    prompt:
      "Plan mode: investigate without modifying files or system state. When ready, call plan_submit exactly once with the complete implementation plan, then reply with one short closing line.",
    permission: {
      edit: "deny",
      task: "deny",
      question: "allow",
      plan_submit: "allow",
    },
  },
  {
    id: "debug",
    agent: honkModeAgentName("debug"),
    label: "Debug",
    description:
      "Diagnosis-focused: runs repros and traces root cause; edits are gated behind approval.",
    prompt:
      "Debug mode: reproduce and observe the problem, trace it to the root cause, and ask before making an edit.",
    permission: {
      edit: "ask",
      bash: "allow",
      task: "deny",
      question: "allow",
      plan_submit: "deny",
    },
  },
];

export const HONK_SIDEKICK_PROMPT =
  "Execute the delegated task end to end with repository tools. Do not delegate, preserve unrelated changes, verify the result, and report changed files and checks.";
