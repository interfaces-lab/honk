import {
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
  type MessageId,
  type OrchestrationReadModel,
  type ThreadId,
  type TurnId,
} from "@multi/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { HttpResponse, http, ws } from "msw";
import { setupWorker } from "msw/browser";
import { page } from "vitest/browser";
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useCommandPaletteStore } from "../../../stores/ui/command-palette-store";
import { useComposerDraftStore } from "../../../stores/chat-drafts";
import { useComposerQueueStore } from "../../../stores/chat-send-queue";
import { __resetEnvironmentApiOverridesForTests } from "../../../environment-api";
import { __resetClientSettingsPersistenceForTests } from "../../../hooks/use-settings";
import { isMacPlatform } from "../../../lib/utils";
import { shortcutForCommand, shortcutLabelForCommand } from "../../../keybindings";
import { __resetLocalApiForTests } from "../../../local-api";
import { AppAtomRegistryProvider } from "../../../rpc/atom-registry";
import { getServerConfig } from "../../../rpc/server-state";
import { getRouter } from "../../../router";
import { splitPromptIntoComposerSegments } from "../composer/prompt-segments";
import {
  selectBootstrapCompleteForActiveEnvironment,
  useStore,
} from "../../../stores/thread-store";
import { useTerminalStateStore } from "../../../terminal-state-store";
import { useUiStateStore } from "../../../stores/ui-state-store";
import { createAuthenticatedSessionHandlers } from "../../../../test/authHttpHandlers";
import {
  BrowserWsRpcHarness,
  type NormalizedWsRpcRequestBody,
} from "../../../../test/wsRpcHarness";
import {
  ATTACHMENT_SVG,
  DEFAULT_VIEWPORT,
  LOCAL_ENVIRONMENT_ID,
  NOW_ISO,
  THREAD_ID,
  THREAD_KEY,
  THREAD_REF,
  addThreadToSnapshot,
  buildFixture,
  createSnapshotForTargetUser,
  threadKeyFor,
  toShellSnapshot,
  toShellThread,
  updateThreadSessionInSnapshot,
  type TestFixture,
  type ViewportSpec,
} from "./chat-view.browser.fixtures";
export let fixture: TestFixture;
const rpcHarness = new BrowserWsRpcHarness();
export const wsRequests = rpcHarness.requests;
let customWsRpcResolver: ((body: NormalizedWsRpcRequestBody) => unknown | undefined) | null = null;
const wsLink = ws.link(/ws(s)?:\/\/.*/);
const SURROUND_KEY_PAIRS = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["<", ">"],
  ['"', '"'],
  ["“", "”"],
  ["«", "»"],
  ["'", "'"],
  ["`", "`"],
  ["*", "*"],
  ["_", "_"],
]);
let pendingComposerSelectionOffsets: {
  start: number;
  end: number;
  direction?: "forward" | "backward";
  canSurround?: boolean;
} | null = null;
interface MountedChatView {
  [Symbol.asyncDispose]: () => Promise<void>;
  cleanup: () => Promise<void>;
  setViewport: (viewport: ViewportSpec) => Promise<void>;
  setContainerSize: (viewport: Pick<ViewportSpec, "width" | "height">) => Promise<void>;
  router: ReturnType<typeof getRouter>;
}
function sendShellThreadUpsert(
  threadId: ThreadId,
  options?: {
    readonly session?: OrchestrationReadModel["threads"][number]["session"];
  },
): void {
  const thread = fixture.snapshot.threads.find((entry) => entry.id === threadId);
  if (!thread) {
    throw new Error(`Expected thread ${threadId} in snapshot.`);
  }
  const shellThread =
    options?.session !== undefined
      ? toShellThread({ ...thread, session: options.session })
      : toShellThread(thread);
  rpcHarness.emitStreamValue(ORCHESTRATION_WS_METHODS.subscribeShell, {
    kind: "thread-upserted",
    sequence: fixture.snapshot.snapshotSequence,
    thread: shellThread,
  });
}
async function waitForWsClient(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        wsRequests.some((request) => request._tag === ORCHESTRATION_WS_METHODS.subscribeShell),
      ).toBe(true);
      expect(
        wsRequests.some((request) => request._tag === WS_METHODS.subscribeServerLifecycle),
      ).toBe(true);
      expect(wsRequests.some((request) => request._tag === WS_METHODS.subscribeServerConfig)).toBe(
        true,
      );
    },
    { timeout: 8_000, interval: 16 },
  );
}
async function waitForAppBootstrap(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(getServerConfig()).not.toBeNull();
      expect(selectBootstrapCompleteForActiveEnvironment(useStore.getState())).toBe(true);
    },
    { timeout: 8_000, interval: 16 },
  );
}
export async function materializePromotedDraftThreadViaDomainEvent(
  threadId: ThreadId,
): Promise<void> {
  await waitForWsClient();
  fixture.snapshot = addThreadToSnapshot(fixture.snapshot, threadId);
  fixture.snapshot = updateThreadSessionInSnapshot(fixture.snapshot, threadId, null);
  sendShellThreadUpsert(threadId, { session: null });
}
export async function startPromotedServerThreadViaDomainEvent(threadId: ThreadId): Promise<void> {
  fixture.snapshot = updateThreadSessionInSnapshot(fixture.snapshot, threadId, {
    threadId,
    status: "running",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: `turn-${threadId}` as TurnId,
    lastError: null,
    updatedAt: NOW_ISO,
  });
  sendShellThreadUpsert(threadId);
}
export async function promoteDraftThreadViaDomainEvent(threadId: ThreadId): Promise<void> {
  await materializePromotedDraftThreadViaDomainEvent(threadId);
  await startPromotedServerThreadViaDomainEvent(threadId);
  await vi.waitFor(
    () => {
      expect(useComposerDraftStore.getState().draftThreadsByThreadKey[threadKeyFor(threadId)]).toBe(
        undefined,
      );
    },
    { timeout: 8_000, interval: 16 },
  );
}
function resolveWsRpc(body: NormalizedWsRpcRequestBody): unknown {
  const customResult = customWsRpcResolver?.(body);
  if (customResult !== undefined) {
    return customResult;
  }
  const tag = body._tag;
  if (tag === WS_METHODS.serverGetConfig) {
    return fixture.serverConfig;
  }
  if (tag === ORCHESTRATION_WS_METHODS.dispatchCommand) {
    return {
      sequence: fixture.snapshot.snapshotSequence + 1,
    };
  }
  if (tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      nextCursor: null,
      totalCount: 1,
      branches: [
        {
          name: "main",
          current: true,
          isDefault: true,
          worktreePath: null,
        },
      ],
    };
  }
  if (tag === WS_METHODS.projectsSearchEntries) {
    return {
      entries: [],
      truncated: false,
    };
  }
  if (tag === WS_METHODS.shellOpenInEditor) {
    return null;
  }
  if (tag === WS_METHODS.terminalOpen) {
    return {
      threadId: typeof body.threadId === "string" ? body.threadId : THREAD_ID,
      terminalId: typeof body.terminalId === "string" ? body.terminalId : "default",
      cwd: typeof body.cwd === "string" ? body.cwd : "/repo/project",
      worktreePath:
        typeof body.worktreePath === "string"
          ? body.worktreePath
          : body.worktreePath === null
            ? null
            : null,
      status: "running",
      pid: 123,
      history: "",
      exitCode: null,
      exitSignal: null,
      updatedAt: NOW_ISO,
    };
  }
  return {};
}
const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    void rpcHarness.connect(client);
    client.addEventListener("message", (event) => {
      const rawData = event.data;
      if (typeof rawData !== "string") return;
      void rpcHarness.onMessage(rawData);
    });
  }),
  ...createAuthenticatedSessionHandlers(() => fixture.serverConfig.auth),
  http.get("*/attachments/:attachmentId", () =>
    HttpResponse.text(ATTACHMENT_SVG, {
      headers: {
        "Content-Type": "image/svg+xml",
      },
    }),
  ),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);
