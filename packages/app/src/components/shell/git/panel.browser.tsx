import "../../../index.css";

import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { ToastProvider, toastManager } from "~/app/toast";
import type { DiffRow, GitPanelModel } from "~/hooks/use-environment-git";
import { GitPanel } from "./panel";

vi.mock("~/env", () => ({
  applyHostMarkers: vi.fn(),
  isElectron: true,
  isElectronHost: () => true,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: <TResult,>(options?: {
    select?: (params: Partial<Record<"environmentId" | "threadId" | "draftId", string>>) => TResult;
  }) => {
    const params = {};
    return options?.select ? options.select(params) : params;
  },
  useSearch: <TResult,>(options?: {
    select?: (search: Partial<Record<"diff" | "workbench", string>>) => TResult;
  }) => {
    const search = {};
    return options?.select ? options.select(search) : search;
  },
}));

const toastIds: ReturnType<typeof toastManager.add>[] = [];
const addToast = toastManager.add.bind(toastManager);

function trackToastAdds() {
  return vi.spyOn(toastManager, "add").mockImplementation((input) => {
    const id = addToast(input);
    toastIds.push(id);
    return id;
  });
}

const changedRow: DiffRow = {
  id: "src/app.ts",
  path: "src/app.ts",
  prevPath: null,
  state: "modified",
  staged: false,
  unstaged: true,
  add: 4,
  del: 2,
};

function gitPanelModel(overrides?: Partial<GitPanelModel>): GitPanelModel {
  return {
    cwd: "/repo/multi",
    view: { kind: "changed" },
    count: 1,
    branch: "main",
    rows: [changedRow],
    totalAdd: 4,
    totalDel: 2,
    focusId: null,
    patchesByPath: new Map(),
    diffLoadingByPath: new Set(),
    diffErrorByPath: new Map(),
    expandedIds: new Set(),
    lifecycleSync: null,
    requestDiff: vi.fn(),
    toggleExpand: vi.fn(),
    expandAll: vi.fn(),
    collapseAll: vi.fn(),
    refresh: vi.fn(async () => undefined),
    init: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("GitPanel", () => {
  afterEach(() => {
    for (const id of toastIds.splice(0)) {
      toastManager.close(id);
    }
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("renders Git command details in the discard error toast", async () => {
    trackToastAdds();
    const discard = vi.fn<GitPanelModel["discard"]>(async () => {
      throw {
        _tag: "GitCommandError",
        operation: "git.discardPaths",
        command: "git checkout -- src/app.ts",
        cwd: "/repo/multi",
        detail: "git checkout failed: local changes would be overwritten",
      };
    });
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <ToastProvider>
        <GitPanel
          git={gitPanelModel({ discard })}
          onAgentAction={vi.fn()}
          onStopAgentAction={null}
          stoppingAgentAction={false}
          pendingAgentAction={null}
        />
      </ToastProvider>,
      { container: host },
    );

    try {
      await page.getByRole("button", { name: "Discard all changes" }).click();
      await page.getByRole("button", { name: "Discard All" }).click();
      await vi.waitFor(() => {
        expect(discard).toHaveBeenCalledWith(["src/app.ts"]);
      });

      await vi.waitFor(() => {
        const title = document.querySelector('[data-slot="toast-title"]')?.textContent ?? "";
        const description =
          document.querySelector('[data-slot="toast-description"]')?.textContent ?? "";
        expect(title).toBe("Could not discard changes");
        expect(description).toContain("git checkout failed: local changes would be overwritten");
        expect(description).toContain("Command: git checkout -- src/app.ts");
        expect(description).toContain("Project: /repo/multi");
        expect(description).toContain("Operation: git.discardPaths");
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
