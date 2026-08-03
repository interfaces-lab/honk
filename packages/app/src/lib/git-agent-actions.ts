export type GitAgentActionId =
  | "createBranch"
  | "createBranchAndCommit"
  | "createBranchCommitAndPush"
  | "commit"
  | "commitAndPush"
  | "createPrWithChanges"
  | "revertFiles";

export const GIT_AGENT_METADATA_KEY = "honkGitAction";

const GIT_AGENT_ACTION_INSTRUCTIONS = [
  "Run this Git action from Source Control.",
  "Limit work to the requested Git task.",
  "Follow AGENTS.md Git rules and stage explicit file paths only (never `git add -A` or `git add .`).",
].join("\n");

export const GIT_AGENT_ACTIONS = {
  createBranch: {
    label: "Create Branch",
    loadingLabel: "Creating branch...",
    steps: ["Create a descriptive branch from the current branch.", "Do not commit or push."],
  },
  createBranchAndCommit: {
    label: "Create Branch & Commit",
    loadingLabel: "Committing...",
    steps: [
      "Create a descriptive branch from the current branch.",
      "Stage only the intended file paths.",
      "Create one concise commit.",
      "Do not push.",
    ],
  },
  createBranchCommitAndPush: {
    label: "Create Branch, Commit & Push",
    loadingLabel: "Committing...",
    steps: [
      "Create a descriptive branch from the current branch.",
      "Stage only the intended file paths.",
      "Create one concise commit.",
      "Push the branch and set upstream when needed.",
    ],
  },
  commit: {
    label: "Commit",
    loadingLabel: "Committing...",
    steps: ["Stage only the intended file paths.", "Create one concise commit.", "Do not push."],
  },
  commitAndPush: {
    label: "Commit & Push",
    loadingLabel: "Committing...",
    steps: [
      "Stage only the intended file paths.",
      "Create one concise commit.",
      "Push the current branch and set upstream when needed.",
    ],
  },
  createPrWithChanges: {
    label: "Commit & Create PR",
    loadingLabel: "Creating PR...",
    steps: [
      "Stage only the intended file paths.",
      "Create one concise commit.",
      "Push the current branch and set upstream when needed.",
      "Create or open a pull request for the pushed branch.",
    ],
  },
  revertFiles: {
    label: "Revert Files",
    loadingLabel: "Reverting...",
    steps: ["Revert the listed files to their state at HEAD.", "Do not touch any other file."],
  },
} satisfies Record<
  GitAgentActionId,
  { label: string; loadingLabel: string; steps: readonly string[] }
>;

// revertFiles is deliberately excluded: it is not a split-button action.
export const GIT_AGENT_ACTION_ORDER: readonly GitAgentActionId[] = [
  "createBranchAndCommit",
  "createBranchCommitAndPush",
  "createBranch",
  "commitAndPush",
  "commit",
  "createPrWithChanges",
];

export const GIT_AGENT_DEFAULT_ACTION: GitAgentActionId = "commitAndPush";

export function gitAgentPrompt(action: GitAgentActionId, files: readonly string[]): string {
  const details = GIT_AGENT_ACTIONS[action];
  return [
    GIT_AGENT_ACTION_INSTRUCTIONS,
    `Action: ${details.label}`,
    ...details.steps,
    ...(files.length > 0 ? ["Files:", ...files.map((file) => `- ${file}`)] : []),
  ].join("\n");
}

export function gitAgentActionMetadata(
  action: GitAgentActionId,
): Readonly<Record<string, unknown>> {
  return { [GIT_AGENT_METADATA_KEY]: action };
}

export function gitAgentActionFromMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): GitAgentActionId | null {
  const value = metadata?.[GIT_AGENT_METADATA_KEY];
  return isGitAgentActionId(value) ? value : null;
}

export function isGitAgentActionId(value: unknown): value is GitAgentActionId {
  return typeof value === "string" && Object.hasOwn(GIT_AGENT_ACTIONS, value);
}
