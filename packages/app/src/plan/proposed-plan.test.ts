import { describe, expect, it } from "vitest";

import { buildProposedPlanMarkdownFilename, ensurePlanMarkdownPath } from "./proposed-plan";

describe("buildProposedPlanMarkdownFilename", () => {
  it("builds a markdown filename from the plan title", () => {
    expect(buildProposedPlanMarkdownFilename("# Full screen and file editor\n\nPlan body")).toBe(
      "full-screen-and-file-editor.md",
    );
  });
});

describe("ensurePlanMarkdownPath", () => {
  it("appends a markdown extension when the path has none", () => {
    expect(ensurePlanMarkdownPath("Full screen and file editor")).toBe(
      "Full screen and file editor.md",
    );
  });

  it("keeps existing markdown extensions", () => {
    expect(ensurePlanMarkdownPath("docs/plan.md")).toBe("docs/plan.md");
    expect(ensurePlanMarkdownPath("docs/plan.markdown")).toBe("docs/plan.markdown");
  });
});
