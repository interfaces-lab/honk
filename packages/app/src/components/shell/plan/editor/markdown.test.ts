import { describe, expect, it } from "vitest";

import { normalizePlanEditorMarkdown, planEditorMarkdownMatches } from "./markdown";

describe("plan editor markdown", () => {
  it("normalizes trailing whitespace for export parity", () => {
    expect(normalizePlanEditorMarkdown("  # Plan\n\nBody  ")).toBe("# Plan\n\nBody\n");
  });

  it("treats normalized markdown as equal", () => {
    expect(planEditorMarkdownMatches("# Plan\n\nBody", "# Plan\n\nBody\n")).toBe(true);
    expect(planEditorMarkdownMatches("# Plan\n\nBody", "# Plan\n\nChanged")).toBe(false);
  });
});
