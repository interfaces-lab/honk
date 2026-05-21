// Production CSS is part of the behavior under test because row height depends on it.
import "../../../index.css";
import "../../../styles/tokens.css";

import {
  DEFAULT_TERMINAL_ID,
  ORCHESTRATION_WS_METHODS,
  type MessageId,
  type ServerConfig,
  type ThreadId,
  WS_METHODS,
  ProviderInstanceId,
} from "@multi/contracts";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { useComposerDraftStore, DraftId } from "../../../stores/chat-drafts";
import { useTerminalStateStore } from "../../../terminal-state-store";
import { useUiStateStore } from "../../../stores/ui-state-store";
import { useShellPanelsStore } from "~/stores/shell-panels-store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../../../types";
import { workbenchTerminalThreadId } from "~/components/shell/terminal/workbench-terminal";

import {
  COMPACT_FOOTER_VIEWPORT,
  DEFAULT_VIEWPORT,
  LOCAL_ENVIRONMENT_ID,
  NOW_ISO,
  PROJECT_DRAFT_KEY,
  PROJECT_ID,
  PROJECT_KEY,
  SECOND_PROJECT_ID,
  THREAD_ID,
  THREAD_KEY,
  THREAD_REF,
  THREAD_TITLE,
  UUID_ROUTE_RE,
  WIDE_FOOTER_VIEWPORT,
  addThreadToSnapshot,
  composerDraftFor,
  createDraftOnlySnapshot,
  createProjectlessSnapshot,
  createSnapshotForTargetUser,
  createSnapshotWithLongProposedPlan,
  createSnapshotWithPendingUserInput,
  createSnapshotWithSecondaryProject,
  draftIdFromPath,
  draftThreadIdFor,
  serverThreadPath,
  setDraftThreadWithoutWorktree,
  threadRefFor,
  withProjectScripts,
} from "./chat-view.browser.fixtures";
import {
  dispatchChatNewShortcut,
  expectComposerActionsContained,
  findButtonByText,
  findComposerProviderModelPicker,
  fixture,
  installChatViewBrowserHarness,
  materializePromotedDraftThreadViaDomainEvent,
  mountChatView,
  openCommandPaletteFromTrigger,
  pressComposerKey,
  pressComposerUndo,
  promoteDraftThreadViaDomainEvent,
  selectAllComposerContent,
  setComposerSelectionByTextOffsets,
  startPromotedServerThreadViaDomainEvent,
  triggerChatNewShortcutUntilPath,
  waitForButtonByText,
  waitForButtonContainingText,
  waitForCommandPaletteShortcutLabel,
  waitForComposerEditor,
  waitForComposerMenuItem,
  waitForComposerText,
  waitForElement,
  waitForInteractionModeButton,
  waitForLayout,
  waitForSelectItemContainingText,
  waitForSendButton,
  waitForServerConfigToApply,
  waitForURL,
  wsRequests,
} from "./chat-view.browser.harness";

vi.mock("../lib/git-status-state", () => ({
  useGitStatus: () => ({ data: null, error: null, cause: null, isPending: false }),
  useGitStatuses: () => new Map(),
  refreshGitStatus: () => Promise.resolve(null),
  resetGitStatusStateForTests: () => undefined,
}));

function setVisibleDraftThreadWithoutWorktree(): void {
  setDraftThreadWithoutWorktree();
  useComposerDraftStore.getState().setPrompt(DraftId.make(THREAD_KEY), "draft thread");
}

async function openProjectSectionInEditor(): Promise<void> {
  useComposerDraftStore.getState().setPrompt(DraftId.make(THREAD_KEY), "draft thread");
  await waitForLayout();
  const projectSectionButton = await waitForElement(
    () => document.querySelector<HTMLButtonElement>("[data-agent-sidebar-section] button"),
    "Unable to find Project section button.",
  );
  const rect = projectSectionButton.getBoundingClientRect();
  projectSectionButton.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: rect.left + 4,
      clientY: rect.top + 4,
    }),
  );
  const openItem = await waitForElement(
    () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-slot="context-menu-popup"] *')).find(
        (item) => item.textContent?.trim() === "Open in Editor Window",
      ) ?? null,
    "Unable to find Open in Editor Window menu item.",
  );
  openItem.click();
  await waitForLayout();
}

function findSidebarThreadTitle(title = THREAD_TITLE): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>("[data-agent-sidebar-title]")).find(
      (element) => element.textContent?.trim() === title,
    ) ?? null
  );
}

async function openPlanWorkbenchPanel(): Promise<void> {
  const planTab = await waitForElement(
    () => document.querySelector<HTMLButtonElement>('button[aria-label="Plan"]'),
    "Unable to find Plan workbench tab.",
  );
  planTab.click();
  await waitForElement(
    () =>
      document.querySelector<HTMLElement>(
        '[data-workbench-panel="plan"][data-workbench-panel-active="true"]',
      ),
    "Unable to activate Plan workbench panel.",
  );
}

function findSidebarThreadRow(title = THREAD_TITLE): HTMLElement | null {
  return findSidebarThreadTitle(title)?.closest<HTMLElement>("[data-agent-sidebar-cell]") ?? null;
}

async function openSidebarThreadContextMenu(title = THREAD_TITLE): Promise<void> {
  const threadRow = await waitForElement(
    () => findSidebarThreadRow(title),
    `Unable to find sidebar row for "${title}".`,
  );
  const rect = threadRow.getBoundingClientRect();
  threadRow.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: rect.left + 4,
      clientY: rect.top + 4,
    }),
  );
  await waitForElement(
    () => document.querySelector<HTMLElement>('[data-slot="context-menu-popup"]'),
    "Unable to find sidebar thread context menu.",
  );
}

async function expectCompactModelPickerContained(): Promise<void> {
  const composer = await waitForElement(
    () => document.querySelector<HTMLElement>('[data-model-picker-placement="top-start"]'),
    "Unable to find compact composer model-picker placement.",
  );
  const footer = await waitForElement(
    () => document.querySelector<HTMLElement>('[data-chat-input-footer="true"]'),
    "Unable to find composer footer.",
  );
  const trigger = await waitForElement(
    () => findComposerProviderModelPicker(),
    "Unable to find composer model picker trigger.",
  );

  await vi.waitFor(
    () => {
      expect(footer.dataset.chatInputFooterCompact).toBe("true");
      const composerRect = composer.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      expect(triggerRect.width).toBeGreaterThan(0);
      expect(triggerRect.left).toBeGreaterThanOrEqual(composerRect.left - 0.5);
      expect(triggerRect.right).toBeLessThanOrEqual(composerRect.right + 0.5);
      expect(triggerRect.left).toBeGreaterThanOrEqual(footerRect.left - 0.5);
      expect(triggerRect.right).toBeLessThanOrEqual(footerRect.right + 0.5);
    },
    { timeout: 8_000, interval: 16 },
  );

  trigger.click();
  const popup = await waitForElement(
    () => document.querySelector<HTMLElement>('[data-slot="popover-positioner"]'),
    "Unable to find model picker popover.",
  );
  await vi.waitFor(
    () => {
      const popupRect = popup.getBoundingClientRect();
      expect(popupRect.width).toBeGreaterThan(0);
      expect(popupRect.left).toBeGreaterThanOrEqual(-0.5);
      expect(popupRect.right).toBeLessThanOrEqual(window.innerWidth + 0.5);
    },
    { timeout: 8_000, interval: 16 },
  );
}

