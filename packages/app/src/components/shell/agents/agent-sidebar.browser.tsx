import "../../../index.css";
import "../../../styles/tokens.css";
import "../../../styles/app.css";

import { createRoot } from "react-dom/client";
import type { ComponentProps, ReactNode } from "react";
import { EnvironmentId, ProjectId, ThreadId } from "@multi/contracts";
import { scopeThreadRef } from "@multi/client-runtime";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildProjectChatSections } from "./sidebar/view-model";
import type { SidebarSectionModel, SidebarThreadSummary } from "./sidebar/types";
import { useUiStateStore } from "~/stores/ui-state-store";
import { AgentSidebar } from "./agent-sidebar";

const retainThreadDetailSubscriptionMock = vi.hoisted(() =>
  vi.fn((_environmentId: EnvironmentId, _threadId: ThreadId) => vi.fn()),
);

vi.mock("~/environments/runtime/service", () => {
  const environmentId = EnvironmentId.make("env-1");
  const primaryConnection = {
    environmentId,
    client: {
      server: {
        getConfig: vi.fn(),
        updateSettings: vi.fn(),
      },
    },
  };

  return {
    applyEnvironmentThreadDetailEvent: vi.fn(),
    ensureEnvironmentConnectionBootstrapped: async () => undefined,
    getEnvironmentWsRpcClient: () => primaryConnection.client,
    getPrimaryEnvironmentWsRpcClient: () => primaryConnection.client,
    getPrimaryEnvironmentConnection: () => primaryConnection,
    listEnvironmentConnections: () => [],
    readEnvironmentConnection: () => null,
    retainThreadDetailSubscription: retainThreadDetailSubscriptionMock,
    requireEnvironmentConnection: () => primaryConnection,
    resetEnvironmentServiceForTests: vi.fn(),
    shouldApplyProjectionEvent: () => true,
    shouldApplyProjectionSnapshot: () => true,
    shouldApplyTerminalEvent: () => true,
    startEnvironmentConnectionService: () => () => undefined,
    subscribeEnvironmentConnections: () => () => undefined,
  };
});

vi.mock("~/components/shell/agents/sidebar/context-menu", () => ({
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

const ENVIRONMENT_ID = EnvironmentId.make("env-1");
const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");
const PROJECT_STATE_KEY = "project-state-key";
const indicatorRows = [
  {
    id: ThreadId.make("thread-running"),
    label: "running",
    title: "Running branch handoff with a long title",
    state: "running",
    unread: false,
    ago: "2m",
  },
  {
    id: ThreadId.make("thread-attention"),
    label: "attention",
    title: "Pending approval and plan ready row",
    state: "needs_attention",
    unread: false,
    ago: "18m",
  },
  {
    id: ThreadId.make("thread-unread"),
    label: "unread",
    title: "Unread completed thread with long title",
    state: "idle",
    unread: true,
    ago: "4h",
  },
  {
    id: ThreadId.make("thread-completed"),
    label: "completed",
    title: "Completed read thread with long title",
    state: "idle",
    unread: false,
    ago: "3d",
  },
  {
    id: ThreadId.make("thread-error"),
    label: "error",
    title: "Failed thread row with long title",
    state: "error",
    unread: false,
    ago: "9d",
  },
] as const satisfies ReadonlyArray<{
  id: ThreadId;
  label: string;
  title: string;
  state: "idle" | "running" | "needs_attention" | "error";
  unread: boolean;
  ago: string;
}>;

function projectToggle(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    "[data-agent-sidebar-section] button[aria-expanded]",
  );
}

function makeOrderedProjectSections(
  summaries: readonly SidebarThreadSummary[],
): SidebarSectionModel[] {
  return buildProjectChatSections(summaries, [], "/repo/beta", "/Users/workgyver", undefined, [
    "/repo/alpha",
    "/repo/beta",
    "/repo/gamma",
  ]);
}

function sectionLabels(): Array<string | undefined> {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      "[data-agent-sidebar-section] button[aria-expanded]",
    ),
    (element) => element.textContent?.trim(),
  );
}

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
        pinned: false,
        updatedAt: "2026-04-29T12:00:00.000Z",
        latestReadableAt: "2026-04-29T12:00:00.000Z",
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

