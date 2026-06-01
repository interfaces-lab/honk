import { EnvironmentId, ThreadId, TurnId, type EnvironmentApi } from "@multi/contracts";
import "../../../index.css";

import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { ActivePlanState, LatestProposedPlanState } from "../../../session-logic";
import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../../environment-api";
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

async function unexpectedEnvironmentApiCall(): Promise<never> {
  throw new Error("Unexpected environment API call.");
}

function createProjectWriteApi(writeFile: EnvironmentApi["projects"]["writeFile"]): EnvironmentApi {
  return {
    terminal: {
      open: unexpectedEnvironmentApiCall,
      write: unexpectedEnvironmentApiCall,
      resize: unexpectedEnvironmentApiCall,
      clear: unexpectedEnvironmentApiCall,
      restart: unexpectedEnvironmentApiCall,
      close: unexpectedEnvironmentApiCall,
      onEvent: () => () => undefined,
    },
    projects: {
      listDirectory: unexpectedEnvironmentApiCall,
      readFile: unexpectedEnvironmentApiCall,
      searchEntries: unexpectedEnvironmentApiCall,
      writeFile,
    },
    filesystem: {
      browse: unexpectedEnvironmentApiCall,
    },
    git: {
      listBranches: unexpectedEnvironmentApiCall,
      createWorktree: unexpectedEnvironmentApiCall,
      removeWorktree: unexpectedEnvironmentApiCall,
      createBranch: unexpectedEnvironmentApiCall,
      checkout: unexpectedEnvironmentApiCall,
      init: unexpectedEnvironmentApiCall,
      resolvePullRequest: unexpectedEnvironmentApiCall,
      preparePullRequestThread: unexpectedEnvironmentApiCall,
      pull: unexpectedEnvironmentApiCall,
      discardPaths: unexpectedEnvironmentApiCall,
      getFilePatch: unexpectedEnvironmentApiCall,
      refreshStatus: unexpectedEnvironmentApiCall,
      onStatus: () => () => undefined,
    },
    orchestration: {
      dispatchCommand: unexpectedEnvironmentApiCall,
      getProviderThreadSnapshot: unexpectedEnvironmentApiCall,
      subscribeShell: () => () => undefined,
      subscribeThread: () => () => undefined,
    },
  };
}

async function appendPlanEditorLine(text: string): Promise<void> {
  const surface = document.querySelector<HTMLElement>(
    '[data-testid="plan-editor-input"] .ProseMirror',
  );
  if (!surface) {
    throw new Error("Plan editor surface not found.");
  }
  await userEvent.click(surface);
  await userEvent.keyboard(`{End}{Enter}${text}`);
}