describe("ChatView timeline estimator parity (full app)", () => {
  installChatViewBrowserHarness();

  it("re-expands the bootstrap project using its scoped key", async () => {
    useUiStateStore.setState({
      projectExpandedById: {
        [PROJECT_KEY]: false,
      },
      projectOrder: [PROJECT_KEY],
      threadLastVisitedAtById: {},
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-bootstrap-project-expand" as MessageId,
        targetText: "bootstrap project expand",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          expect(useUiStateStore.getState().projectExpandedById[PROJECT_KEY]).toBe(true);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the project cwd for draft threads without a worktree path", async () => {
    setVisibleDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["vscode"],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      await openProjectSectionInEditor();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "vscode",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not leak a server worktree path into drawer runtime env when launch context clears it", async () => {
    const snapshot = createSnapshotForTargetUser({
      targetMessageId: "msg-user-launch-context-target" as MessageId,
      targetText: "launch context worktree override",
    });
    const targetThread = snapshot.threads.find((thread) => thread.id === THREAD_ID);
    if (targetThread) {
      Object.assign(targetThread, {
        branch: "feature/branch",
        worktreePath: "/repo/worktrees/feature-branch",
      });
    }

    useTerminalStateStore.setState({
      terminalStateByThreadKey: {
        [THREAD_KEY]: {
          terminalOpen: true,
          terminalHeight: 280,
          terminalIds: ["default"],
          runningTerminalIds: [],
          activeTerminalId: "default",
          terminalGroups: [{ id: "group-default", terminalIds: ["default"] }],
          activeTerminalGroupId: "group-default",
        },
      },
      terminalLaunchContextByThreadKey: {
        [THREAD_KEY]: {
          cwd: "/repo/project",
          worktreePath: null,
        },
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot,
    });

    try {
      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.terminalOpen,
          ) as
            | {
                _tag: string;
                cwd?: string;
                worktreePath?: string | null;
                env?: Record<string, string>;
              }
            | undefined;
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.terminalOpen,
            cwd: "/repo/project",
            worktreePath: null,
            env: {
              MULTI_PROJECT_ROOT: "/repo/project",
            },
          });
          expect(openRequest?.env?.MULTI_WORKTREE_PATH).toBeUndefined();
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the project cwd with VS Code Insiders when it is the only available editor", async () => {
    setVisibleDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["vscode-insiders"],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      await openProjectSectionInEditor();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "vscode-insiders",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the project cwd with Trae when it is the only available editor", async () => {
    setVisibleDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["trae"],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      await openProjectSectionInEditor();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "trae",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the project cwd with Kiro when it is the only available editor", async () => {
    setVisibleDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["kiro"],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      await openProjectSectionInEditor();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "kiro",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the project cwd with the stored VSCodium preference", async () => {
    localStorage.setItem("multi:last-editor", JSON.stringify("vscodium"));
    setVisibleDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["vscode-insiders", "vscodium"],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      await openProjectSectionInEditor();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "vscodium",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("falls back to the first installed editor when the stored favorite is unavailable", async () => {
    localStorage.setItem("multi:last-editor", JSON.stringify("vscodium"));
    setVisibleDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["vscode-insiders"],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      await openProjectSectionInEditor();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "vscode-insiders",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("runs project scripts from local draft threads at the project cwd", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadKey: {
        [THREAD_KEY]: {
          threadId: THREAD_ID,
          environmentId: LOCAL_ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          logicalProjectKey: PROJECT_DRAFT_KEY,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      logicalProjectDraftThreadKeyByLogicalProjectKey: {
        [PROJECT_DRAFT_KEY]: THREAD_KEY,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(createDraftOnlySnapshot(), [
        {
          id: "lint",
          name: "Lint",
          command: "bun run lint",
          icon: "lint",
          runOnWorktreeCreate: false,
        },
      ]),
    });

    try {
      await waitForLayout();
      wsRequests.length = 0;

      const runButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.title === "Run Lint",
          ) as HTMLButtonElement | null,
        "Unable to find Run Lint button.",
      );
      runButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.terminalOpen,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.terminalOpen,
            threadId: workbenchTerminalThreadId("/repo/project"),
            terminalId: DEFAULT_TERMINAL_ID,
            cwd: "/repo/project",
            env: {
              MULTI_PROJECT_ROOT: "/repo/project",
            },
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      await vi.waitFor(
        () => {
          const writeRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.terminalWrite,
          );
          expect(writeRequest).toMatchObject({
            _tag: WS_METHODS.terminalWrite,
            threadId: workbenchTerminalThreadId("/repo/project"),
            terminalId: DEFAULT_TERMINAL_ID,
            data: "bun run lint\r",
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      const terminalStoreState = useTerminalStateStore.getState();
      expect(terminalStoreState.terminalStateByThreadKey[THREAD_KEY]?.terminalOpen ?? false).toBe(
        false,
      );
      expect(terminalStoreState.terminalLaunchContextByThreadKey[THREAD_KEY]).toBeUndefined();
      expect(useShellPanelsStore.getState().activeTab).toBe("terminal");
    } finally {
      await mounted.cleanup();
    }
  });

  it("runs project scripts in the active workbench terminal even when the thread terminal is marked running", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadKey: {
        [THREAD_KEY]: {
          threadId: THREAD_ID,
          environmentId: LOCAL_ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          logicalProjectKey: PROJECT_DRAFT_KEY,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      logicalProjectDraftThreadKeyByLogicalProjectKey: {
        [PROJECT_DRAFT_KEY]: THREAD_KEY,
      },
    });
    useTerminalStateStore.setState({
      terminalStateByThreadKey: {
        [THREAD_KEY]: {
          terminalOpen: true,
          terminalHeight: 280,
          terminalIds: ["default"],
          runningTerminalIds: ["default"],
          activeTerminalId: "default",
          terminalGroups: [{ id: "group-default", terminalIds: ["default"] }],
          activeTerminalGroupId: "group-default",
        },
      },
    });
    useShellPanelsStore.setState({
      terminalByCwd: {
        "/repo/project": {
          activeId: "term-visible",
          sessions: [
            { id: DEFAULT_TERMINAL_ID, label: "Terminal" },
            { id: "term-visible", label: "Terminal 2" },
          ],
        },
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(createDraftOnlySnapshot(), [
        {
          id: "lint",
          name: "Lint",
          command: "bun run lint",
          icon: "lint",
          runOnWorktreeCreate: false,
        },
      ]),
    });

    try {
      await waitForLayout();
      wsRequests.length = 0;

      const runButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.title === "Run Lint",
          ) as HTMLButtonElement | null,
        "Unable to find Run Lint button.",
      );
      runButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.terminalOpen,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.terminalOpen,
            threadId: workbenchTerminalThreadId("/repo/project"),
            terminalId: "term-visible",
            cwd: "/repo/project",
          });
          expect(openRequest).not.toHaveProperty("cols");
          expect(openRequest).not.toHaveProperty("rows");
        },
        { timeout: 8_000, interval: 16 },
      );

      await vi.waitFor(
        () => {
          const writeRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.terminalWrite,
          );
          expect(writeRequest).toMatchObject({
            _tag: WS_METHODS.terminalWrite,
            threadId: workbenchTerminalThreadId("/repo/project"),
            terminalId: "term-visible",
            data: "bun run lint\r",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("runs project scripts from worktree draft threads at the worktree cwd", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadKey: {
        [THREAD_KEY]: {
          threadId: THREAD_ID,
          environmentId: LOCAL_ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          logicalProjectKey: PROJECT_DRAFT_KEY,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "feature/draft",
          worktreePath: "/repo/worktrees/feature-draft",
          envMode: "worktree",
        },
      },
      logicalProjectDraftThreadKeyByLogicalProjectKey: {
        [PROJECT_DRAFT_KEY]: THREAD_KEY,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(createDraftOnlySnapshot(), [
        {
          id: "test",
          name: "Test",
          command: "bun run test",
          icon: "test",
          runOnWorktreeCreate: false,
        },
      ]),
    });

    try {
      await waitForLayout();
      wsRequests.length = 0;

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
            threadId: workbenchTerminalThreadId("/repo/worktrees/feature-draft"),
            terminalId: DEFAULT_TERMINAL_ID,
            cwd: "/repo/worktrees/feature-draft",
            env: {
              MULTI_PROJECT_ROOT: "/repo/project",
              MULTI_WORKTREE_PATH: "/repo/worktrees/feature-draft",
            },
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("lets the server own setup after preparing a pull request worktree thread", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadKey: {
        [THREAD_KEY]: {
          threadId: THREAD_ID,
          environmentId: LOCAL_ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          logicalProjectKey: PROJECT_DRAFT_KEY,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      logicalProjectDraftThreadKeyByLogicalProjectKey: {
        [PROJECT_DRAFT_KEY]: THREAD_KEY,
      },
    });

    const mounted = await mountChatView({
      viewport: WIDE_FOOTER_VIEWPORT,
      snapshot: withProjectScripts(createDraftOnlySnapshot(), [
        {
          id: "setup",
          name: "Setup",
          command: "bun install",
          icon: "configure",
          runOnWorktreeCreate: true,
        },
      ]),
      resolveRpc: (body) => {
        if (body._tag === WS_METHODS.gitResolvePullRequest) {
          return {
            pullRequest: {
              number: 1359,
              title: "Add thread archiving and settings navigation",
              url: "https://github.com/interfaces-co/Multi/pull/1359",
              baseBranch: "main",
              headBranch: "archive-settings-overhaul",
              state: "open",
            },
          };
        }
        if (body._tag === WS_METHODS.gitPreparePullRequestThread) {
          return {
            pullRequest: {
              number: 1359,
              title: "Add thread archiving and settings navigation",
              url: "https://github.com/interfaces-co/Multi/pull/1359",
              baseBranch: "main",
              headBranch: "archive-settings-overhaul",
              state: "open",
            },
            branch: "archive-settings-overhaul",
            worktreePath: "/repo/worktrees/pr-1359",
          };
        }
        return undefined;
      },
    });

    try {
      const branchButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "main",
          ) as HTMLButtonElement | null,
        "Unable to find branch selector button.",
      );
      branchButton.click();

      const branchInput = await waitForElement(
        () => document.querySelector<HTMLInputElement>('input[placeholder="Search branches..."]'),
        "Unable to find branch search input.",
      );
      branchInput.focus();
      await page.getByPlaceholder("Search branches...").fill("1359");

      const checkoutItem = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("span")).find(
            (element) => element.textContent?.trim() === "Checkout Pull Request",
          ) as HTMLSpanElement | null,
        "Unable to find checkout pull request option.",
      );
      checkoutItem.click();

      const worktreeButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Worktree",
          ) as HTMLButtonElement | null,
        "Unable to find Worktree button.",
      );
      worktreeButton.click();

      await vi.waitFor(
        () => {
          const prepareRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.gitPreparePullRequestThread,
          );
          expect(prepareRequest).toMatchObject({
            _tag: WS_METHODS.gitPreparePullRequestThread,
            cwd: "/repo/project",
            reference: "1359",
            mode: "worktree",
            threadId: THREAD_ID,
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      expect(
        wsRequests.some(
          (request) =>
            request._tag === WS_METHODS.terminalWrite && request.data === "bun install\r",
        ),
      ).toBe(false);
    } finally {
      await mounted.cleanup();
    }
  });

  it("sends bootstrap turn-starts and waits for server setup on first-send worktree drafts", async () => {
    useTerminalStateStore.setState({
      terminalStateByThreadKey: {},
    });
    useComposerDraftStore.setState({
      draftThreadsByThreadKey: {
        [THREAD_KEY]: {
          threadId: THREAD_ID,
          environmentId: LOCAL_ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          logicalProjectKey: PROJECT_DRAFT_KEY,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "main",
          worktreePath: null,
          envMode: "worktree",
        },
      },
      logicalProjectDraftThreadKeyByLogicalProjectKey: {
        [PROJECT_DRAFT_KEY]: THREAD_KEY,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(createDraftOnlySnapshot(), [
        {
          id: "setup",
          name: "Setup",
          command: "bun install",
          icon: "configure",
          runOnWorktreeCreate: true,
        },
      ]),
      resolveRpc: (body) => {
        if (body._tag === ORCHESTRATION_WS_METHODS.dispatchCommand) {
          return {
            sequence: fixture.snapshot.snapshotSequence + 1,
          };
        }
        return undefined;
      },
    });

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_REF, "Ship it");
      await waitForLayout();

      const sendButton = await waitForSendButton();
      expect(sendButton.disabled).toBe(false);
      sendButton.click();

      await vi.waitFor(
        () => {
          const dispatchRequest = wsRequests.find(
            (request) =>
              request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              request.type === "thread.turn.start",
          ) as
            | {
                _tag: string;
                type?: string;
                bootstrap?: {
                  createThread?: { projectId?: string };
                  prepareWorktree?: { projectCwd?: string; baseBranch?: string; branch?: string };
                  runSetupScript?: boolean;
                };
              }
            | undefined;
          expect(dispatchRequest).toMatchObject({
            _tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
            type: "thread.turn.start",
            bootstrap: {
              createThread: {
                projectId: PROJECT_ID,
              },
              prepareWorktree: {
                projectCwd: "/repo/project",
                baseBranch: "main",
                branch: expect.stringMatching(/^multi\/[0-9a-f]{8}$/),
              },
              runSetupScript: true,
            },
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      expect(wsRequests.some((request) => request._tag === WS_METHODS.gitCreateWorktree)).toBe(
        false,
      );
      expect(
        wsRequests.some(
          (request) =>
            request._tag === WS_METHODS.terminalWrite &&
            request.threadId === THREAD_ID &&
            request.data === "bun install\r",
        ),
      ).toBe(false);
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not render branch controls on server thread mode", async () => {
    const snapshot = addThreadToSnapshot(createDraftOnlySnapshot(), THREAD_ID);
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: {
        ...snapshot,
        threads: snapshot.threads.map((thread) =>
          thread.id === THREAD_ID ? Object.assign({}, thread, { session: null }) : thread,
        ),
      },
      resolveRpc: (body) => {
        if (body._tag === ORCHESTRATION_WS_METHODS.dispatchCommand) {
          return {
            sequence: fixture.snapshot.snapshotSequence + 1,
          };
        }
        return undefined;
      },
    });

    try {
      await waitForLayout();
      expect(findButtonByText("Current checkout")).toBeNull();
      expect(findButtonByText("Branch")).toBeNull();
      expect(document.querySelector('input[placeholder="Search branches..."]')).toBeNull();

      useComposerDraftStore
        .getState()
        .setPrompt(
          THREAD_REF,
          "   Ship this first thread title through the trimmed auto title path now   ",
        );
      await waitForLayout();

      const sendButton = await waitForSendButton();
      expect(sendButton.disabled).toBe(false);
      sendButton.click();

      await vi.waitFor(
        () => {
          const titleRequest = wsRequests.find(
            (request) =>
              request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              request.type === "thread.meta.update",
          ) as
            | {
                _tag: string;
                type?: string;
                title?: string;
              }
            | undefined;
          expect(titleRequest).toMatchObject({
            _tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
            type: "thread.meta.update",
            title: "Ship this first thread title through the trimmed a...",
          });

          const turnStartRequest = wsRequests.find(
            (request) =>
              request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              request.type === "thread.turn.start",
          ) as
            | {
                _tag: string;
                type?: string;
                bootstrap?: {
                  createThread?: { projectId?: string };
                  prepareWorktree?: { projectCwd?: string; baseBranch?: string; branch?: string };
                };
              }
            | undefined;
          expect(turnStartRequest).toMatchObject({
            _tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
            type: "thread.turn.start",
          });
          expect(turnStartRequest?.bootstrap).toBeUndefined();
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows the send state once bootstrap dispatch is in flight", async () => {
    useTerminalStateStore.setState({
      terminalStateByThreadKey: {},
    });
    useComposerDraftStore.setState({
      draftThreadsByThreadKey: {
        [THREAD_KEY]: {
          threadId: THREAD_ID,
          environmentId: LOCAL_ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          logicalProjectKey: PROJECT_DRAFT_KEY,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "main",
          worktreePath: null,
          envMode: "worktree",
        },
      },
      logicalProjectDraftThreadKeyByLogicalProjectKey: {
        [PROJECT_DRAFT_KEY]: THREAD_KEY,
      },
    });

    let resolveDispatch!: (value: { sequence: number }) => void;
    const dispatchPromise = new Promise<{ sequence: number }>((resolve) => {
      resolveDispatch = resolve;
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(createDraftOnlySnapshot(), [
        {
          id: "setup",
          name: "Setup",
          command: "bun install",
          icon: "configure",
          runOnWorktreeCreate: true,
        },
      ]),
      resolveRpc: (body) => {
        if (body._tag === ORCHESTRATION_WS_METHODS.dispatchCommand) {
          return dispatchPromise;
        }
        return undefined;
      },
    });

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_REF, "Ship it");
      await waitForLayout();

      const sendButton = await waitForSendButton();
      expect(sendButton.disabled).toBe(false);
      sendButton.click();

      await vi.waitFor(
        () => {
          expect(
            wsRequests.some((request) => request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand),
          ).toBe(true);
          expect(document.querySelector('button[aria-label="Sending"]')).toBeTruthy();
          expect(document.querySelector('button[aria-label="Preparing worktree"]')).toBeNull();
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      resolveDispatch({ sequence: fixture.snapshot.snapshotSequence + 1 });
      await mounted.cleanup();
    }
  });

  it("does not steal Shift+Tab for plan mode while the composer editor is focused", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-target-hotkey" as MessageId,
        targetText: "hotkey target",
      }),
    });

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_REF, "hotkey target\nkeeps controls open");
      await waitForLayout();

      const initialModeButton = await waitForInteractionModeButton("Build");
      expect(initialModeButton.title).toContain("enter plan mode");

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await waitForLayout();

      expect((await waitForInteractionModeButton("Build")).title).toContain("enter plan mode");

      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      await waitForLayout();
      expect((await waitForInteractionModeButton("Build")).title).toContain("enter plan mode");
    } finally {
      await mounted.cleanup();
    }
  });

  it("uses the active draft route session when changing the base branch", async () => {
    const staleDraftId = draftIdFromPath("/draft/draft-stale-branch-session");
    const activeDraftId = draftIdFromPath("/draft/draft-active-branch-session");

    useComposerDraftStore.setState({
      draftThreadsByThreadKey: {
        [staleDraftId]: {
          threadId: THREAD_ID,
          environmentId: LOCAL_ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          logicalProjectKey: `${PROJECT_DRAFT_KEY}:stale`,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "main",
          worktreePath: null,
          envMode: "worktree",
        },
        [activeDraftId]: {
          threadId: THREAD_ID,
          environmentId: LOCAL_ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          logicalProjectKey: PROJECT_DRAFT_KEY,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "main",
          worktreePath: null,
          envMode: "worktree",
        },
      },
      logicalProjectDraftThreadKeyByLogicalProjectKey: {
        [`${PROJECT_DRAFT_KEY}:stale`]: staleDraftId,
        [PROJECT_DRAFT_KEY]: activeDraftId,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      initialPath: `/draft/${activeDraftId}`,
      resolveRpc: (body) => {
        if (body._tag === WS_METHODS.gitListBranches) {
          return {
            isRepo: true,
            hasOriginRemote: true,
            nextCursor: null,
            totalCount: 2,
            branches: [
              {
                name: "main",
                current: true,
                isDefault: true,
                worktreePath: null,
              },
              {
                name: "release/next",
                current: false,
                isDefault: false,
                worktreePath: null,
              },
            ],
          };
        }
        return undefined;
      },
    });

    try {
      const branchButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "From main",
          ) as HTMLButtonElement | null,
        'Unable to find branch selector button with "From main".',
      );
      branchButton.click();

      const branchOption = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("span")).find(
            (element) => element.textContent?.trim() === "release/next",
          ) as HTMLSpanElement | null,
        'Unable to find the "release/next" branch option.',
      );
      branchOption.click();

      await vi.waitFor(
        () => {
          expect(useComposerDraftStore.getState().getDraftSession(activeDraftId)?.branch).toBe(
            "release/next",
          );
          expect(useComposerDraftStore.getState().getDraftSession(staleDraftId)?.branch).toBe(
            "main",
          );
        },
        { timeout: 8_000, interval: 16 },
      );

      await vi.waitFor(
        () => {
          const updatedButton = Array.from(document.querySelectorAll("button")).find((button) =>
            button.textContent?.trim().includes("From release/next"),
          );
          expect(updatedButton).toBeTruthy();
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the new worktree branch picker anchored at the top when opening with a preselected branch", async () => {
    const draftId = DraftId.make("draft-branch-picker-scroll-regression");
    const branches = [
      {
        name: "feature/current",
        current: true,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "main",
        current: false,
        isDefault: true,
        worktreePath: null,
      },
      ...Array.from({ length: 48 }, (_, index) => ({
        name: `feature/${String(index).padStart(2, "0")}`,
        current: false,
        isDefault: false,
        worktreePath: null,
      })),
      {
        name: "feature/selected",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];

    useComposerDraftStore.setState({
      draftThreadsByThreadKey: {
        [draftId]: {
          threadId: THREAD_ID,
          environmentId: LOCAL_ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          logicalProjectKey: PROJECT_DRAFT_KEY,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "feature/selected",
          worktreePath: null,
          envMode: "worktree",
        },
      },
      logicalProjectDraftThreadKeyByLogicalProjectKey: {
        [PROJECT_DRAFT_KEY]: draftId,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      initialPath: `/draft/${draftId}`,
      resolveRpc: (body) => {
        if (body._tag === WS_METHODS.gitListBranches) {
          return {
            isRepo: true,
            hasOriginRemote: true,
            nextCursor: null,
            totalCount: branches.length,
            branches,
          };
        }
        return undefined;
      },
    });

    try {
      const branchButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "From feature/selected",
          ) as HTMLButtonElement | null,
        'Unable to find branch selector button with "From feature/selected".',
      );
      branchButton.click();

      await waitForElement(
        () => document.querySelector<HTMLInputElement>('input[placeholder="Search branches..."]'),
        "Unable to find branch search input.",
      );

      const popup = await waitForElement(
        () => document.querySelector<HTMLElement>('[data-slot="combobox-popup"]'),
        "Unable to find the branch picker popup.",
      );

      await vi.waitFor(
        () => {
          const popupSpans = Array.from(popup.querySelectorAll("span"));
          expect(
            popupSpans.some((element) => element.textContent?.trim() === "feature/current"),
          ).toBe(true);
          expect(popupSpans.some((element) => element.textContent?.trim() === "main")).toBe(true);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("surrounds selected plain text and preserves the inner selection for repeated wrapping", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-surround-basic" as MessageId,
        targetText: "surround basic",
      }),
    });

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_REF, "selected");
      await waitForComposerText("selected");
      await setComposerSelectionByTextOffsets({ start: 0, end: "selected".length });
      await pressComposerKey("(");
      await waitForComposerText("(selected)");

      await pressComposerKey("[");
      await waitForComposerText("([selected])");
    } finally {
      await mounted.cleanup();
    }
  });

  it("leaves collapsed-caret typing unchanged for surround symbols", async () => {
    useComposerDraftStore.getState().setPrompt(THREAD_REF, "selected");

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-surround-collapsed" as MessageId,
        targetText: "surround collapsed",
      }),
    });

    try {
      await waitForComposerText("selected");
      await setComposerSelectionByTextOffsets({
        start: "selected".length,
        end: "selected".length,
      });
      await pressComposerKey("(");
      await waitForComposerText("selected(");
    } finally {
      await mounted.cleanup();
    }
  });

  it("supports symmetric and backward-selection surrounds", async () => {
    useComposerDraftStore.getState().setPrompt(THREAD_REF, "backward");

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-surround-backward" as MessageId,
        targetText: "surround backward",
      }),
    });

    try {
      await waitForComposerText("backward");
      await setComposerSelectionByTextOffsets({
        start: 0,
        end: "backward".length,
        direction: "backward",
      });
      await pressComposerKey("*");
      await waitForComposerText("*backward*");
    } finally {
      await mounted.cleanup();
    }
  });

  it("supports option-produced surround symbols like guillemets", async () => {
    useComposerDraftStore.getState().setPrompt(THREAD_REF, "quoted");

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-surround-guillemet" as MessageId,
        targetText: "surround guillemet",
      }),
    });

    try {
      await waitForComposerText("quoted");
      await setComposerSelectionByTextOffsets({ start: 0, end: "quoted".length });
      await pressComposerKey("«");
      await waitForComposerText("«quoted»");
    } finally {
      await mounted.cleanup();
    }
  });

  it("supports dead-key composition that resolves to another surround symbol without an extra undo step", async () => {
    useComposerDraftStore.getState().setPrompt(THREAD_REF, "quoted");

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-surround-dead-quote" as MessageId,
        targetText: "surround dead quote",
      }),
    });

    try {
      await waitForComposerText("quoted");
      await setComposerSelectionByTextOffsets({ start: 0, end: "quoted".length });
      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Dead",
          bubbles: true,
          cancelable: true,
        }),
      );
      composerEditor.dispatchEvent(
        new InputEvent("beforeinput", {
          data: "'",
          inputType: "insertCompositionText",
          bubbles: true,
          cancelable: true,
        }),
      );
      const resolvedInputEvent = new InputEvent("beforeinput", {
        data: "'",
        inputType: "insertText",
        bubbles: true,
        cancelable: true,
      });
      composerEditor.dispatchEvent(resolvedInputEvent);
      expect(resolvedInputEvent.defaultPrevented).toBe(true);
      await waitForComposerText("'quoted'");
      await pressComposerUndo();
      await waitForComposerText("quoted");
    } finally {
      await mounted.cleanup();
    }
  });

  it("surrounds text after a mention using the correct expanded offsets", async () => {
    useComposerDraftStore.getState().setPrompt(THREAD_REF, "hi @package.json there");

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-surround-after-mention" as MessageId,
        targetText: "surround after mention",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("package.json");
        },
        { timeout: 8_000, interval: 16 },
      );
      await waitForComposerText("hi @package.json there", {
        renderedText: "hi package.json there",
      });
      await setComposerSelectionByTextOffsets({
        start: "hi package.json ".length,
        end: "hi package.json there".length,
      });
      await pressComposerKey("(");
      await waitForComposerText("hi @package.json (there)", {
        renderedText: "hi package.json (there)",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("falls back to normal replacement when the selection includes a mention token", async () => {
    useComposerDraftStore.getState().setPrompt(THREAD_REF, "hi @package.json there ");

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-surround-token" as MessageId,
        targetText: "surround token",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("package.json");
        },
        { timeout: 8_000, interval: 16 },
      );
      await selectAllComposerContent();
      await pressComposerKey("(");
      await waitForComposerText("(");
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows runtime mode descriptions in the desktop composer access select", async () => {
    setDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: WIDE_FOOTER_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
    });

    try {
      const runtimeModeSelect = await waitForButtonByText("Full access");
      runtimeModeSelect.click();

      expect((await waitForSelectItemContainingText("Supervised")).textContent).toContain(
        "Ask before commands and file changes",
      );

      const autoAcceptItem = await waitForSelectItemContainingText("Auto-accept edits");
      expect(autoAcceptItem.textContent).toContain("Auto-accept edits");
      expect((await waitForSelectItemContainingText("Full access")).textContent).toContain(
        "Allow commands and edits without prompts",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows a pointer cursor for the running stop button", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-stop-button-cursor" as MessageId,
        targetText: "stop button cursor target",
        sessionStatus: "running",
      }),
    });

    try {
      const stopButton = await waitForElement(
        () => document.querySelector<HTMLButtonElement>('button[aria-label="Stop generation"]'),
        "Unable to find stop generation button.",
      );

      expect(getComputedStyle(stopButton).cursor).toBe("pointer");
    } finally {
      await mounted.cleanup();
    }
  });

  it("archives a thread from the sidebar row context menu", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-archive-context-menu-test" as MessageId,
        targetText: "archive context menu target",
      }),
    });

    try {
      await openSidebarThreadContextMenu();
      const archiveItem = await waitForElement(
        () =>
          Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
            (item) => item.textContent?.trim() === "Archive",
          ) ?? null,
        "Unable to find Archive context menu item.",
      );
      archiveItem.click();

      await vi.waitFor(
        () => {
          expect(
            wsRequests.some(
              (request) =>
                request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
                request.type === "thread.archive" &&
                request.threadId === THREAD_ID,
            ),
          ).toBe(true);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("exposes the full thread title on the sidebar row", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-thread-tooltip-target" as MessageId,
        targetText: "thread tooltip target",
      }),
    });

    try {
      const threadTitle = await waitForElement(
        () => findSidebarThreadTitle(),
        "Unable to find sidebar thread title.",
      );

      expect(threadTitle.getAttribute("title")).toBe(THREAD_TITLE);
    } finally {
      await mounted.cleanup();
    }
  });

  it("canonicalizes promoted draft threads to the server thread route", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-new-thread-test" as MessageId,
        targetText: "new thread selection test",
      }),
    });

    try {
      // Wait for the sidebar to render with the project.
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      // The route should change to a new draft thread ID.
      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newDraftId = draftIdFromPath(newThreadPath);
      const newThreadId = draftThreadIdFor(newDraftId);

      // The composer editor should be present for the new draft thread.
      await waitForComposerEditor();

      // `thread.created` should only mark the draft as promoting; it should
      // not navigate away until the server thread has actual runtime state.
      await materializePromotedDraftThreadViaDomainEvent(newThreadId);
      expect(mounted.router.state.location.pathname).toBe(newThreadPath);
      await expect.element(page.getByTestId("composer-editor")).toBeInTheDocument();

      // Once the server thread starts, the route should canonicalize.
      await startPromotedServerThreadViaDomainEvent(newThreadId);
      await vi.waitFor(
        () => {
          expect(useComposerDraftStore.getState().draftThreadsByThreadKey[newDraftId]).toBe(
            undefined,
          );
        },
        { timeout: 8_000, interval: 16 },
      );

      // The route should switch to the canonical server thread path.
      await waitForURL(
        mounted.router,
        (path) => path === serverThreadPath(newThreadId),
        "Promoted drafts should canonicalize to the server thread route.",
      );

      // The composer should remain usable after canonicalization, regardless of
      // whether the promoted thread is still visibly empty or has already
      // entered the running state.
      await expect.element(page.getByTestId("composer-editor")).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("canonicalizes stale promoted draft routes to the server thread route", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-draft-hydration-race-test" as MessageId,
        targetText: "draft hydration race test",
      }),
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newDraftId = draftIdFromPath(newThreadPath);
      const newThreadId = draftThreadIdFor(newDraftId);

      await promoteDraftThreadViaDomainEvent(newThreadId);

      await mounted.router.navigate({
        to: "/draft/$draftId",
        params: { draftId: newDraftId },
      });

      await waitForURL(
        mounted.router,
        (path) => path === serverThreadPath(newThreadId),
        "Stale promoted draft routes should canonicalize to the server thread path.",
      );

      await expect.element(page.getByTestId("composer-editor")).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("creates a fresh worktree draft from an existing worktree thread when the default mode is worktree", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: {
        ...createSnapshotForTargetUser({
          targetMessageId: "msg-user-new-thread-worktree-default-test" as MessageId,
          targetText: "new thread worktree default test",
        }),
        threads: createSnapshotForTargetUser({
          targetMessageId: "msg-user-new-thread-worktree-default-test" as MessageId,
          targetText: "new thread worktree default test",
        }).threads.map((thread) =>
          thread.id === THREAD_ID
            ? Object.assign({}, thread, {
                branch: "feature/existing",
                worktreePath: "/repo/.multi/worktrees/existing",
              })
            : thread,
        ),
      },
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          settings: {
            ...nextFixture.serverConfig.settings,
            defaultThreadEnvMode: "worktree",
          },
        };
      },
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should change to a new draft thread.",
      );
      const newDraftId = draftIdFromPath(newThreadPath);

      expect(useComposerDraftStore.getState().getDraftSession(newDraftId)).toMatchObject({
        envMode: "worktree",
        worktreePath: "/repo/.multi/worktrees/existing",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("creates a new draft instead of reusing a promoting draft thread", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-promoting-draft-new-thread-test" as MessageId,
        targetText: "promoting draft new thread test",
      }),
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      const firstDraftPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should change to the first draft thread.",
      );
      const firstDraftId = draftIdFromPath(firstDraftPath);
      const firstThreadId = draftThreadIdFor(firstDraftId);

      await materializePromotedDraftThreadViaDomainEvent(firstThreadId);
      expect(mounted.router.state.location.pathname).toBe(firstDraftPath);

      await newThreadButton.click();

      const secondDraftPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path) && path !== firstDraftPath,
        "Route should change to a second draft thread instead of reusing the promoting draft.",
      );
      expect(draftIdFromPath(secondDraftPath)).not.toBe(firstDraftId);
    } finally {
      await mounted.cleanup();
    }
  });

  it("snapshots sticky codex settings into a new draft thread", async () => {
    useComposerDraftStore.setState({
      stickyModelSelectionByProvider: {
        [ProviderInstanceId.make("codex")]: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.3-codex",
          options: [
            { id: "reasoningEffort", value: "medium" },
            { id: "fastMode", value: true },
          ],
        },
      },
      stickyActiveProvider: ProviderInstanceId.make("codex"),
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-sticky-codex-traits-test" as MessageId,
        targetText: "sticky codex traits test",
      }),
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newDraftId = draftIdFromPath(newThreadPath);

      expect(composerDraftFor(newDraftId)).toMatchObject({
        modelSelectionByProvider: {
          [ProviderInstanceId.make("codex")]: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.3-codex",
            options: [
              { id: "reasoningEffort", value: "medium" },
              { id: "fastMode", value: true },
            ],
          },
        },
        activeProvider: ProviderInstanceId.make("codex"),
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("hydrates the provider alongside a sticky claude model", async () => {
    useComposerDraftStore.setState({
      stickyModelSelectionByProvider: {
        [ProviderInstanceId.make("claudeAgent")]: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
          options: [
            { id: "effort", value: "max" },
            { id: "fastMode", value: true },
          ],
        },
      },
      stickyActiveProvider: ProviderInstanceId.make("claudeAgent"),
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-sticky-claude-model-test" as MessageId,
        targetText: "sticky claude model test",
      }),
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new sticky claude draft thread UUID.",
      );
      const newDraftId = draftIdFromPath(newThreadPath);

      expect(composerDraftFor(newDraftId)).toMatchObject({
        modelSelectionByProvider: {
          [ProviderInstanceId.make("claudeAgent")]: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: "claude-opus-4-6",
            options: [
              { id: "effort", value: "max" },
              { id: "fastMode", value: true },
            ],
          },
        },
        activeProvider: ProviderInstanceId.make("claudeAgent"),
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("falls back to defaults when no sticky composer settings exist", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-default-codex-traits-test" as MessageId,
        targetText: "default codex traits test",
      }),
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newDraftId = draftIdFromPath(newThreadPath);

      expect(composerDraftFor(newDraftId)).toBeUndefined();
      expect(useComposerDraftStore.getState().getDraftSession(newDraftId)).toMatchObject({
        interactionMode: DEFAULT_INTERACTION_MODE,
        runtimeMode: DEFAULT_RUNTIME_MODE,
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("prefers draft state over sticky composer settings and defaults", async () => {
    useComposerDraftStore.setState({
      stickyModelSelectionByProvider: {
        [ProviderInstanceId.make("codex")]: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.3-codex",
          options: [
            { id: "reasoningEffort", value: "medium" },
            { id: "fastMode", value: true },
          ],
        },
      },
      stickyActiveProvider: ProviderInstanceId.make("codex"),
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-draft-codex-traits-precedence-test" as MessageId,
        targetText: "draft codex traits precedence test",
      }),
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      const threadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a sticky draft thread UUID.",
      );
      const draftId = draftIdFromPath(threadPath);

      expect(composerDraftFor(draftId)).toMatchObject({
        modelSelectionByProvider: {
          [ProviderInstanceId.make("codex")]: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.3-codex",
            options: [
              { id: "reasoningEffort", value: "medium" },
              { id: "fastMode", value: true },
            ],
          },
        },
        activeProvider: ProviderInstanceId.make("codex"),
      });

      useComposerDraftStore.getState().setModelSelection(draftId, {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
        options: [
          { id: "reasoningEffort", value: "low" },
          { id: "fastMode", value: true },
        ],
      });

      await newThreadButton.click();

      await waitForURL(
        mounted.router,
        (path) => path === threadPath,
        "New-thread should reuse the existing project draft thread.",
      );
      expect(composerDraftFor(draftId)).toMatchObject({
        modelSelectionByProvider: {
          [ProviderInstanceId.make("codex")]: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.4",
            options: [
              { id: "reasoningEffort", value: "low" },
              { id: "fastMode", value: true },
            ],
          },
        },
        activeProvider: ProviderInstanceId.make("codex"),
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("creates a new thread from the global chat.new shortcut", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-chat-shortcut-test" as MessageId,
        targetText: "chat shortcut test",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "chat.new",
              shortcut: {
                key: "o",
                metaKey: false,
                ctrlKey: false,
                shiftKey: true,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      await waitForLayout();
      await triggerChatNewShortcutUntilPath(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID from the shortcut.",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not consume chat.new when there is no project context", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createProjectlessSnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "chat.new",
              shortcut: {
                key: "o",
                metaKey: false,
                ctrlKey: false,
                shiftKey: true,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      const initialPath = mounted.router.state.location.pathname;
      const initialDraftKeys = Object.keys(
        useComposerDraftStore.getState().draftThreadsByThreadKey,
      );
      expect(initialPath).toMatch(UUID_ROUTE_RE);
      expect(initialDraftKeys).toHaveLength(1);

      dispatchChatNewShortcut();
      await waitForLayout();

      expect(mounted.router.state.location.pathname).toBe(initialPath);
      expect(Object.keys(useComposerDraftStore.getState().draftThreadsByThreadKey)).toEqual(
        initialDraftKeys,
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders the configurable shortcut and runs a command from the sidebar trigger", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-command-palette-shortcut-test" as MessageId,
        targetText: "command palette shortcut test",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "commandPalette.toggle",
              shortcut: {
                key: "k",
                metaKey: false,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      await waitForCommandPaletteShortcutLabel();
      const palette = page.getByTestId("command-palette");
      await openCommandPaletteFromTrigger();

      await expect.element(palette).toBeInTheDocument();
      await expect
        .element(palette.getByText("New thread in Project", { exact: true }))
        .toBeInTheDocument();
      await palette.getByText("New thread in Project", { exact: true }).click();

      await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID from the command palette.",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("filters command palette results as the user types", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-command-palette-search-test" as MessageId,
        targetText: "command palette search test",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "commandPalette.toggle",
              shortcut: {
                key: "k",
                metaKey: false,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      await waitForCommandPaletteShortcutLabel();
      const palette = page.getByTestId("command-palette");
      await openCommandPaletteFromTrigger();

      await expect.element(palette).toBeInTheDocument();
      await page.getByPlaceholder("Search commands, projects, and threads...").fill("settings");
      await expect.element(palette.getByText("Open settings", { exact: true })).toBeInTheDocument();
      await expect
        .element(palette.getByText("New thread in Project", { exact: true }))
        .not.toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("adds a project from the command palette with the native folder picker", async () => {
    const pickFolder = vi.fn().mockResolvedValue("/Users/julius/Projects/finder-picked");
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-command-palette-add-project-picker" as MessageId,
        targetText: "command palette add project picker",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "commandPalette.toggle",
              shortcut: {
                key: "k",
                metaKey: false,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
      resolveRpc: (body) => {
        if (body._tag === ORCHESTRATION_WS_METHODS.dispatchCommand) {
          return {
            sequence: fixture.snapshot.snapshotSequence + 1,
          };
        }

        return undefined;
      },
    });

    try {
      await waitForServerConfigToApply();
      await waitForCommandPaletteShortcutLabel();
      window.desktopBridge = {
        pickFolder,
        setTheme: vi.fn().mockResolvedValue(undefined),
      } as unknown as NonNullable<typeof window.desktopBridge>;
      const palette = page.getByTestId("command-palette");
      await openCommandPaletteFromTrigger();

      await expect.element(palette).toBeInTheDocument();
      await palette.getByText("Add project", { exact: true }).click();

      await vi.waitFor(
        () => {
          expect(pickFolder).toHaveBeenCalledWith({ initialPath: "~/" });
        },
        { timeout: 8_000, interval: 16 },
      );

      await vi.waitFor(
        () => {
          const dispatchRequest = wsRequests.find(
            (request) =>
              request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              request.type === "project.create",
          ) as
            | {
                _tag: string;
                type?: string;
                projectRoot?: string;
                title?: string;
              }
            | undefined;

          expect(dispatchRequest).toMatchObject({
            _tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
            type: "project.create",
            projectRoot: "/Users/julius/Projects/finder-picked",
            title: "finder-picked",
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread after adding a project from the command palette.",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("adds a project from the sidebar add button with the native folder picker", async () => {
    const pickFolder = vi.fn().mockResolvedValue("/Users/julius/Projects/sidebar-picked");
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-sidebar-add-project-trigger" as MessageId,
        targetText: "sidebar add project trigger",
      }),
      resolveRpc: (body) => {
        if (body._tag === ORCHESTRATION_WS_METHODS.dispatchCommand) {
          return {
            sequence: fixture.snapshot.snapshotSequence + 1,
          };
        }

        return undefined;
      },
    });

    try {
      await waitForServerConfigToApply();
      window.desktopBridge = {
        pickFolder,
        setTheme: vi.fn().mockResolvedValue(undefined),
      } as unknown as NonNullable<typeof window.desktopBridge>;

      await page.getByTestId("sidebar-add-project-trigger").click();

      await vi.waitFor(
        () => {
          expect(pickFolder).toHaveBeenCalledWith({ initialPath: "~/" });
        },
        { timeout: 8_000, interval: 16 },
      );

      await vi.waitFor(
        () => {
          const dispatchRequest = wsRequests.find(
            (request) =>
              request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              request.type === "project.create",
          ) as
            | {
                _tag: string;
                type?: string;
                projectRoot?: string;
                title?: string;
              }
            | undefined;

          expect(dispatchRequest).toMatchObject({
            _tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
            type: "project.create",
            projectRoot: "/Users/julius/Projects/sidebar-picked",
            title: "sidebar-picked",
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread after adding a project from the sidebar.",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("starts the native folder picker from the configured base directory", async () => {
    const pickFolder = vi.fn().mockResolvedValue("/Users/julius/Development/codething");
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-sidebar-add-project-custom-base-dir" as MessageId,
        targetText: "sidebar add project custom base directory",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          settings: {
            ...nextFixture.serverConfig.settings,
            addProjectBaseDirectory: "~/Development",
          },
        };
      },
      resolveRpc: (body) => {
        if (body._tag === ORCHESTRATION_WS_METHODS.dispatchCommand) {
          return {
            sequence: fixture.snapshot.snapshotSequence + 1,
          };
        }

        return undefined;
      },
    });

    try {
      await waitForServerConfigToApply();
      window.desktopBridge = {
        pickFolder,
        setTheme: vi.fn().mockResolvedValue(undefined),
      } as unknown as NonNullable<typeof window.desktopBridge>;

      await page.getByTestId("sidebar-add-project-trigger").click();

      await vi.waitFor(
        () => {
          expect(pickFolder).toHaveBeenCalledWith({ initialPath: "~/Development" });
        },
        { timeout: 8_000, interval: 16 },
      );

      await vi.waitFor(
        () => {
          const dispatchRequest = wsRequests.find(
            (request) =>
              request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              request.type === "project.create",
          ) as
            | {
                _tag: string;
                type?: string;
                projectRoot?: string;
                title?: string;
              }
            | undefined;

          expect(dispatchRequest).toMatchObject({
            _tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
            type: "project.create",
            projectRoot: "/Users/julius/Development/codething",
            title: "codething",
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread after adding a project from the configured base directory.",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not add a project when the native folder picker is canceled", async () => {
    const pickFolder = vi.fn().mockResolvedValue(null);
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-sidebar-add-project-canceled" as MessageId,
        targetText: "sidebar add project canceled",
      }),
    });

    try {
      await waitForServerConfigToApply();
      const initialPath = mounted.router.state.location.pathname;
      window.desktopBridge = {
        pickFolder,
        setTheme: vi.fn().mockResolvedValue(undefined),
      } as unknown as NonNullable<typeof window.desktopBridge>;

      await page.getByTestId("sidebar-add-project-trigger").click();

      await vi.waitFor(
        () => {
          expect(pickFolder).toHaveBeenCalledWith({ initialPath: "~/" });
        },
        { timeout: 8_000, interval: 16 },
      );
      expect(
        wsRequests.some(
          (request) =>
            request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
            request.type === "project.create",
        ),
      ).toBe(false);
      expect(mounted.router.state.location.pathname).toBe(initialPath);
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps project-context thread matches available when searching by project name", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotWithSecondaryProject(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "commandPalette.toggle",
              shortcut: {
                key: "k",
                metaKey: false,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      await waitForCommandPaletteShortcutLabel();
      const palette = page.getByTestId("command-palette");
      await openCommandPaletteFromTrigger();

      await expect.element(palette).toBeInTheDocument();
      await page.getByPlaceholder("Search commands, projects, and threads...").fill("docs");
      await expect.element(palette.getByText("Docs Portal", { exact: true })).toBeInTheDocument();
      await expect
        .element(palette.getByText("Release checklist", { exact: true }))
        .toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("searches projects by path and opens the latest thread for that project", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotWithSecondaryProject(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          settings: {
            ...nextFixture.serverConfig.settings,
            defaultThreadEnvMode: "worktree",
          },
          keybindings: [
            {
              command: "commandPalette.toggle",
              shortcut: {
                key: "k",
                metaKey: false,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      await waitForCommandPaletteShortcutLabel();
      const palette = page.getByTestId("command-palette");
      await openCommandPaletteFromTrigger();

      await expect.element(palette).toBeInTheDocument();
      await page.getByPlaceholder("Search commands, projects, and threads...").fill("clients/docs");
      await expect.element(palette.getByText("Docs Portal", { exact: true })).toBeInTheDocument();
      await expect
        .element(palette.getByText("/repo/clients/docs-portal", { exact: true }))
        .toBeInTheDocument();
      await palette.getByText("Docs Portal", { exact: true }).click();

      const nextPath = await waitForURL(
        mounted.router,
        (path) => path === serverThreadPath("thread-secondary-project" as ThreadId),
        "Route should have changed to the latest thread for the selected project.",
      );
      expect(nextPath).toBe(serverThreadPath("thread-secondary-project" as ThreadId));
      expect(
        useComposerDraftStore
          .getState()
          .getDraftThread(threadRefFor("thread-secondary-project" as ThreadId)),
      ).toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });

  it("creates a new thread from project search when no active project thread exists", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotWithSecondaryProject({ includeSecondaryThread: false }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          settings: {
            ...nextFixture.serverConfig.settings,
            defaultThreadEnvMode: "worktree",
          },
          keybindings: [
            {
              command: "commandPalette.toggle",
              shortcut: {
                key: "k",
                metaKey: false,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      await waitForCommandPaletteShortcutLabel();
      const palette = page.getByTestId("command-palette");
      await openCommandPaletteFromTrigger();

      await expect.element(palette).toBeInTheDocument();
      await page.getByPlaceholder("Search commands, projects, and threads...").fill("clients/docs");
      await expect.element(palette.getByText("Docs Portal", { exact: true })).toBeInTheDocument();
      await expect
        .element(palette.getByText("/repo/clients/docs-portal", { exact: true }))
        .toBeInTheDocument();
      await palette.getByText("Docs Portal", { exact: true }).click();

      const nextPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID from the project search result.",
      );
      const nextDraftId = draftIdFromPath(nextPath);
      const draftThread = useComposerDraftStore.getState().getDraftSession(nextDraftId);
      expect(draftThread?.projectId).toBe(SECOND_PROJECT_ID);
      expect(draftThread?.envMode).toBe("worktree");
    } finally {
      await mounted.cleanup();
    }
  });

  it("filters archived threads out of command palette search results", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotWithSecondaryProject(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "commandPalette.toggle",
              shortcut: {
                key: "k",
                metaKey: false,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      await waitForCommandPaletteShortcutLabel();
      const palette = page.getByTestId("command-palette");
      await openCommandPaletteFromTrigger();

      await expect.element(palette).toBeInTheDocument();
      await page.getByPlaceholder("Search commands, projects, and threads...").fill("docs-archive");
      await expect
        .element(palette.getByText("Archived Docs Notes", { exact: true }))
        .not.toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("creates a fresh draft after the previous draft thread is promoted", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-promoted-draft-shortcut-test" as MessageId,
        targetText: "promoted draft shortcut test",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "chat.new",
              shortcut: {
                key: "o",
                metaKey: false,
                ctrlKey: false,
                shiftKey: true,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();
      await waitForServerConfigToApply();
      await newThreadButton.click();

      const promotedThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a promoted draft thread UUID.",
      );
      const promotedDraftId = draftIdFromPath(promotedThreadPath);
      const promotedThreadId = draftThreadIdFor(promotedDraftId);

      await promoteDraftThreadViaDomainEvent(promotedThreadId);
      await waitForURL(
        mounted.router,
        (path) => path === serverThreadPath(promotedThreadId),
        "Promoted drafts should canonicalize to the server thread route before a fresh draft is created.",
      );
      await vi.waitFor(
        () => {
          expect(useComposerDraftStore.getState().getDraftThread(promotedDraftId)).toBeNull();
        },
        { timeout: 8_000, interval: 16 },
      );
      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      await waitForLayout();

      const freshThreadPath = await triggerChatNewShortcutUntilPath(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path) && path !== promotedThreadPath,
        "Shortcut should create a fresh draft instead of reusing the promoted thread.",
      );
      expect(freshThreadPath).not.toBe(promotedThreadPath);
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders long proposed plans in the native plan workbench", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotWithLongProposedPlan(),
    });

    try {
      await openPlanWorkbenchPanel();
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("deep hidden detail only after expand");
          expect(document.querySelector('button[aria-label="Plan actions"]')).toBeTruthy();
          expect(document.querySelector('button[title="Build plan"]')).toBeTruthy();
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("uses the active worktree path when saving a proposed plan to the project", async () => {
    const snapshot = createSnapshotWithLongProposedPlan();
    const threads = snapshot.threads.slice();
    const targetThreadIndex = threads.findIndex((thread) => thread.id === THREAD_ID);
    const targetThread = targetThreadIndex >= 0 ? threads[targetThreadIndex] : undefined;
    if (targetThread) {
      threads[targetThreadIndex] = {
        ...targetThread,
        worktreePath: "/repo/worktrees/plan-thread",
      };
    }

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: {
        ...snapshot,
        threads,
      },
    });

    try {
      await openPlanWorkbenchPanel();

      const planActionsButton = await waitForElement(
        () => document.querySelector<HTMLButtonElement>('button[aria-label="Plan actions"]'),
        "Unable to find proposed plan actions button.",
      );
      planActionsButton.click();

      const saveToProjectItem = await waitForElement(
        () =>
          (Array.from(document.querySelectorAll('[data-slot="menu-item"]')).find(
            (item) => item.textContent?.trim() === "Save to project",
          ) ?? null) as HTMLElement | null,
        'Unable to find "Save to project" menu item.',
      );
      saveToProjectItem.click();

      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain(
            "Enter a path relative to /repo/worktrees/plan-thread.",
          );
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps pending-question footer actions inside the composer after a real resize", async () => {
    const mounted = await mountChatView({
      viewport: WIDE_FOOTER_VIEWPORT,
      snapshot: createSnapshotWithPendingUserInput(),
    });

    try {
      const firstOption = await waitForButtonContainingText("Tight");
      firstOption.click();

      await waitForElement(
        () => document.querySelector<HTMLButtonElement>('button[aria-label="Previous question"]'),
        "Unable to find previous-question button.",
      );
      await waitForButtonByText("Submit");

      await mounted.setContainerSize(COMPACT_FOOTER_VIEWPORT);
      await expectComposerActionsContained();
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the compact model selector inside the composer after a viewport resize", async () => {
    const mounted = await mountChatView({
      viewport: WIDE_FOOTER_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-compact-model-selector" as MessageId,
        targetText: "compact model selector",
      }),
    });

    try {
      await waitForComposerEditor();
      await mounted.setViewport(COMPACT_FOOTER_VIEWPORT);
      await expectCompactModelPickerContained();
    } finally {
      await mounted.cleanup();
    }
  });

  it("submits pending user input after the final option selection resolves the draft answers", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotWithPendingUserInput(),
      resolveRpc: (body) => {
        if (body._tag === ORCHESTRATION_WS_METHODS.dispatchCommand) {
          return {
            sequence: fixture.snapshot.snapshotSequence + 1,
          };
        }
        return undefined;
      },
    });

    try {
      const firstOption = await waitForButtonContainingText("Tight");
      firstOption.click();

      const finalOption = await waitForButtonContainingText("Conservative");
      finalOption.click();

      await vi.waitFor(
        () => {
          const dispatchRequest = wsRequests.find(
            (request) =>
              request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              request.type === "thread.user-input.respond",
          ) as
            | {
                _tag: string;
                type?: string;
                requestId?: string;
                answers?: Record<string, unknown>;
              }
            | undefined;

          expect(dispatchRequest).toMatchObject({
            _tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
            type: "thread.user-input.respond",
            requestId: "req-browser-user-input",
            answers: {
              scope: "Tight",
              risk: "Conservative",
            },
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the model picker when typing /model in the composer", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-command-menu-target" as MessageId,
        targetText: "command menu thread",
      }),
    });

    try {
      await waitForComposerEditor();
      await page.getByTestId("composer-editor").fill("/model");
      await waitForComposerMenuItem("slash:model");
      await pressComposerKey("Enter");

      await vi.waitFor(
        () => {
          const input = document.querySelector<HTMLInputElement>(
            'input[placeholder="Search models..."]',
          );
          expect(input).not.toBeNull();
          expect(input?.offsetParent).not.toBeNull();
          expect(document.querySelector(`[data-composer-item-id="slash:model"]`)).toBeNull();
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the slash-command menu visible above the composer", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-command-menu-target" as MessageId,
        targetText: "command menu thread",
      }),
    });

    try {
      await waitForComposerEditor();
      const composerEditor = page.getByTestId("composer-editor");
      await composerEditor.fill("/");
      const menuItem = await waitForComposerMenuItem("slash:model");
      const composerForm = await waitForElement(
        () => document.querySelector<HTMLElement>('[data-chat-input-form="true"]'),
        "Unable to find composer form.",
      );
      const assertMenuAligned = () => {
        const menuRoot = document.querySelector<HTMLElement>("[data-composer-command-menu-root]");
        const menuRect = (menuRoot ?? menuItem).getBoundingClientRect();
        const composerRect = composerForm.getBoundingClientRect();
        const anchor = document.querySelector<HTMLElement>("[data-composer-menu-anchor]");
        const anchorRect = anchor?.getBoundingClientRect();
        const hitTarget = document.elementFromPoint(
          menuRect.left + menuRect.width / 2,
          menuRect.top + menuRect.height / 2,
        );
        const viewportPaddingTop = 8;

        expect(menuRoot, "expected portaled composer command menu root").not.toBeNull();
        expect(menuRect.width).toBeGreaterThan(0);
        expect(menuRect.height).toBeGreaterThan(0);
        expect(menuRect.top).toBeGreaterThanOrEqual(viewportPaddingTop);
        expect(menuRect.height).toBeLessThanOrEqual(window.innerHeight - viewportPaddingTop * 2);
        if (anchorRect) {
          expect(anchorRect.width).toBeLessThanOrEqual(2);
          expect(anchorRect.height).toBeLessThanOrEqual(2);
          expect(Math.abs(menuRect.left - anchorRect.left)).toBeLessThanOrEqual(8);
          expect(menuRect.bottom).toBeLessThanOrEqual(anchorRect.top + 1);
        } else {
          expect(menuRect.left).toBeGreaterThanOrEqual(composerRect.left - 2);
          expect(menuRect.bottom).toBeLessThanOrEqual(composerRect.bottom);
        }
        expect(hitTarget instanceof Element && menuRoot?.contains(hitTarget)).toBe(true);
      };

      await vi.waitFor(assertMenuAligned, { timeout: 8_000, interval: 16 });
      await composerEditor.fill("/pl");
      await vi.waitFor(assertMenuAligned, { timeout: 8_000, interval: 16 });
      await composerEditor.fill("ask /");
      await vi.waitFor(assertMenuAligned, { timeout: 8_000, interval: 16 });

      const composerEditorElement = await waitForComposerEditor();
      composerEditorElement.focus();
      composerEditorElement.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await vi.waitFor(
        () => {
          expect(
            document.querySelector("[data-composer-command-menu-root]"),
            "expected slash menu to dismiss after Escape",
          ).toBeNull();
        },
        { timeout: 8_000, interval: 16 },
      );

      await composerEditor.fill("ask again /");
      await waitForComposerMenuItem("slash:model");
      await vi.waitFor(assertMenuAligned, { timeout: 8_000, interval: 16 });
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows a tooltip with the skill description when hovering a skill pill", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-skill-tooltip-target" as MessageId,
        targetText: "skill tooltip thread",
      }),
      configureFixture: (nextFixture) => {
        const provider = nextFixture.serverConfig.providers[0];
        if (!provider) {
          throw new Error("Expected default provider in test fixture.");
        }
        (
          provider as {
            skills: ServerConfig["providers"][number]["skills"];
          }
        ).skills = [
          {
            name: "agent-browser",
            displayName: "Agent Browser",
            description: "Open pages, click around, and inspect web apps.",
            path: "/Users/test/.agents/skills/agent-browser/SKILL.md",
            enabled: true,
          },
        ];
      },
    });

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_REF, "use the $agent-browser ");
      await waitForComposerText("use the $agent-browser ", {
        renderedText: "use the Agent Browser ",
      });

      await waitForElement(
        () => document.querySelector<HTMLElement>('[data-composer-skill-chip="true"]'),
        "Unable to find rendered composer skill chip.",
      );
      await page.getByText("Agent Browser").hover();

      await vi.waitFor(
        () => {
          const tooltip = document.querySelector<HTMLElement>('[data-slot="tooltip-popup"]');
          expect(tooltip).not.toBeNull();
          expect(tooltip?.textContent).toContain("Open pages, click around, and inspect web apps.");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });
});
