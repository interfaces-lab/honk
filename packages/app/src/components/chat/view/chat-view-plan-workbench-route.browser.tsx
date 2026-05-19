import "../../../index.css";
import "../../../styles/tokens.css";

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_VIEWPORT,
  LOCAL_ENVIRONMENT_ID,
  THREAD_ID,
  createSnapshotWithLongProposedPlan,
} from "./chat-view.browser.fixtures";
import {
  installChatViewBrowserHarness,
  mountChatView,
  waitForElement,
} from "./chat-view.browser.harness";
import { shellPanelsActions, type WorkbenchTab } from "~/stores/shell-panels-store";

const electronEnvMock = vi.hoisted(() => ({
  isElectron: true,
  isElectronHost: () => true,
  applyHostMarkers: () => {
    document.documentElement.dataset.electron = "";
  },
}));

vi.mock("../../../env", () => electronEnvMock);
vi.mock("~/env", () => electronEnvMock);

async function waitForActiveWorkbenchPanel(tab: WorkbenchTab): Promise<HTMLElement> {
  return waitForElement(
    () =>
      document.querySelector<HTMLElement>(
        `[data-workbench-panel="${tab}"][data-workbench-panel-active="true"]`,
      ),
    `Unable to find active ${tab} workbench panel.`,
  );
}

describe("ChatView plan workbench route search", () => {
  installChatViewBrowserHarness();

  it("activates the workbench tab requested by route changes", async () => {
    shellPanelsActions.setActiveTab("files");
    shellPanelsActions.setRightOpen(false);
    shellPanelsActions.setMuted(false);

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotWithLongProposedPlan(),
      initialPath: `/${LOCAL_ENVIRONMENT_ID}/${THREAD_ID}?workbench=terminal`,
    });

    try {
      await waitForActiveWorkbenchPanel("terminal");

      await mounted.router.navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: LOCAL_ENVIRONMENT_ID,
          threadId: THREAD_ID,
        },
        search: { workbench: "plan" },
      });

      await vi.waitFor(
        () => {
          expect(mounted.router.state.location.search.workbench).toBe("plan");
        },
        { timeout: 8_000, interval: 16 },
      );
      await waitForActiveWorkbenchPanel("plan");
      expect(document.querySelector('button[title="Build plan"]')).toBeTruthy();

      await mounted.router.navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: LOCAL_ENVIRONMENT_ID,
          threadId: THREAD_ID,
        },
        search: { workbench: "files" },
      });

      await vi.waitFor(
        () => {
          expect(mounted.router.state.location.search.workbench).toBe("files");
        },
        { timeout: 8_000, interval: 16 },
      );
      await waitForActiveWorkbenchPanel("files");
    } finally {
      await mounted.cleanup();
    }
  });
});