describe("PlanWorkbenchPanel", () => {
  afterEach(() => {
    __resetEnvironmentApiOverridesForTests();
    document.body.innerHTML = "";
  });

  it("renders tasks and proposed markdown together", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <PlanWorkbenchPanel
        activePlan={activePlan()}
        activeProposedPlan={proposedPlan()}
        environmentId={EnvironmentId.make("local")}
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

  it("renders proposed-plan actions and build controls", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onImplementPlan = vi.fn();

    const screen = await render(
      <PlanWorkbenchPanel
        activePlan={activePlan()}
        activeProposedPlan={proposedPlan()}
        environmentId={EnvironmentId.make("local")}
        label="Plan"
        markdownCwd="/tmp/project"
        timestampFormat="24-hour"
        canImplementPlan
        onImplementPlan={onImplementPlan}
      />,
      { container: host },
    );

    try {
      await page.getByTitle("Build plan").click();
      expect(onImplementPlan).toHaveBeenCalledOnce();

      await page.getByRole("button", { name: "Plan actions" }).click();
      await expect.element(page.getByText("Copy markdown")).toBeVisible();
      await expect.element(page.getByText("Download markdown")).toBeVisible();

      await page.getByText("Save to project").click();
      await expect.element(page.getByText("Save plan")).toBeVisible();
      await expect.element(page.getByText("Enter a path relative to /tmp/project.")).toBeVisible();
      await expect.element(page.getByPlaceholder("docs/plan.md")).toHaveValue("proposed-plan.md");
    } finally {
      await screen.unmount();
    }
  });

  it("supports plan edit save and cancel dirty state", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onSaveProposedPlan = vi.fn<(nextMarkdown: string) => Promise<boolean>>(async () => true);

    const screen = await render(
      <PlanWorkbenchPanel
        activePlan={activePlan()}
        activeProposedPlan={proposedPlan()}
        environmentId={EnvironmentId.make("local")}
        label="Plan"
        markdownCwd="/tmp/project"
        timestampFormat="24-hour"
        onSaveProposedPlan={onSaveProposedPlan}
      />,
      { container: host },
    );

    try {
      await page.getByRole("button", { name: "Edit plan" }).click();
      await expect.element(page.getByTestId("plan-editor-input")).toBeVisible();
      await expect.element(page.getByRole("button", { name: "Save" })).toBeDisabled();

      await appendPlanEditorLine("3. Updated.");

      await vi.waitFor(async () => {
        await expect.element(page.getByRole("button", { name: "Save" })).toBeEnabled();
      });

      await page.getByRole("button", { name: "Cancel" }).click();
      await expect.element(page.getByTestId("plan-editor-input")).not.toBeInTheDocument();
      await expect.element(page.getByText("Render markdown.")).toBeVisible();
      expect(onSaveProposedPlan).not.toHaveBeenCalled();

      await page.getByRole("button", { name: "Edit plan" }).click();
      await appendPlanEditorLine("3. Updated.");
      await vi.waitFor(async () => {
        await expect.element(page.getByRole("button", { name: "Save" })).toBeEnabled();
      });
      await page.getByRole("button", { name: "Save" }).click();

      await vi.waitFor(() => {
        expect(onSaveProposedPlan).toHaveBeenCalledOnce();
      });
      expect(onSaveProposedPlan.mock.calls[0]?.[0]).toContain("3. Updated.");
      await expect.element(page.getByTestId("plan-editor-input")).not.toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });

  it("renders structured project write errors when saving a proposed plan", async () => {
    const environmentId = EnvironmentId.make("local");
    const writeFile = vi.fn<EnvironmentApi["projects"]["writeFile"]>(async () => {
      throw {
        _tag: "ProjectWriteFileError",
        message: "Project file path must stay within the project root.",
        cause: {
          operation: "projectFileSystem.writeFile",
          cwd: "/tmp/project",
          relativePath: "../secret.md",
          detail: "Resolved path escapes /tmp/project.",
        },
      };
    });
    __setEnvironmentApiOverrideForTests(environmentId, createProjectWriteApi(writeFile));

    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <PlanWorkbenchPanel
        activePlan={activePlan()}
        activeProposedPlan={proposedPlan()}
        environmentId={environmentId}
        label="Plan"
        markdownCwd="/tmp/project"
        timestampFormat="24-hour"
      />,
      { container: host },
    );

    try {
      await page.getByRole("button", { name: "Plan actions" }).click();
      await page.getByText("Save to project").click();
      await page.getByPlaceholder("docs/plan.md").fill("../secret.md");
      await page.getByRole("button", { name: "Save" }).click();

      await vi.waitFor(async () => {
        await expect.element(page.getByRole("alert")).toBeVisible();
        await expect
          .element(page.getByText("Project file path must stay within the project root."))
          .toBeVisible();
        await expect.element(page.getByText("Resolved path escapes /tmp/project.")).toBeVisible();
        await expect
          .element(page.getByText("Operation: projectFileSystem.writeFile"))
          .toBeVisible();
        await expect.element(page.getByText("Project: /tmp/project")).toBeVisible();
        await expect.element(page.getByText("Path: ../secret.md")).toBeVisible();
      });
      expect(writeFile).toHaveBeenCalledWith({
        cwd: "/tmp/project",
        relativePath: "../secret.md",
        contents: "# Proposed Plan\n\n1. Keep tasks visible.\n2. Render markdown.\n",
      });
    } finally {
      await screen.unmount();
    }
  });
});
