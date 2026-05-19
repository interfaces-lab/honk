// Production CSS is part of the behavior under test because row height depends on it.
import "../../../index.css";
import "../../../styles/tokens.css";

import { scopedThreadKey, scopeThreadRef } from "@multi/client-runtime";
import {
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
  ThreadId,
  type MessageId,
  type TurnId,
} from "@multi/contracts";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { toastManager } from "../../../app/toast";
import { useComposerDraftStore } from "../../../stores/chat-drafts";
import { useUiStateStore } from "../../../stores/ui-state-store";
import {
  DEFAULT_VIEWPORT,
  LOCAL_ENVIRONMENT_ID,
  PROJECT_ID,
  UUID_ROUTE_RE,
  createSnapshotForTargetUser,
  draftIdFromPath,
  isoAt,
  withProjectScripts,
} from "./chat-view.browser.fixtures";
import {
  installChatViewBrowserHarness,
  mountChatView,
  waitForComposerEditor,
  waitForElement,
  waitForURL,
  wsRequests,
} from "./chat-view.browser.harness";

const WORKTREE_THREAD_ID = ThreadId.make("thread-worktree-sidebar");
const SECOND_WORKTREE_THREAD_ID = ThreadId.make("thread-worktree-sidebar-2");
const WORKTREE_PATH = "/repo/worktrees/sidebar-target";
const SECOND_WORKTREE_PATH = "/repo/worktrees/sidebar-follow-up";
const WORKTREE_BRANCH = "feature/sidebar-worktree";
const SECOND_WORKTREE_BRANCH = "feature/sidebar-follow-up";
const WORKTREE_TITLE = "Worktree sidebar target";
const SECOND_WORKTREE_TITLE = "Worktree sidebar follow-up";
const WORKTREE_THREAD_KEY = scopedThreadKey(
  scopeThreadRef(LOCAL_ENVIRONMENT_ID, WORKTREE_THREAD_ID),
);

installChatViewBrowserHarness();

function createWorktreeSidebarSnapshot(options: { includeSecondWorktree?: boolean } = {}) {
  const base = createSnapshotForTargetUser({
    targetMessageId: "msg-user-worktree-sidebar-base" as MessageId,
    targetText: "base thread",
  });
  const sourceThread = base.threads[0]!;
  const secondWorktreeThread = options.includeSecondWorktree
    ? [
        {
          ...sourceThread,
          id: SECOND_WORKTREE_THREAD_ID,
          title: SECOND_WORKTREE_TITLE,
          branch: SECOND_WORKTREE_BRANCH,
          worktreePath: SECOND_WORKTREE_PATH,
          updatedAt: isoAt(301),
          session: sourceThread.session
            ? {
                ...sourceThread.session,
                threadId: SECOND_WORKTREE_THREAD_ID,
              }
            : null,
        },
      ]
    : [];

  return withProjectScripts(
    {
      ...base,
      threads: [
        sourceThread,
        {
          ...sourceThread,
          id: WORKTREE_THREAD_ID,
          title: WORKTREE_TITLE,
          branch: WORKTREE_BRANCH,
          worktreePath: WORKTREE_PATH,
          updatedAt: isoAt(300),
          session: sourceThread.session
            ? {
                ...sourceThread.session,
                threadId: WORKTREE_THREAD_ID,
              }
            : null,
        },
        ...secondWorktreeThread,
      ],
    },
    [
      {
        id: "test",
        name: "Test",
        command: "bun run test",
        icon: "test",
        runOnWorktreeCreate: false,
      },
    ],
  );
}

function createUnreadWorktreeSidebarSnapshot() {
  const snapshot = createWorktreeSidebarSnapshot();
  return {
    ...snapshot,
    threads: snapshot.threads.map((thread) =>
      thread.id === WORKTREE_THREAD_ID
        ? {
            ...thread,
            latestTurn: {
              turnId: "turn-worktree-sidebar-unread" as TurnId,
              state: "completed" as const,
              requestedAt: isoAt(320),
              startedAt: isoAt(321),
              completedAt: isoAt(340),
              assistantMessageId: null,
            },
            updatedAt: isoAt(340),
            session: thread.session
              ? {
                  ...thread.session,
                  status: "ready" as const,
                  updatedAt: isoAt(340),
                }
              : null,
          }
        : thread,
    ),
  };
}

