import type { EnvironmentId, ThreadId } from "@multi/contracts";

const GIT_AGENT_ACTION_INSTRUCTIONS = [
  "Run this Git action from Source Control.",
  "Limit work to the requested Git task.",
  "Follow AGENTS.md Git rules and stage explicit file paths only (never `git add -A` or `git add .`).",
].join("\n");

const GIT_AGENT_ACTION_KEY_PREFIX = "GitAction: ";

type GitAgentSimulatedReason =
  | "DIFF_TAB_COMMIT"
  | "DIFF_TAB_COMMIT_AND_PUSH"
  | "DIFF_TAB_CREATE_PR";

type GitAgentActionConfig = Readonly<{
  label: string;
  loadingLabel: string;
  prompt: string;
  simulatedReason: GitAgentSimulatedReason;
}>;

function gitAgentPrompt(actionKey: string, actionLabel: string, steps: readonly string[]): string {
  return [
    `${GIT_AGENT_ACTION_KEY_PREFIX}${actionKey}`,
    GIT_AGENT_ACTION_INSTRUCTIONS,
    `Action: ${actionLabel}`,
    ...steps,
  ].join("\n");
}

export const GIT_AGENT_ACTIONS = {
  createBranchAndCommit: {
    label: "Create Branch & Commit",
    loadingLabel: "Committing...",
    prompt: gitAgentPrompt("createBranchAndCommit", "Create Branch & Commit", [
      "Create a descriptive branch from the current branch.",
      "Stage only the intended file paths.",
      "Create one concise commit.",
      "Do not push.",
    ]),
    simulatedReason: "DIFF_TAB_COMMIT",
  },
  createBranchCommitAndPush: {
    label: "Create Branch, Commit & Push",
    loadingLabel: "Committing...",
    prompt: gitAgentPrompt("createBranchCommitAndPush", "Create Branch, Commit & Push", [
      "Create a descriptive branch from the current branch.",
      "Stage only the intended file paths.",
      "Create one concise commit.",
      "Push the branch and set upstream when needed.",
    ]),
    simulatedReason: "DIFF_TAB_COMMIT_AND_PUSH",
  },
  commit: {
    label: "Commit",
    loadingLabel: "Committing...",
    prompt: gitAgentPrompt("commit", "Commit", [
      "Stage only the intended file paths.",
      "Create one concise commit.",
      "Do not push.",
    ]),
    simulatedReason: "DIFF_TAB_COMMIT",
  },
  commitAndPush: {
    label: "Commit & Push",
    loadingLabel: "Committing...",
    prompt: gitAgentPrompt("commitAndPush", "Commit & Push", [
      "Stage only the intended file paths.",
      "Create one concise commit.",
      "Push the current branch and set upstream when needed.",
    ]),
    simulatedReason: "DIFF_TAB_COMMIT_AND_PUSH",
  },
  createPrWithChanges: {
    label: "Commit & Create PR",
    loadingLabel: "Creating PR...",
    prompt: gitAgentPrompt("createPrWithChanges", "Commit & Create PR", [
      "Stage only the intended file paths.",
      "Create one concise commit.",
      "Push the current branch and set upstream when needed.",
      "Create or open a pull request for the pushed branch.",
    ]),
    simulatedReason: "DIFF_TAB_CREATE_PR",
  },
} satisfies Record<string, GitAgentActionConfig>;

export type GitAgentAction = keyof typeof GIT_AGENT_ACTIONS;

export type GitAgentActionDetails = (typeof GIT_AGENT_ACTIONS)[GitAgentAction];

export type GitAgentStopTarget = Readonly<{
  environmentId: EnvironmentId;
  threadId: ThreadId;
}>;

export type GitAgentRun = Readonly<{
  action: GitAgentAction;
  target: GitAgentStopTarget;
}>;

export const GIT_AGENT_PRIMARY_ACTION: GitAgentAction = "commitAndPush";

export const GIT_AGENT_ACTION_ORDER: readonly GitAgentAction[] = [
  "createBranchAndCommit",
  "createBranchCommitAndPush",
  "commit",
  "createPrWithChanges",
];

export function resolveGitAgentActionFromPrompt(prompt: string): GitAgentAction | null {
  const actionLine = prompt
    .split("\n")
    .find((line) => line.startsWith(GIT_AGENT_ACTION_KEY_PREFIX));
  if (!actionLine) {
    return null;
  }

  const action = actionLine.slice(GIT_AGENT_ACTION_KEY_PREFIX.length).trim();
  switch (action) {
    case "createBranchAndCommit":
    case "createBranchCommitAndPush":
    case "commit":
    case "commitAndPush":
    case "createPrWithChanges":
      return action;
    default:
      return null;
  }
}

/** Pending toolbar action: store-backed run wins; then live mutation; then post-mutation handoff until the store catches up. */
export function resolvePendingGitAgentAction(input: {
  activeRun: GitAgentRun | null;
  mutationIsPending: boolean;
  mutationVariables: GitAgentAction | undefined;
  orchestrationHandoff: GitAgentRun | null;
}): GitAgentAction | null {
  return (
    input.activeRun?.action ??
    (input.mutationIsPending
      ? (input.mutationVariables ?? null)
      : (input.orchestrationHandoff?.action ?? null))
  );
}