function makeThreadSection(
  count: number,
  options: { projectStateKey?: string } = {},
): SidebarSectionModel {
  const threadRefs = Array.from({ length: count }, (_, index) =>
    scopeThreadRef(ENVIRONMENT_ID, ThreadId.make(`thread-${index + 1}`)),
  );

  return {
    id: "ws:/tmp/project",
    label: "project",
    cwd: "/tmp/project",
    active: true,
    environmentId: ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    projectCwd: "/tmp/project",
    ...(options.projectStateKey ? { projectStateKey: options.projectStateKey } : {}),
    sectionThreadRefs: threadRefs,
    threadRefs,
    items: threadRefs.map((threadRef, index) => ({
      id: threadRef.threadId,
      kind: "thread",
      title: `Thread ${index + 1}`,
      state: "idle",
      unread: false,
      pinned: false,
      updatedAt: "2026-04-29T12:00:00.000Z",
      latestReadableAt: "2026-04-29T12:00:00.000Z",
      ago: `${index + 1}m`,
      cwd: "/tmp/project",
      environmentId: ENVIRONMENT_ID,
      projectId: PROJECT_ID,
      projectCwd: "/tmp/project",
      threadRef,
    })),
  };
}

function makeIndicatorSection(): SidebarSectionModel {
  const threadRefs = indicatorRows.map((row) => scopeThreadRef(ENVIRONMENT_ID, row.id));

  return {
    id: "ws:/tmp/indicators",
    label: "indicators",
    cwd: "/tmp/indicators",
    active: true,
    environmentId: ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    projectCwd: "/tmp/indicators",
    sectionThreadRefs: threadRefs,
    threadRefs,
    items: indicatorRows.map((row) => ({
      id: row.id,
      kind: "thread",
      title: row.title,
      state: row.state,
      unread: row.unread,
      pinned: false,
      updatedAt: "2026-04-29T12:00:00.000Z",
      latestReadableAt: "2026-04-29T12:00:00.000Z",
      ago: row.ago,
      cwd: "/tmp/indicators",
      environmentId: ENVIRONMENT_ID,
      projectId: PROJECT_ID,
      projectCwd: "/tmp/indicators",
      threadRef: scopeThreadRef(ENVIRONMENT_ID, row.id),
    })),
  };
}

function makeOrderingSummary(
  id: string,
  projectId: ProjectId,
  projectCwd: string,
  modifiedAt: string,
): SidebarThreadSummary {
  return {
    id: ThreadId.make(id),
    environmentId: ENVIRONMENT_ID,
    projectId,
    projectCwd,
    harness: "codex",
    path: projectCwd,
    cwd: projectCwd,
    name: id,
    createdAt: modifiedAt,
    modifiedAt,
    latestReadableAt: modifiedAt,
    messageCount: 1,
    firstMessage: id,
    isStreaming: false,
  };
}

async function mount(
  props: Partial<ComponentProps<typeof AgentSidebar>> = {},
  options: { width?: string } = {},
) {
  const host = document.createElement("div");
  if (options.width) {
    host.style.width = options.width;
  }
  document.body.append(host);
  const root = createRoot(host);
  const render = (nextProps: Partial<ComponentProps<typeof AgentSidebar>> = {}) => {
    root.render(
      <AgentSidebar
        sections={sections}
        selectedId="thread-1"
        onSelectAgent={vi.fn()}
        onNewAgent={vi.fn()}
        {...props}
        {...nextProps}
      />,
    );
  };
  render();
  await Promise.resolve();
  const cleanup = async () => {
    root.unmount();
    host.remove();
  };
  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
    host,
    rerender: async (nextProps: Partial<ComponentProps<typeof AgentSidebar>>) => {
      render(nextProps);
      await Promise.resolve();
    },
  };
}

