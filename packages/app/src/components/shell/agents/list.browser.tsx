import "../../../index.css";
import "../../../styles/tokens.css";
import "../../../styles/app.css";

import { createRoot } from "react-dom/client";
import type { ComponentProps, ReactNode } from "react";
import { EnvironmentId, ProjectId, ThreadId } from "@multi/contracts";
import { scopeThreadRef } from "@multi/client-runtime";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SidebarSectionModel } from "~/lib/sidebar-chat-view-model";
import { AgentList } from "./list";

vi.mock("~/components/shell/sidebar/thread-context-menu", () => ({
  SidebarSectionContextMenu: (props: { children: ReactNode }) => <div>{props.children}</div>,
  ThreadContextMenu: (props: { children: ReactNode; onRename: () => void }) => (
    <div>
      <button type="button" onClick={props.onRename}>
        Rename row
      </button>
      {props.children}
    </div>
  ),
}));

vi.mock("~/hooks/use-thread-actions", () => ({
  useThreadActions: () => ({
    archiveThreads: vi.fn(async () => undefined),
    archiveThread: vi.fn(async () => undefined),
    commitRename: vi.fn(async () => undefined),
    removeProjectFromSidebar: vi.fn(async () => undefined),
  }),
}));

vi.mock("~/stores/thread-unread-store", () => ({
  useThreadUnreadStore: (
    selector: (state: { clear: (id: string) => void; mark: (id: string) => void }) => unknown,
  ) => selector({ clear: vi.fn(), mark: vi.fn() }),
}));

const ENVIRONMENT_ID = EnvironmentId.make("env-1");
const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");

const sections: SidebarSectionModel[] = [
  {
    id: "ws:/tmp/project",
    label: "project",
    cwd: "/tmp/project",
    active: true,
    environmentId: ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    projectCwd: "/tmp/project",
    sectionThreadRefs: [scopeThreadRef(ENVIRONMENT_ID, THREAD_ID)],
    threadRefs: [scopeThreadRef(ENVIRONMENT_ID, THREAD_ID)],
    items: [
      {
        id: THREAD_ID,
        kind: "thread",
        title: "Implement compact sidebar rows",
        state: "running",
        unread: true,
        updatedAt: "2026-04-29T12:00:00.000Z",
        ago: "4m",
        cwd: "/tmp/project",
        environmentId: ENVIRONMENT_ID,
        projectId: PROJECT_ID,
        projectCwd: "/tmp/project",
        threadRef: scopeThreadRef(ENVIRONMENT_ID, THREAD_ID),
      },
      {
        id: "draft-1",
        kind: "draft",
        title: "Draft follow-up",
        state: "draft",
        unread: false,
        updatedAt: "2026-04-29T12:01:00.000Z",
        ago: "now",
        cwd: "/tmp/project",
        environmentId: ENVIRONMENT_ID,
        projectId: PROJECT_ID,
        projectCwd: "/tmp/project",
      },
    ],
  },
];

async function mount(props: Partial<ComponentProps<typeof AgentList>> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <AgentList
      sections={sections}
      selectedId="thread-1"
      onSelectAgent={vi.fn()}
      onNewAgent={vi.fn()}
      {...props}
    />,
  );
  await Promise.resolve();
  const cleanup = async () => {
    root.unmount();
    host.remove();
  };
  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
  };
}

describe("AgentList sidebar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders compact selected rows with stable status and time slots", async () => {
    await using _ = await mount();

    const selectedRow = page.getByRole("button", {
      name: /Implement compact sidebar rows/,
    });
    await expect.element(selectedRow).toHaveAttribute("data-selected", "true");

    const selectedElement = document.querySelector<HTMLElement>(
      '[data-agent-sidebar-cell][data-selected="true"]',
    );
    expect(selectedElement?.querySelector("[data-agent-sidebar-status]")).not.toBeNull();
    expect(selectedElement?.querySelector("[data-agent-sidebar-subtitle]")).not.toBeNull();
    expect(selectedElement?.querySelector("[data-agent-sidebar-subtitle]")?.textContent).toBe("4m");
  });

  it("keeps the row geometry when entering rename mode", async () => {
    await using _ = await mount();

    await page.getByRole("button", { name: "Rename row" }).click();

    const renameRow = document.querySelector<HTMLElement>(
      "[data-agent-sidebar-cell][data-renaming]",
    );
    expect(renameRow).not.toBeNull();
    expect(renameRow?.querySelector("[data-agent-sidebar-status]")).not.toBeNull();
    expect(renameRow?.querySelector("[data-agent-sidebar-subtitle]")?.textContent).toBe("4m");
    await expect
      .element(page.getByLabelText("Rename thread"))
      .toHaveValue("Implement compact sidebar rows");
  });
});