function findSidebarThreadRow(title: string): HTMLElement | null {
  const titleElement =
    Array.from(document.querySelectorAll<HTMLElement>("[data-agent-sidebar-title]")).find(
      (element) => element.textContent?.trim() === title,
    ) ?? null;
  return titleElement?.closest<HTMLElement>("[data-agent-sidebar-cell]") ?? null;
}

function findSidebarArchiveButton(title: string): HTMLButtonElement | null {
  return (
    findSidebarThreadRow(title)
      ?.closest<HTMLElement>("[data-agent-sidebar-row-shell]")
      ?.querySelector<HTMLButtonElement>('button[aria-label="Archive"]') ?? null
  );
}

describe("ChatView sidebar worktree behavior", () => {
  it("selects a worktree thread from the sidebar and runs project scripts at the worktree cwd", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createWorktreeSidebarSnapshot(),
    });

    try {
      const worktreeRow = await waitForElement(
        () => findSidebarThreadRow(WORKTREE_TITLE),
        "Unable to find worktree thread row.",
      );
      const worktreeSection = await waitForElement(
        () => worktreeRow.closest<HTMLElement>("[data-agent-sidebar-section]"),
        "Unable to find worktree sidebar section.",
      );
      expect(worktreeSection.textContent).toContain("worktrees/sidebar-target");
      expect(worktreeRow.textContent).toContain(WORKTREE_TITLE);
      expect(worktreeRow.textContent).not.toContain(WORKTREE_PATH);
      expect(worktreeRow.textContent).not.toContain(WORKTREE_BRANCH);

      worktreeRow.click();
      await waitForURL(
        mounted.router,
        (path) => path === `/${LOCAL_ENVIRONMENT_ID}/${WORKTREE_THREAD_ID}`,
        "Route should change to the selected worktree thread.",
      );
      await waitForComposerEditor();

      const pathSearchRequestCount = wsRequests.filter(
        (request) => request._tag === WS_METHODS.projectsSearchEntries,
      ).length;
      await page.getByTestId("composer-editor").fill("@src");

      await vi.waitFor(
        () => {
          const pathSearchRequest = wsRequests
            .slice(pathSearchRequestCount)
            .find((request) => request._tag === WS_METHODS.projectsSearchEntries);
          expect(pathSearchRequest).toMatchObject({
            _tag: WS_METHODS.projectsSearchEntries,
            cwd: WORKTREE_PATH,
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      const runButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.title === "Run Test",
          ) as HTMLButtonElement | null,
        "Unable to find Run Test button.",
      );
      runButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.terminalOpen,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.terminalOpen,
            threadId: WORKTREE_THREAD_ID,
            cwd: WORKTREE_PATH,
            env: {
              MULTI_PROJECT_ROOT: "/repo/project",
              MULTI_WORKTREE_PATH: WORKTREE_PATH,
            },
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("quick archives sidebar rows and batches the archive toast text", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createWorktreeSidebarSnapshot({ includeSecondWorktree: true }),
    });

    try {
      const firstArchive = await waitForElement(
        () => findSidebarArchiveButton(WORKTREE_TITLE),
        "Unable to find quick archive button for first worktree row.",
      );
      firstArchive.click();
      await vi.waitFor(() => {
        expect(
          wsRequests.some(
            (request) =>
              request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              request.type === "thread.archive" &&
              request.threadId === WORKTREE_THREAD_ID,
          ),
          "first quick archive: expected archive command for worktree row",
        ).toBe(true);
        expect(
          document.querySelector<HTMLElement>('[data-slot="toast-title"]')?.textContent,
          "first quick archive: expected named archive toast",
        ).toBe(`Archived "${WORKTREE_TITLE}"`);
      });

      const secondArchive = await waitForElement(
        () => findSidebarArchiveButton(SECOND_WORKTREE_TITLE),
        "Unable to find quick archive button for second worktree row.",
      );
      secondArchive.click();

      await vi.waitFor(() => {
        expect(
          wsRequests.some(
            (request) =>
              request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              request.type === "thread.archive" &&
              request.threadId === SECOND_WORKTREE_THREAD_ID,
          ),
          "second quick archive: expected archive command for second worktree row",
        ).toBe(true);
        expect(
          document.querySelector<HTMLElement>('[data-slot="toast-title"]')?.textContent,
          "second quick archive: expected batched archive toast",
        ).toBe("Archived 2 threads");
        expect(
          document.querySelector<HTMLElement>('[data-slot="toast-action"]')?.textContent,
          "second quick archive: expected batched undo action label",
        ).toBe("Undo all");
      });

      const undoAll = document.querySelector<HTMLButtonElement>('[data-slot="toast-action"]');
      expect(undoAll, "batched archive toast: expected undo action").not.toBeNull();
      undoAll?.click();

      await vi.waitFor(() => {
        expect(
          wsRequests.filter(
            (request) =>
              request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              request.type === "thread.unarchive",
          ),
          "undo all: expected one unarchive command per archived row",
        ).toHaveLength(2);
        expect(
          document.querySelector<HTMLElement>('[data-slot="toast-title"]'),
          "undo all: expected archive toast to dismiss",
        ).toBeNull();
      });
    } finally {
      toastManager.close();
      await mounted.cleanup();
    }
  });

  it("creates a worktree draft from the worktree sidebar section", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createWorktreeSidebarSnapshot(),
    });

    try {
      const worktreeRow = await waitForElement(
        () => findSidebarThreadRow(WORKTREE_TITLE),
        "Unable to find worktree thread row before creating a draft.",
      );
      worktreeRow.click();
      await waitForURL(
        mounted.router,
        (path) => path === `/${LOCAL_ENVIRONMENT_ID}/${WORKTREE_THREAD_ID}`,
        "Route should change to the selected worktree thread before creating a draft.",
      );

      await page.getByRole("button", { name: "New agent in worktrees/sidebar-target" }).click();
      const draftPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should change to a new draft from the worktree sidebar section.",
      );
      const draftSession = useComposerDraftStore
        .getState()
        .getDraftSession(draftIdFromPath(draftPath));

      expect(draftSession?.projectId, "worktree draft: expected source project id").toBe(
        PROJECT_ID,
      );
      expect(draftSession?.envMode, "worktree draft: expected worktree env mode").toBe("worktree");
      expect(draftSession?.worktreePath, "worktree draft: expected source worktree path").toBe(
        WORKTREE_PATH,
      );
      expect(draftSession?.branch, "worktree draft: expected source branch").toBe(WORKTREE_BRANCH);
    } finally {
      await mounted.cleanup();
    }
  });

  it("derives sidebar unread state from the visited boundary and clears it on selection", async () => {
    useUiStateStore.setState({
      threadLastVisitedAtById: {
        [WORKTREE_THREAD_KEY]: isoAt(330),
      },
    });
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createUnreadWorktreeSidebarSnapshot(),
    });

    try {
      const unreadWorktreeRow = await waitForElement(
        () => findSidebarThreadRow(WORKTREE_TITLE),
        "Unable to find unread worktree thread row.",
      );
      expect(
        unreadWorktreeRow.querySelector<HTMLElement>('[data-slot="status-dot"]')?.dataset.state,
        "worktree unread row: expected completed turn newer than visit to render unseen",
      ).toBe("doneUnseen");

      unreadWorktreeRow.click();
      await waitForURL(
        mounted.router,
        (path) => path === `/${LOCAL_ENVIRONMENT_ID}/${WORKTREE_THREAD_ID}`,
        "Route should change to the selected unread worktree thread.",
      );

      await vi.waitFor(() => {
        const selectedWorktreeRow = findSidebarThreadRow(WORKTREE_TITLE);
        if (!selectedWorktreeRow) {
          throw new Error("Unable to find selected worktree row after navigation.");
        }
        expect(
          selectedWorktreeRow.querySelector<HTMLElement>('[data-slot="status-dot"]')?.dataset.state,
          "worktree selected row: expected visit boundary to clear unread state",
        ).toBe("doneSeen");
      });
    } finally {
      await mounted.cleanup();
    }
  });
});