async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
export async function waitForLayout(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await nextFrame();
}
export async function setViewport(viewport: ViewportSpec): Promise<void> {
  await page.viewport(viewport.width, viewport.height);
  await waitForLayout();
}
export async function waitForProductionStyles(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
      ).not.toBe("");
      expect(getComputedStyle(document.body).marginTop).toBe("0px");
    },
    {
      timeout: 4_000,
      interval: 16,
    },
  );
}
export async function waitForElement<T extends Element>(
  query: () => T | null,
  errorMessage: string,
): Promise<T> {
  let element: T | null = null;
  await vi.waitFor(
    () => {
      element = query();
      expect(element, errorMessage).toBeTruthy();
    },
    {
      timeout: 8_000,
      interval: 16,
    },
  );
  if (!element) {
    throw new Error(errorMessage);
  }
  return element;
}
export function assertComposerSlashMenuTracksCaret(options?: { maxGapPx?: number }): void {
  const menuRoot = document.querySelector<HTMLElement>("[data-composer-command-menu-root]");
  const anchor = document.querySelector<HTMLElement>("[data-composer-menu-anchor]");
  const form = anchor?.closest<HTMLElement>('[data-chat-input-form="true"]') ?? null;
  const surface = anchor?.closest<HTMLElement>("[data-multi-composer-surface]") ?? null;

  expect(menuRoot, "expected slash menu root").not.toBeNull();
  expect(anchor, "expected live composer caret anchor").not.toBeNull();
  expect(form, "expected composer form").not.toBeNull();
  expect(surface, "expected composer surface around caret anchor").not.toBeNull();
  if (!menuRoot || !anchor || !form || !surface) {
    return;
  }

  const menuRect = menuRoot.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const formRect = form.getBoundingClientRect();
  const surfaceRect = surface.getBoundingClientRect();
  const maxGapPx = options?.maxGapPx ?? 12;
  const hitTarget = document.elementFromPoint(
    menuRect.left + menuRect.width / 2,
    menuRect.top + menuRect.height / 2,
  );

  expect(anchorRect.width).toBeLessThanOrEqual(2);
  expect(anchorRect.height).toBeLessThanOrEqual(2);
  expect(anchorRect.top).toBeGreaterThanOrEqual(formRect.top - 1);
  expect(anchorRect.top).toBeLessThanOrEqual(formRect.bottom + 1);
  expect(anchorRect.left).toBeGreaterThanOrEqual(surfaceRect.left - 1);
  expect(anchorRect.left).toBeLessThanOrEqual(surfaceRect.right + 1);
  expect(menuRect.width).toBeGreaterThan(0);
  expect(menuRect.height).toBeGreaterThan(0);
  expect(menuRect.top).toBeGreaterThanOrEqual(8);
  expect(menuRect.height).toBeLessThanOrEqual(window.innerHeight - 16);
  expect(menuRect.bottom).toBeLessThanOrEqual(anchorRect.top + 1);
  expect(anchorRect.top - menuRect.bottom).toBeLessThanOrEqual(maxGapPx);
  expect(Math.abs(menuRect.left - anchorRect.left)).toBeLessThanOrEqual(8);
  expect(hitTarget instanceof Element && menuRoot.contains(hitTarget)).toBe(true);
}
export async function waitForURL(
  router: ReturnType<typeof getRouter>,
  predicate: (pathname: string) => boolean,
  errorMessage: string,
): Promise<string> {
  let pathname = "";
  await vi.waitFor(
    () => {
      pathname = router.state.location.pathname;
      expect(predicate(pathname), errorMessage).toBe(true);
    },
    { timeout: 8_000, interval: 16 },
  );
  return pathname;
}
export async function waitForComposerEditor(): Promise<HTMLElement> {
  return waitForElement(
    () => document.querySelector<HTMLElement>('[contenteditable="true"]'),
    "Unable to find composer editor.",
  );
}
export async function pressComposerKey(key: string): Promise<void> {
  const composerEditor = await waitForComposerEditor();
  if (document.activeElement !== composerEditor) {
    composerEditor.focus();
  }
  const keydownEvent = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  composerEditor.dispatchEvent(keydownEvent);
  if (keydownEvent.defaultPrevented) {
    pendingComposerSelectionOffsets = null;
    await waitForLayout();
    return;
  }
  const beforeInputEvent = new InputEvent("beforeinput", {
    data: key,
    inputType: "insertText",
    bubbles: true,
    cancelable: true,
  });
  composerEditor.dispatchEvent(beforeInputEvent);
  if (beforeInputEvent.defaultPrevented) {
    pendingComposerSelectionOffsets = null;
    await waitForLayout();
    return;
  }
  const surroundClose = SURROUND_KEY_PAIRS.get(key);
  const pendingSelection = pendingComposerSelectionOffsets;
  if (
    surroundClose &&
    pendingSelection &&
    pendingSelection.start !== pendingSelection.end &&
    pendingSelection.canSurround !== false
  ) {
    const start = Math.min(pendingSelection.start, pendingSelection.end);
    const end = Math.max(pendingSelection.start, pendingSelection.end);
    const currentPrompt =
      useComposerDraftStore.getState().draftsByThreadKey[THREAD_KEY]?.prompt ?? "";
    const nextPrompt =
      currentPrompt.slice(0, start) +
      key +
      currentPrompt.slice(start, end) +
      surroundClose +
      currentPrompt.slice(end);
    pendingComposerSelectionOffsets = null;
    useComposerDraftStore.getState().setPrompt(THREAD_REF, nextPrompt);
    await waitForComposerText(nextPrompt);
    const nextSelection: {
      start: number;
      end: number;
      direction?: "forward" | "backward";
    } = {
      start: start + key.length,
      end: end + key.length,
    };
    if (pendingSelection.direction) {
      nextSelection.direction = pendingSelection.direction;
    }
    await setComposerSelectionByTextOffsets(nextSelection);
    return;
  }
  if (pendingSelection && pendingSelection.start !== pendingSelection.end) {
    const start = Math.min(pendingSelection.start, pendingSelection.end);
    const end = Math.max(pendingSelection.start, pendingSelection.end);
    const currentPrompt =
      useComposerDraftStore.getState().draftsByThreadKey[THREAD_KEY]?.prompt ?? "";
    const nextPrompt = currentPrompt.slice(0, start) + key + currentPrompt.slice(end);
    pendingComposerSelectionOffsets = null;
    useComposerDraftStore.getState().setPrompt(THREAD_REF, nextPrompt);
    await waitForComposerText(nextPrompt);
    return;
  }
  pendingComposerSelectionOffsets = null;
  if (
    typeof document.execCommand === "function" &&
    document.execCommand("insertText", false, key)
  ) {
    await waitForLayout();
    return;
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    throw new Error("Unable to resolve composer selection for text input.");
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(key);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  composerEditor.dispatchEvent(
    new InputEvent("input", {
      data: key,
      inputType: "insertText",
      bubbles: true,
    }),
  );
  await waitForLayout();
}
export async function pressComposerUndo(): Promise<void> {
  const composerEditor = await waitForComposerEditor();
  const useMetaForMod = isMacPlatform(navigator.platform);
  composerEditor.focus();
  composerEditor.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "z",
      metaKey: useMetaForMod,
      ctrlKey: !useMetaForMod,
      bubbles: true,
      cancelable: true,
    }),
  );
  await waitForLayout();
}
export async function waitForComposerText(
  expectedText: string,
  options: { renderedText?: string } = {},
): Promise<void> {
  const expectedRenderedText = options.renderedText ?? renderComposerTextForPrompt(expectedText);
  await vi.waitFor(
    () => {
      expect(useComposerDraftStore.getState().draftsByThreadKey[THREAD_KEY]?.prompt ?? "").toBe(
        expectedText,
      );
      expect(
        document.querySelector<HTMLElement>('[contenteditable="true"]')?.textContent ?? "",
      ).toBe(expectedRenderedText);
    },
    { timeout: 8_000, interval: 16 },
  );
}

