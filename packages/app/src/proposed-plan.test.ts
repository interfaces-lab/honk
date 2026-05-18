import { describe, expect, it } from "vitest";

import {
  buildPlanImplementationPrompt,
  proposedPlanTitle,
  resolvePlanFollowUpSubmission,
  stripDisplayedPlanMarkdown,
} from "./proposed-plan";

describe("proposedPlanTitle", () => {
  it("reads the first markdown heading as the plan title", () => {
    expect(proposedPlanTitle("# Integrate RPC\n\nBody")).toBe("Integrate RPC");
  });

  it("returns null when the plan has no heading", () => {
    expect(proposedPlanTitle("- step 1")).toBeNull();
  });
});

describe("buildPlanImplementationPrompt", () => {
  it("formats the plan exactly like the Codex follow-up handoff prompt", () => {
    expect(buildPlanImplementationPrompt("## Ship it\n\n- step 1\n")).toBe(
      "PLEASE IMPLEMENT THIS PLAN:\n## Ship it\n\n- step 1",
    );
  });
});

describe("stripDisplayedPlanMarkdown", () => {
  it("drops the leading title heading from displayed plan markdown", () => {
    expect(stripDisplayedPlanMarkdown("# Integrate RPC\n\n## Summary\n\n- step 1\n")).toBe(
      "- step 1",
    );
  });

  it("preserves non-summary headings after dropping the title heading", () => {
    expect(stripDisplayedPlanMarkdown("# Integrate RPC\n\n## Scope\n\n- step 1\n")).toBe(
      "## Scope\n\n- step 1",
    );
  });
});

describe("resolvePlanFollowUpSubmission", () => {
  it("switches to default mode when implementing the ready plan without extra text", () => {
    expect(
      resolvePlanFollowUpSubmission({
        draftText: "   ",
        planMarkdown: "## Ship it\n\n- step 1\n",
      }),
    ).toEqual({
      text: "PLEASE IMPLEMENT THIS PLAN:\n## Ship it\n\n- step 1",
      interactionMode: "default",
    });
  });

  it("stays in plan mode when the user adds a follow-up prompt", () => {
    expect(
      resolvePlanFollowUpSubmission({
        draftText: "Refine step 2 first",
        planMarkdown: "## Ship it\n\n- step 1\n",
      }),
    ).toEqual({
      text: "Refine step 2 first",
      interactionMode: "plan",
    });
  });
});