describe("AgentSidebar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    retainThreadDetailSubscriptionMock.mockClear();
    useUiStateStore.setState({
      projectExpandedById: {},
      projectOrder: [],
      threadLastVisitedAtById: {},
    });
  });

  it("renders compact selected rows with stable status and time slots", async () => {
    await using _ = await mount();

    const selectedRow = page.getByRole("button", {
      name: /Implement compact sidebar rows/,
    });
    await vi.waitFor(() => {
      expect(
        selectedRow.element().closest<HTMLElement>("[data-agent-sidebar-cell]")?.dataset.selected,
      ).toBe("true");
    });

    const selectedElement = document.querySelector<HTMLElement>(
      '[data-agent-sidebar-cell][data-selected="true"]',
    );
    expect(
      selectedElement?.querySelector("[data-agent-sidebar-status]"),
      "selected row: expected status slot to render",
    ).not.toBeNull();
    expect(
      selectedElement?.querySelector("[data-agent-sidebar-subtitle]"),
      "selected row: expected time slot to render",
    ).not.toBeNull();
    expect(
      selectedElement?.querySelector("[data-agent-sidebar-subtitle]")?.textContent,
      "selected row: expected compact relative time",
    ).toBe("4m");
    const status = selectedElement?.querySelector("[data-agent-sidebar-status]");
    const time = selectedElement?.querySelector("[data-agent-sidebar-subtitle]");
    const pin = selectedElement?.querySelector("[data-agent-sidebar-pin-action]");
    const archive = selectedElement?.querySelector("[data-agent-sidebar-archive-action]");
    expect(status?.querySelector("[data-agent-sidebar-pin-action]")).toBeNull();
    expect(pin, "selected row: expected pin action to render").not.toBeNull();
    expect(archive, "selected row: expected archive action to render").not.toBeNull();
    if (!time || !pin || !archive) {
      throw new Error("selected row: expected trailing time, pin, and archive controls.");
    }
    expect(
      time.compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING,
      "selected row: expected time before pin",
    ).toBeTruthy();
    expect(
      pin.compareDocumentPosition(archive) & Node.DOCUMENT_POSITION_FOLLOWING,
      "selected row: expected pin before archive",
    ).toBeTruthy();
  });

  it("keeps project sections, active rows, and new-thread actions reachable", async () => {
    const onNewAgent = vi.fn();
    const onSelectAgent = vi.fn();
    await using mounted = await mount({ onNewAgent, onSelectAgent }, { width: "240px" });

    const projectSectionToggle = page.getByRole("button", { name: "project", exact: true });
    await expect.element(projectSectionToggle).toBeVisible();
    const sectionTitle = document.querySelector<HTMLElement>("[data-agent-sidebar-section-title]");
    const selectedRow = document.querySelector<HTMLElement>(
      '[data-agent-sidebar-cell][data-selected="true"]',
    );
    if (!sectionTitle || !selectedRow) {
      throw new Error("project section: expected section title and selected row to render.");
    }
    const listGutter = 16;
    expect(
      sectionTitle.getBoundingClientRect().width,
      "project section: expected section header background to inset from the list edges",
    ).toBeCloseTo(mounted.host.getBoundingClientRect().width - listGutter, 0);
    expect(
      selectedRow.getBoundingClientRect().width,
      "project section: expected selected row background to inset from the list edges",
    ).toBeCloseTo(mounted.host.getBoundingClientRect().width - listGutter, 0);
    expect(
      selectedRow.className,
      "project section: expected selected row to show an active background color",
    ).toContain("selected=true]:bg");
    expect(
      projectToggle()?.querySelector("[data-agent-sidebar-section-folder] svg"),
      "project section: expected folder icon in the section header",
    ).not.toBeNull();
    expect(
      projectToggle()?.querySelector("[data-agent-sidebar-section-chevron] svg"),
      "project section: expected collapsible chevron affordance in the section header",
    ).not.toBeNull();
    expect(
      page.getByRole("button", { name: "New agent in project" }).element().className,
      "project section: expected new-agent action to avoid separate hover styling",
    ).not.toContain("hover:");
    await vi.waitFor(() => {
      expect(
        page
          .getByRole("button", { name: /Implement compact sidebar rows/ })
          .element()
          .closest<HTMLElement>("[data-agent-sidebar-cell]")?.dataset.selected,
      ).toBe("true");
    });

    await page.getByRole("button", { name: "New agent in project" }).click();
    expect(
      onNewAgent,
      "project section: expected new-agent action to receive cwd",
    ).toHaveBeenCalledWith("/tmp/project");

    await page.getByRole("button", { name: /Draft follow-up/ }).click();
    expect(
      onSelectAgent,
      "draft row: expected selection action to receive draft id",
    ).toHaveBeenCalledWith("draft-1");
  });

  it("reveals a newly selected thread below the folded preview", async () => {
    const section = makeThreadSection(9);
    await using mounted = await mount({
      sections: [section],
      selectedId: "thread-1",
    });

    expect(
      document.querySelector('[data-agent-sidebar-cell][title="Thread 8"]'),
      "folded preview: thread 8 should be hidden before selection",
    ).toBeNull();

    await mounted.rerender({
      sections: [section],
      selectedId: "thread-8",
    });

    const selectedRow = page.getByRole("button", { name: "Thread 8" });
    await vi.waitFor(() => {
      expect(
        selectedRow.element().closest<HTMLElement>("[data-agent-sidebar-cell]")?.dataset.selected,
      ).toBe("true");
    });
  });

  it("persists project expansion state across sidebar remounts", async () => {
    const section = makeThreadSection(2, { projectStateKey: PROJECT_STATE_KEY });
    const firstMount = await mount({
      sections: [section],
      selectedId: null,
    });

    await page.getByRole("button", { name: "project", exact: true }).click();
    await vi.waitFor(() => {
      expect(
        projectToggle()?.getAttribute("aria-expanded"),
        "first mount: expected project section toggle to collapse",
      ).toBe("false");
      expect(
        document.querySelector('[data-agent-sidebar-cell][title="Thread 1"]'),
        "first mount: expected collapsed project to hide rows",
      ).toBeNull();
    });
    await firstMount.cleanup();

    await using _ = await mount({
      sections: [section],
      selectedId: null,
    });

    await vi.waitFor(() => {
      expect(
        projectToggle()?.getAttribute("aria-expanded"),
        "second mount: expected persisted project section collapse",
      ).toBe("false");
      expect(
        document.querySelector('[data-agent-sidebar-cell][title="Thread 1"]'),
        "second mount: expected persisted collapse to keep rows hidden",
      ).toBeNull();
    });
  });

  it("keeps the row geometry when entering rename mode", async () => {
    await using _ = await mount();

    await page.getByRole("button", { name: "Rename row" }).click();

    const renameRow = document.querySelector<HTMLElement>(
      "[data-agent-sidebar-cell][data-renaming]",
    );
    expect(renameRow, "rename mode: expected selected row wrapper").not.toBeNull();
    expect(
      renameRow?.querySelector("[data-agent-sidebar-status]"),
      "rename mode: expected status slot to stay mounted",
    ).not.toBeNull();
    expect(
      renameRow?.querySelector("[data-agent-sidebar-subtitle]")?.textContent,
      "rename mode: expected time slot to stay visible",
    ).toBe("4m");
    await expect
      .element(page.getByLabelText("Rename thread"))
      .toHaveValue("Implement compact sidebar rows");
  });

  it("retains thread details only for the first ten expanded visible rows", async () => {
    await using _ = await mount({
      sections: [makeThreadSection(14)],
      selectedId: null,
    });

    await vi.waitFor(() => {
      expect(
        retainThreadDetailSubscriptionMock,
        "collapsed project: expected subscriptions only for the five preview rows",
      ).toHaveBeenCalledTimes(5);
    });
    retainThreadDetailSubscriptionMock.mockClear();

    await page.getByRole("button", { name: "More" }).click();

    await vi.waitFor(() => {
      expect(
        retainThreadDetailSubscriptionMock,
        "expanded project: expected subscriptions only for the first ten visible rows",
      ).toHaveBeenCalledTimes(10);
    });
    expect(
      retainThreadDetailSubscriptionMock.mock.calls.map((call) => call[1]),
      "expanded project: expected subscriptions to follow visible row order",
    ).toEqual(Array.from({ length: 10 }, (_, index) => ThreadId.make(`thread-${index + 1}`)));
  });

  it("keeps project section order stable when projects are added and removed", async () => {
    const projectA = ProjectId.make("project-a");
    const projectB = ProjectId.make("project-b");
    const projectC = ProjectId.make("project-c");
    const mounted = await mount({
      sections: makeOrderedProjectSections([
        makeOrderingSummary("thread-alpha", projectA, "/repo/alpha", "2026-04-29T12:00:00.000Z"),
        makeOrderingSummary("thread-beta", projectB, "/repo/beta", "2026-04-29T12:01:00.000Z"),
      ]),
      selectedId: null,
    });

    await vi.waitFor(() => {
      expect(sectionLabels(), "initial projects: expected source project order").toEqual([
        "repo/alpha",
        "repo/beta",
      ]);
    });

    await mounted.rerender({
      sections: makeOrderedProjectSections([
        makeOrderingSummary("thread-alpha", projectA, "/repo/alpha", "2026-04-29T12:00:00.000Z"),
        makeOrderingSummary("thread-beta", projectB, "/repo/beta", "2026-04-29T12:01:00.000Z"),
        makeOrderingSummary("thread-gamma", projectC, "/repo/gamma", "2026-04-29T12:02:00.000Z"),
      ]),
      selectedId: null,
    });

    await vi.waitFor(() => {
      expect(
        sectionLabels(),
        "added project: expected new project appended without reordering",
      ).toEqual(["repo/alpha", "repo/beta", "repo/gamma"]);
    });

    await mounted.rerender({
      sections: makeOrderedProjectSections([
        makeOrderingSummary("thread-beta", projectB, "/repo/beta", "2026-04-29T12:01:00.000Z"),
        makeOrderingSummary("thread-gamma", projectC, "/repo/gamma", "2026-04-29T12:02:00.000Z"),
      ]),
      selectedId: null,
    });

    await vi.waitFor(() => {
      expect(
        sectionLabels(),
        "removed project: expected remaining project order to stay stable",
      ).toEqual(["repo/beta", "repo/gamma"]);
    });

    await mounted.cleanup();
  });

  it("keeps status, title, and time slots separated in narrow rows", async () => {
    await using _ = await mount(
      {
        sections: [makeIndicatorSection()],
        selectedId: "thread-attention",
      },
      { width: "172px" },
    );

    await vi.waitFor(() => {
      expect(
        document.querySelectorAll("[data-agent-sidebar-cell]").length,
        "indicator rows: expected all five status cases to render",
      ).toBe(5);
    });

    for (const expected of indicatorRows) {
      const titleElement = document.querySelector<HTMLElement>(
        `[data-agent-sidebar-title][title="${expected.title}"]`,
      );
      if (!titleElement) {
        throw new Error(`${expected.label}: expected title slot to render.`);
      }
      const row = titleElement.closest<HTMLElement>("[data-agent-sidebar-cell]");
      if (!row) {
        throw new Error(`${expected.label}: expected row wrapper to render.`);
      }
      await page.elementLocator(row).hover();
      const status = row.querySelector<HTMLElement>("[data-agent-sidebar-status]");
      const subtitle = row.querySelector<HTMLElement>("[data-agent-sidebar-subtitle]");
      if (!status || !subtitle) {
        throw new Error(`${expected.label}: expected status and subtitle slots to render.`);
      }

      const statusRect = status.getBoundingClientRect();
      const titleRect = titleElement.getBoundingClientRect();
      const subtitleRect = subtitle.getBoundingClientRect();

      expect(statusRect.width, `${expected.label}: status slot width`).toBeGreaterThan(0);
      expect(titleRect.width, `${expected.label}: title slot width`).toBeGreaterThan(0);
      expect(subtitleRect.width, `${expected.label}: time slot width`).toBeGreaterThan(0);
      expect(
        statusRect.right,
        `${expected.label}: status slot overlaps title slot`,
      ).toBeLessThanOrEqual(titleRect.left + 0.5);
      expect(
        titleRect.right,
        `${expected.label}: title slot overlaps time slot`,
      ).toBeLessThanOrEqual(subtitleRect.left + 0.5);
    }
  });
});
