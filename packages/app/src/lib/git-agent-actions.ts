import type { EnvironmentId, ThreadId, TurnId } from "@multi/contracts";

export const GIT_AGENT_ACTIONS = {
  createBranchAndCommit: {
    label: "Create Branch & Commit",
    loadingLabel: "Committing...",
    prompt: "Execute the selected diff-tab create-branch-and-commit action.",
    simulatedReason: "DIFF_TAB_COMMIT",
  },
  createBranchCommitAndPush: {
    label: "Create Branch, Commit & Push",
    loadingLabel: "Committing...",
    prompt: "Execute the selected diff-tab create-branch-commit-and-push action.",
    simulatedReason: "DIFF_TAB_COMMIT_AND_PUSH",
  },
  commit: {
    label: "Commit",
    loadingLabel: "Committing...",
    prompt: "Execute the selected diff-tab commit action.",
    simulatedReason: "DIFF_TAB_COMMIT",
  },
  commitAndPush: {
    label: "Commit & Push",
    loadingLabel: "Committing...",
    prompt: "Execute the selected diff-tab commit-and-push action.",
    simulatedReason: "DIFF_TAB_COMMIT_AND_PUSH",
  },
  createPrWithChanges: {
    label: "Commit & Create PR",
    loadingLabel: "Creating PR...",
    prompt: "Execute the selected diff-tab commit-and-create-pull-request action.",
    simulatedReason: "DIFF_TAB_CREATE_PR",
  },
} as const;

export type GitAgentAction = keyof typeof GIT_AGENT_ACTIONS;

export type GitAgentActionDetails = (typeof GIT_AGENT_ACTIONS)[GitAgentAction];

/** RPC scope for `thread.turn.interrupt` when a Git agent turn is active or starting. */
export type GitAgentInterruptTarget = Readonly<{
  environmentId: EnvironmentId;
  threadId: ThreadId;
  turnId?: TurnId | undefined;
}>;

/** One in-flight Git agent invocation: UI action label plus interrupt target. */
export type GitAgentRun = Readonly<{
  action: GitAgentAction;
  target: GitAgentInterruptTarget;
}>;

export const GIT_AGENT_PRIMARY_ACTION = "commitAndPush" as const satisfies GitAgentAction;

export const GIT_AGENT_ACTION_ORDER = [
  "createBranchAndCommit",
  "createBranchCommitAndPush",
  "commit",
  "createPrWithChanges",
] as const satisfies readonly GitAgentAction[];

const GIT_AGENT_ACTION_ENTRIES = Object.entries(GIT_AGENT_ACTIONS) as ReadonlyArray<
  readonly [GitAgentAction, GitAgentActionDetails]
>;

export function resolveGitAgentActionFromPrompt(prompt: string): GitAgentAction | null {
  return GIT_AGENT_ACTION_ENTRIES.find(([, details]) => details.prompt === prompt)?.[0] ?? null;
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

export function resolveGitAgentInterruptTarget(input: {
  activeRun: GitAgentRun | null;
  orchestrationHandoff: GitAgentRun | null;
}): GitAgentInterruptTarget | null {
  return input.activeRun?.target ?? input.orchestrationHandoff?.target ?? null;
}
