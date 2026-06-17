import { describe, expect, it } from "vitest";

import {
  extractCreatePlanToolEventMarkdown,
  extractCreatePlanToolResultMarkdown,
} from "../src/plan-extension";

describe("plan-extension", () => {
  it("extracts create_plan markdown from result details", () => {
    expect(
      extractCreatePlanToolResultMarkdown({
        content: [{ type: "text", text: "Created plan." }],
        details: {
          planMarkdown: "# Plan\n\n1. Inspect the code.",
          plan: "# Fallback",
        },
      }),
    ).toBe("# Plan\n\n1. Inspect the code.");
  });

  it("extracts create_plan markdown from wrapped result details", () => {
    expect(
      extractCreatePlanToolResultMarkdown({
        result: {
          value: {
            details: {
              plan: "# Wrapped Plan\n\n1. Update projection.",
            },
          },
        },
      }),
    ).toBe("# Wrapped Plan\n\n1. Update projection.");
  });

  it("falls back to create_plan args when the event result is display-only", () => {
    expect(
      extractCreatePlanToolEventMarkdown({
        type: "tool_execution_end",
        toolName: "create_plan",
        result: {
          content: [{ type: "text", text: "Created plan." }],
        },
        args: {
          plan: "# Args Plan\n\n1. Keep the plan tab available.",
        },
      }),
    ).toBe("# Args Plan\n\n1. Keep the plan tab available.");
  });
});
