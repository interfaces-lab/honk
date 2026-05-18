import { ThreadId, TurnId } from "@multi/contracts";
import "../../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { ActivePlanState, LatestProposedPlanState } from "../../../session-logic";
import { PlanWorkbenchPanel } from "./plan-workbench-panel";

const createdAt = "2026-05-15T12:00:00.000Z";

function activePlan(): ActivePlanState {
  return {
    createdAt,
    turnId: TurnId.make("turn-1"),
    explanation: "Working through the implementation.",
    steps: [
      { step: "Inspect the workbench", status: "completed" },
      { step: "Patch the panel", status: "inProgress" },
      { step: "Verify the result", status: "pending" },
    ],
  };
}

function proposedPlan(): LatestProposedPlanState {
  return {
    id: "plan-1",
    createdAt,
    updatedAt: createdAt,
    turnId: TurnId.make("turn-1"),
    planMarkdown: "# Proposed Plan\n\n1. Keep tasks visible.\n2. Render markdown.",
    implementedAt: null,
    implementationThreadId: ThreadId.make("thread-implementation"),
  };
}

describe("PlanWorkbenchPanel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders tasks and proposed markdown together", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <PlanWorkbenchPanel
        activePlan={activePlan()}
        activeProposedPlan={proposedPlan()}
        label="Plan"
        markdownCwd="/tmp/project"
        timestampFormat="24-hour"
      />,
      { container: host },
    );

    await vi.waitFor(async () => {
      await expect.element(page.getByText("Inspect the workbench")).toBeVisible();
      await expect.element(page.getByText("Patch the panel")).toBeVisible();
      await expect.element(page.getByText("Proposed Plan")).toBeVisible();
      await expect.element(page.getByText("Render markdown.")).toBeVisible();
    });

    await screen.unmount();
  });
});
