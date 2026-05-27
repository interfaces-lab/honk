import { TurnId } from "@multi/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProposedPlan } from "../../../types";
import { ProposedPlanMessage } from "./proposed-plan-message";

function plan(overrides: Partial<ProposedPlan> = {}): ProposedPlan {
  return {
    id: "plan-1",
    turnId: TurnId.make("turn-1"),
    planMarkdown: "# Ship feature\n\n- Wire the timeline plan card\n- Save edits",
    implementedAt: null,
    implementationThreadId: null,
    createdAt: "2026-02-23T00:00:01.000Z",
    updatedAt: "2026-02-23T00:00:01.000Z",
    ...overrides,
  };
}

describe("ProposedPlanMessage", () => {
  it("renders proposed plans in the chat timeline shape", () => {
    const markup = renderToStaticMarkup(
      createElement(ProposedPlanMessage, {
        canEdit: true,
        markdownCwd: undefined,
        onSave: async () => true,
        proposedPlan: plan(),
      }),
    );

    expect(markup).toContain("data-proposed-plan-message");
    expect(markup).toContain("Ship feature");
    expect(markup).toContain("Wire the timeline plan card");
    expect(markup).toContain("Edit");
  });
});