function renderComposerTextForPrompt(prompt: string): string {
  return splitPromptIntoComposerSegments(prompt)
    .map((segment) => {
      if (segment.type === "text") return segment.text;
      if (segment.type === "mention") return segment.path;
      if (segment.type === "skill") return segment.name;
      return segment.label;
    })
    .join("");
}
export async function setComposerSelectionByTextOffsets(options: {
  start: number;
  end: number;
  direction?: "forward" | "backward";
}): Promise<void> {
  const composerEditor = await waitForComposerEditor();
  composerEditor.focus();
  const resolvePoint = (targetOffset: number) => {
    const traversedRef = { value: 0 };
    const visitNode = (node: Node): { node: Node; offset: number } | null => {
      if (node.nodeType === Node.TEXT_NODE) {
        const textLength = node.textContent?.length ?? 0;
        if (targetOffset <= traversedRef.value + textLength) {
          return {
            node,
            offset: Math.max(0, Math.min(targetOffset - traversedRef.value, textLength)),
          };
        }
        traversedRef.value += textLength;
        return null;
      }
      if (node instanceof HTMLBRElement) {
        const parent = node.parentNode;
        if (!parent) {
          return null;
        }
        const siblingIndex = Array.prototype.indexOf.call(parent.childNodes, node);
        if (targetOffset <= traversedRef.value) {
          return { node: parent, offset: siblingIndex };
        }
        if (targetOffset <= traversedRef.value + 1) {
          return { node: parent, offset: siblingIndex + 1 };
        }
        traversedRef.value += 1;
        return null;
      }
      if (node instanceof Element || node instanceof DocumentFragment) {
        for (const child of node.childNodes) {
          const point = visitNode(child);
          if (point) {
            return point;
          }
        }
      }
      return null;
    };
    return (
      visitNode(composerEditor) ?? {
        node: composerEditor,
        offset: composerEditor.childNodes.length,
      }
    );
  };
  const startPoint = resolvePoint(options.start);
  const endPoint = resolvePoint(options.end);
  pendingComposerSelectionOffsets = options;
  const selection = window.getSelection();
  if (!selection) {
    throw new Error("Unable to resolve window selection.");
  }
  selection.removeAllRanges();
  if (options.direction === "backward") {
    selection.setBaseAndExtent(endPoint.node, endPoint.offset, startPoint.node, startPoint.offset);
    await waitForLayout();
    return;
  }
  selection.setBaseAndExtent(startPoint.node, startPoint.offset, endPoint.node, endPoint.offset);
  await waitForLayout();
}
export async function selectAllComposerContent(): Promise<void> {
  const composerEditor = await waitForComposerEditor();
  composerEditor.focus();
  pendingComposerSelectionOffsets = {
    start: 0,
    end: useComposerDraftStore.getState().draftsByThreadKey[THREAD_KEY]?.prompt.length ?? 0,
    canSurround: false,
  };
  const selection = window.getSelection();
  if (!selection) {
    throw new Error("Unable to resolve window selection.");
  }
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(composerEditor);
  selection.addRange(range);
  await waitForLayout();
}
export async function waitForComposerMenuItem(itemId: string): Promise<HTMLElement> {
  return waitForElement(
    () => document.querySelector<HTMLElement>(`[data-composer-item-id="${itemId}"]`),
    `Unable to find composer menu item "${itemId}".`,
  );
}
export async function waitForSendButton(): Promise<HTMLButtonElement> {
  return waitForElement(
    () => document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]'),
    "Unable to find send button.",
  );
}
export function findComposerProviderModelPicker(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-chat-provider-model-picker="true"]');
}
export function findButtonByText(text: string): HTMLButtonElement | null {
  return (Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text,
  ) ?? null) as HTMLButtonElement | null;
}
export async function waitForButtonByText(text: string): Promise<HTMLButtonElement> {
  return waitForElement(() => findButtonByText(text), `Unable to find "${text}" button.`);
}
function findButtonContainingText(text: string): HTMLButtonElement | null {
  return (Array.from(document.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  ) ?? null) as HTMLButtonElement | null;
}
export async function waitForButtonContainingText(text: string): Promise<HTMLButtonElement> {
  return waitForElement(
    () => findButtonContainingText(text),
    `Unable to find button containing "${text}".`,
  );
}
export async function waitForSelectItemContainingText(text: string): Promise<HTMLElement> {
  return waitForElement(
    () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')).find((item) =>
        item.textContent?.includes(text),
      ) ?? null,
    `Unable to find select item containing "${text}".`,
  );
}
export async function expectComposerActionsContained(): Promise<void> {
  const footer = await waitForElement(
    () => document.querySelector<HTMLElement>('[data-chat-input-footer="true"]'),
    "Unable to find composer footer.",
  );
  const actions = await waitForElement(
    () => document.querySelector<HTMLElement>('[data-chat-input-actions="right"]'),
    "Unable to find composer actions container.",
  );
  await vi.waitFor(
    () => {
      const footerRect = footer.getBoundingClientRect();
      const actionButtons = Array.from(actions.querySelectorAll<HTMLButtonElement>("button"));
      expect(actionButtons.length).toBeGreaterThanOrEqual(1);
      const buttonRects = actionButtons.map((button) => button.getBoundingClientRect());
      const firstTop = buttonRects[0]?.top ?? 0;
      for (const rect of buttonRects) {
        expect(rect.right).toBeLessThanOrEqual(footerRect.right + 0.5);
        expect(rect.bottom).toBeLessThanOrEqual(footerRect.bottom + 0.5);
        expect(Math.abs(rect.top - firstTop)).toBeLessThanOrEqual(1.5);
      }
    },
    { timeout: 8_000, interval: 16 },
  );
}
export async function waitForInteractionModeButton(
  expectedLabel: "Build" | "Plan",
): Promise<HTMLButtonElement> {
  return waitForElement(
    () =>
      Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === expectedLabel,
      ) as HTMLButtonElement | null,
    `Unable to find ${expectedLabel} interaction mode button.`,
  );
}
export async function waitForServerConfigToApply(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(wsRequests.some((request) => request._tag === WS_METHODS.subscribeServerConfig)).toBe(
        true,
      );
    },
    { timeout: 8_000, interval: 16 },
  );
  await waitForLayout();
}
export function dispatchChatNewShortcut(): void {
  const useMetaForMod = isMacPlatform(navigator.platform);
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "o",
      shiftKey: true,
      metaKey: useMetaForMod,
      ctrlKey: !useMetaForMod,
      bubbles: true,
      cancelable: true,
    }),
  );
}
export async function triggerChatNewShortcutUntilPath(
  router: ReturnType<typeof getRouter>,
  predicate: (pathname: string) => boolean,
  errorMessage: string,
): Promise<string> {
  let pathname = router.state.location.pathname;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    dispatchChatNewShortcut();
    await waitForLayout();
    pathname = router.state.location.pathname;
    if (predicate(pathname)) {
      return pathname;
    }
  }
  throw new Error(`${errorMessage} Last path: ${pathname}`);
}
export async function openCommandPaletteFromTrigger(): Promise<void> {
  const keybindings = getServerConfig()?.keybindings ?? [];
  const shortcut = shortcutForCommand(keybindings, "commandPalette.toggle", {
    context: { terminalFocus: false, terminalOpen: false },
  });

  if (shortcut) {
    const useMetaForMod = isMacPlatform(navigator.platform);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: shortcut.key,
        metaKey: shortcut.metaKey || (shortcut.modKey && useMetaForMod),
        ctrlKey: shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod),
        shiftKey: shortcut.shiftKey,
        altKey: shortcut.altKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  } else {
    useCommandPaletteStore.getState().setOpen(true);
  }

  await waitForElement(
    () => document.querySelector('[data-testid="command-palette"]'),
    "Command palette should have opened.",
  );
}
export async function waitForCommandPaletteShortcutLabel(): Promise<void> {
  await vi.waitFor(
    () => {
      const label = shortcutLabelForCommand(
        getServerConfig()?.keybindings ?? [],
        "commandPalette.toggle",
        { context: { terminalFocus: false, terminalOpen: false } },
      );
      expect(label).toBe(isMacPlatform(navigator.platform) ? "\u2318K" : "Ctrl+K");
    },
    { timeout: 8_000, interval: 16 },
  );
}
export async function mountChatView(options: {
  viewport: ViewportSpec;
  snapshot: OrchestrationReadModel;
  configureFixture?: (fixture: TestFixture) => void;
  resolveRpc?: (body: NormalizedWsRpcRequestBody) => unknown | undefined;
  initialPath?: string;
}): Promise<MountedChatView> {
  fixture = buildFixture(options.snapshot);
  options.configureFixture?.(fixture);
  customWsRpcResolver = options.resolveRpc ?? null;
  await setViewport(options.viewport);
  await waitForProductionStyles();
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);
  const router = getRouter(
    createMemoryHistory({
      initialEntries: [options.initialPath ?? `/${LOCAL_ENVIRONMENT_ID}/${THREAD_ID}`],
    }),
  );
  const screen = await render(
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
    </AppAtomRegistryProvider>,
    {
      container: host,
    },
  );
  await waitForWsClient();
  await waitForAppBootstrap();
  await waitForLayout();
  const cleanup = async () => {
    customWsRpcResolver = null;
    await screen.unmount();
    host.remove();
    await waitForLayout();
  };
  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
    setViewport: async (viewport: ViewportSpec) => {
      await setViewport(viewport);
      await waitForProductionStyles();
    },
    setContainerSize: async (viewport) => {
      host.style.width = `${viewport.width}px`;
      host.style.height = `${viewport.height}px`;
      await waitForLayout();
    },
    router,
  };
}
export function installChatViewBrowserHarness(): void {
  beforeAll(async () => {
    fixture = buildFixture(
      createSnapshotForTargetUser({
        targetMessageId: "msg-user-bootstrap" as MessageId,
        targetText: "bootstrap",
      }),
    );
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: {
        url: "/mockServiceWorker.js",
      },
    });
  });
  afterAll(async () => {
    await rpcHarness.disconnect();
    await worker.stop();
  });
  beforeEach(async () => {
    await rpcHarness.reset({
      resolveUnary: resolveWsRpc,
      getInitialStreamValues: (request) => {
        if (request._tag === WS_METHODS.subscribeServerLifecycle) {
          return [
            {
              version: 1,
              sequence: 1,
              type: "welcome",
              payload: fixture.welcome,
            },
          ];
        }
        if (request._tag === WS_METHODS.subscribeServerConfig) {
          return [
            {
              version: 1,
              type: "snapshot",
              config: fixture.serverConfig,
            },
          ];
        }
        if (request._tag === ORCHESTRATION_WS_METHODS.subscribeShell) {
          return [
            {
              kind: "snapshot",
              snapshot: toShellSnapshot(fixture.snapshot),
            },
          ];
        }
        if (request._tag === ORCHESTRATION_WS_METHODS.subscribeThread) {
          const thread = fixture.snapshot.threads.find((entry) => entry.id === request.threadId);
          return thread
            ? [
                {
                  kind: "snapshot",
                  snapshot: {
                    snapshotSequence: fixture.snapshot.snapshotSequence,
                    thread,
                  },
                },
              ]
            : [];
        }
        return [];
      },
    });
    await __resetLocalApiForTests();
    __resetClientSettingsPersistenceForTests();
    await setViewport(DEFAULT_VIEWPORT);
    localStorage.clear();
    document.body.innerHTML = "";
    wsRequests.length = 0;
    customWsRpcResolver = null;
    __resetEnvironmentApiOverridesForTests();
    Reflect.deleteProperty(window, "desktopBridge");
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
    useComposerQueueStore.setState({
      queueItemsByThreadKey: {},
      editingQueueItemIdByThreadKey: {},
      queueExpandedByThreadKey: {},
    });
    useCommandPaletteStore.setState({
      open: false,
      openIntent: null,
      openSessionId: 0,
      controller: null,
    });
    useStore.setState({
      activeEnvironmentId: null,
      environmentStateById: {},
    });
    useUiStateStore.setState({
      projectExpandedById: {},
      projectOrder: [],
      threadLastVisitedAtById: {},
    });
    useTerminalStateStore.persist.clearStorage();
    useTerminalStateStore.setState({
      terminalStateByThreadKey: {},
      terminalLaunchContextByThreadKey: {},
      terminalEventEntriesByKey: {},
      nextTerminalEventId: 1,
    });
  });
  afterEach(() => {
    customWsRpcResolver = null;
    document.body.innerHTML = "";
  });
}
