import { describe, expect, it } from "vitest";

import {
  GIT_AGENT_ACTIONS,
  GIT_AGENT_METADATA_KEY,
  gitAgentActionFromMetadata,
  gitAgentActionMetadata,
  gitAgentPrompt,
  type GitAgentActionId,
} from "./git-agent-actions";

const ALL_ACTION_IDS: readonly GitAgentActionId[] = [
  "createBranch",
  "createBranchAndCommit",
  "createBranchCommitAndPush",
  "commit",
  "commitAndPush",
  "createPrWithChanges",
  "revertFiles",
];

describe("gitAgentPrompt", () => {
  it("includes the action label, steps, and file list", () => {
    const prompt = gitAgentPrompt("commitAndPush", ["src/a.ts", "src/b.ts"]);
    expect(prompt).toContain(`Action: ${GIT_AGENT_ACTIONS.commitAndPush.label}`);
    for (const step of GIT_AGENT_ACTIONS.commitAndPush.steps) {
      expect(prompt).toContain(step);
    }
    expect(prompt).toContain("Files:");
    expect(prompt).toContain("- src/a.ts");
    expect(prompt).toContain("- src/b.ts");
  });

  it("omits the Files section when no files are provided", () => {
    expect(gitAgentPrompt("commit", [])).not.toContain("Files:");
  });

  it("carries no GitAction marker line", () => {
    expect(gitAgentPrompt("commitAndPush", ["src/a.ts"])).not.toContain("GitAction:");
  });
});

describe("git agent action metadata", () => {
  it("round-trips every action id through metadata", () => {
    for (const id of ALL_ACTION_IDS) {
      expect(gitAgentActionMetadata(id)).toEqual({ [GIT_AGENT_METADATA_KEY]: id });
      expect(gitAgentActionFromMetadata(gitAgentActionMetadata(id))).toBe(id);
    }
  });

  it("returns null for undefined, empty, or unknown metadata", () => {
    expect(gitAgentActionFromMetadata(undefined)).toBeNull();
    expect(gitAgentActionFromMetadata({})).toBeNull();
    expect(gitAgentActionFromMetadata({ [GIT_AGENT_METADATA_KEY]: "notAnAction" })).toBeNull();
  });
});
