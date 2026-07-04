import { DEFAULT_TERMINAL_ID } from "@honk/shared/terminal";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { WorkbenchTab } from "~/lib/workbench-tabs";
import {
  readBrowserWorkbenchSnapshot,
  readTerminalSessions,
  shellPanelsActions,
  type BrowserWorkbenchState,
  type TerminalSessionEntry,
  type TerminalSessionsState,
} from "~/stores/shell-panels-store";
import { inferLoginShellCaption } from "~/lib/shell-caption";
import { workspaceEditorActions } from "~/stores/workspace-editor-store";

const WORKBENCH_TAB_STORAGE_KEY = "honk.shell.workbenchTabs.v1";
const DEFAULT_WORKSPACE_KEY = "default";

export type WorkbenchTabIconKey = "plan" | "dev" | "changes" | "terminal" | "file" | "browser";

export interface WorkbenchManagedTab {
  readonly id: string;
  readonly kind: WorkbenchTab;
  readonly label: string;
  readonly iconKey: WorkbenchTabIconKey;
  readonly closable: boolean;
  readonly preview?: boolean | undefined;
  readonly stable?: boolean | undefined;
  readonly terminalId?: string | undefined;
  readonly filePath?: string | undefined;
  readonly browserId?: string | undefined;
  readonly browserUrl?: string | undefined;
  readonly browserFaviconUrl?: string | undefined;
}

export interface WorkbenchTabSnapshot {
  readonly tabs: readonly WorkbenchManagedTab[];
  readonly activeTabId: string;
  readonly activeTab: WorkbenchManagedTab;
  readonly visitedTabIds: ReadonlySet<string>;
}

export interface WorkbenchTabSnapshotRuntimeInput {
  readonly plan?: { readonly available: boolean; readonly label: string } | undefined;
  readonly terminal?: TerminalSessionsState | undefined;
}

interface WorkbenchTabWorkspaceState {
  readonly tabs: readonly WorkbenchManagedTab[];
  readonly activeTabId: string;
  readonly visitedTabIds: readonly string[];
}

interface WorkbenchTabStoreState {
  readonly byWorkspaceKey: Record<string, WorkbenchTabWorkspaceState>;
}

interface PersistedWorkbenchTab {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly label?: unknown;
  readonly iconKey?: unknown;
  readonly closable?: unknown;
  readonly preview?: unknown;
  readonly stable?: unknown;
  readonly terminalId?: unknown;
  readonly filePath?: unknown;
  readonly browserId?: unknown;
  readonly browserUrl?: unknown;
  readonly browserFaviconUrl?: unknown;
}

interface PersistedWorkbenchTabWorkspace {
  readonly tabs?: unknown;
  readonly activeTabId?: unknown;
  readonly visitedTabIds?: unknown;
}

const CHANGES_TAB_ID = "changes";
const FILES_TAB_ID = "files";
const BROWSER_TAB_ID = "browser";
const DEV_TAB_ID = "dev";
const PLAN_TAB_ID = "plan";
const FILE_PREVIEW_TAB_ID = "file:preview";
const DEFAULT_BROWSER_ID = "default";

function terminalTabId(terminalId: string): string {
  return `terminal:${terminalId}`;
}

function browserTabId(browserId: string): string {
  return browserId === DEFAULT_BROWSER_ID ? BROWSER_TAB_ID : `browser:${browserId}`;
}

function browserIdFromTabId(tabId: string): string {
  return tabId === BROWSER_TAB_ID || !tabId.startsWith("browser:")
    ? DEFAULT_BROWSER_ID
    : tabId.slice("browser:".length);
}

function fileTabId(relativePath: string): string {
  return `file:${encodeURIComponent(relativePath)}`;
}

function createBrowserId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createTerminalId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `term-${crypto.randomUUID()}`;
  }
  return `term-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const DEFAULT_TERMINAL_TAB_ID = terminalTabId(DEFAULT_TERMINAL_ID);

function defaultBrowserTab(): WorkbenchManagedTab {
  return {
    id: BROWSER_TAB_ID,
    kind: "browser",
    label: "Browser",
    iconKey: "browser",
    closable: false,
    browserId: DEFAULT_BROWSER_ID,
  };
}

const DEFAULT_WORKBENCH_TABS: readonly WorkbenchManagedTab[] = Object.freeze([
  Object.freeze({
    id: CHANGES_TAB_ID,
    kind: "git",
    label: "Changes",
    iconKey: "changes",
    closable: false,
    stable: true,
  }),
  Object.freeze({
    id: DEFAULT_TERMINAL_TAB_ID,
    kind: "terminal",
    label: inferLoginShellCaption(),
    iconKey: "terminal",
    closable: true,
    terminalId: DEFAULT_TERMINAL_ID,
  }),
  Object.freeze(defaultBrowserTab()),
  Object.freeze({
    id: FILES_TAB_ID,
    kind: "files",
    label: "Files",
    iconKey: "file",
    closable: false,
  }),
]);

const DEFAULT_WORKBENCH_STATE: WorkbenchTabWorkspaceState = Object.freeze({
  tabs: DEFAULT_WORKBENCH_TABS,
  activeTabId: CHANGES_TAB_ID,
  visitedTabIds: Object.freeze([CHANGES_TAB_ID]),
});

function resolveWorkbenchWorkspaceKey(workspaceKey: string | null): string {
  const trimmed = workspaceKey?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_WORKSPACE_KEY;
}

function isWorkbenchTabKind(value: unknown): value is WorkbenchTab {
  return (
    value === "plan" ||
    value === "dev" ||
    value === "git" ||
    value === "terminal" ||
    value === "files" ||
    value === "browser"
  );
}

function isWorkbenchTabIconKey(value: unknown): value is WorkbenchTabIconKey {
  return (
    value === "plan" ||
    value === "dev" ||
    value === "changes" ||
    value === "terminal" ||
    value === "file" ||
    value === "browser"
  );
}

function normalizePersistedTab(value: PersistedWorkbenchTab): WorkbenchManagedTab | null {
  const filePath = typeof value.filePath === "string" ? value.filePath : undefined;
  if (
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    !isWorkbenchTabKind(value.kind) ||
    !isWorkbenchTabIconKey(value.iconKey)
  ) {
    return null;
  }
  const id =
    value.kind === "files" && value.id === FILES_TAB_ID && filePath
      ? fileTabId(filePath)
      : value.id;

  return {
    id,
    kind: value.kind,
    label: value.label,
    iconKey: value.iconKey,
    closable: filePath ? true : typeof value.closable === "boolean" ? value.closable : true,
    ...(typeof value.preview === "boolean" ? { preview: value.preview } : {}),
    ...(typeof value.stable === "boolean" ? { stable: value.stable } : {}),
    ...(typeof value.terminalId === "string" ? { terminalId: value.terminalId } : {}),
    ...(filePath ? { filePath } : {}),
    ...(value.kind === "browser"
      ? {
          browserId: typeof value.browserId === "string" ? value.browserId : browserIdFromTabId(id),
        }
      : {}),
    ...(typeof value.browserUrl === "string" ? { browserUrl: value.browserUrl } : {}),
    ...(typeof value.browserFaviconUrl === "string"
      ? { browserFaviconUrl: value.browserFaviconUrl }
      : {}),
  };
}

function normalizeTabs(tabs: readonly WorkbenchManagedTab[]): readonly WorkbenchManagedTab[] {
  const result: WorkbenchManagedTab[] = [];
  const seen = new Set<string>();
  for (const tab of tabs) {
    if (seen.has(tab.id)) continue;
    result.push(tab);
    seen.add(tab.id);
  }
  for (const tab of DEFAULT_WORKBENCH_TABS) {
    if (seen.has(tab.id)) continue;
    result.push(tab);
    seen.add(tab.id);
  }
  return result;
}

function normalizeWorkspaceState(state: WorkbenchTabWorkspaceState): WorkbenchTabWorkspaceState {
  const tabs = normalizeTabs(state.tabs);
  const activeTabId = tabs.some((tab) => tab.id === state.activeTabId)
    ? state.activeTabId
    : DEFAULT_WORKBENCH_STATE.activeTabId;
  const visitedTabIds = Array.from(
    new Set(
      [...state.visitedTabIds, activeTabId].filter((id) => tabs.some((tab) => tab.id === id)),
    ),
  );

  return {
    tabs,
    activeTabId,
    visitedTabIds,
  };
}

function normalizePersistedWorkspace(
  value: PersistedWorkbenchTabWorkspace,
): WorkbenchTabWorkspaceState {
  const tabs = Array.isArray(value.tabs)
    ? value.tabs
        .map((tab) =>
          typeof tab === "object" && tab !== null
            ? normalizePersistedTab(tab as PersistedWorkbenchTab)
            : null,
        )
        .filter((tab): tab is WorkbenchManagedTab => tab !== null)
    : [];
  const activeTabId = typeof value.activeTabId === "string" ? value.activeTabId : CHANGES_TAB_ID;
  const visitedTabIds = Array.isArray(value.visitedTabIds)
    ? value.visitedTabIds.filter((id): id is string => typeof id === "string")
    : [activeTabId];

  return normalizeWorkspaceState({ tabs, activeTabId, visitedTabIds });
}

function readPersistedWorkbenchTabs(): Record<string, WorkbenchTabWorkspaceState> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(WORKBENCH_TAB_STORAGE_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return {};
    const result: Record<string, WorkbenchTabWorkspaceState> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      result[key] = normalizePersistedWorkspace(value as PersistedWorkbenchTabWorkspace);
    }
    return result;
  } catch {
    return {};
  }
}

function isPersistableTab(tab: WorkbenchManagedTab): boolean {
  return tab.id !== DEV_TAB_ID && tab.id !== PLAN_TAB_ID && tab.preview !== true;
}

function persistWorkbenchTabs(data: Record<string, WorkbenchTabWorkspaceState>): void {
  if (typeof window === "undefined") return;
  const persisted: Record<string, WorkbenchTabWorkspaceState> = {};
  for (const [key, state] of Object.entries(data)) {
    persisted[key] = {
      tabs: state.tabs.filter(isPersistableTab),
      activeTabId:
        !state.tabs.some((tab) => tab.id === state.activeTabId && isPersistableTab(tab)) ||
        state.activeTabId === DEV_TAB_ID ||
        state.activeTabId === PLAN_TAB_ID
          ? CHANGES_TAB_ID
          : state.activeTabId,
      visitedTabIds: state.visitedTabIds.filter((id) =>
        state.tabs.some((tab) => tab.id === id && isPersistableTab(tab)),
      ),
    };
  }
  window.localStorage.setItem(WORKBENCH_TAB_STORAGE_KEY, JSON.stringify(persisted));
}

function readWorkspaceState(
  data: Record<string, WorkbenchTabWorkspaceState>,
  workspaceKey: string | null,
): WorkbenchTabWorkspaceState {
  return data[resolveWorkbenchWorkspaceKey(workspaceKey)] ?? DEFAULT_WORKBENCH_STATE;
}

function areTabsEqual(left: WorkbenchManagedTab, right: WorkbenchManagedTab): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.label === right.label &&
    left.iconKey === right.iconKey &&
    left.closable === right.closable &&
    left.preview === right.preview &&
    left.stable === right.stable &&
    left.terminalId === right.terminalId &&
    left.filePath === right.filePath &&
    left.browserId === right.browserId &&
    left.browserUrl === right.browserUrl &&
    left.browserFaviconUrl === right.browserFaviconUrl
  );
}

function areWorkspaceStatesEqual(
  left: WorkbenchTabWorkspaceState,
  right: WorkbenchTabWorkspaceState,
): boolean {
  return (
    left.activeTabId === right.activeTabId &&
    left.tabs.length === right.tabs.length &&
    left.tabs.every((tab, index) => areTabsEqual(tab, right.tabs[index]!)) &&
    left.visitedTabIds.length === right.visitedTabIds.length &&
    left.visitedTabIds.every((id, index) => id === right.visitedTabIds[index])
  );
}

const useWorkbenchTabStore = create<WorkbenchTabStoreState>(() => ({
  byWorkspaceKey: readPersistedWorkbenchTabs(),
}));

function updateWorkspaceState(
  workspaceKey: string | null,
  updater: (current: WorkbenchTabWorkspaceState) => WorkbenchTabWorkspaceState,
): WorkbenchTabWorkspaceState {
  let nextState = DEFAULT_WORKBENCH_STATE;
  useWorkbenchTabStore.setState((state) => {
    const key = resolveWorkbenchWorkspaceKey(workspaceKey);
    const current = readWorkspaceState(state.byWorkspaceKey, workspaceKey);
    const next = normalizeWorkspaceState(updater(current));
    nextState = next;
    if (areWorkspaceStatesEqual(current, next)) {
      return state;
    }
    const byWorkspaceKey = {
      ...state.byWorkspaceKey,
      [key]: next,
    };
    persistWorkbenchTabs(byWorkspaceKey);
    return { byWorkspaceKey };
  });
  return nextState;
}

function upsertTab(
  tabs: readonly WorkbenchManagedTab[],
  tab: WorkbenchManagedTab,
  insertIndex: number,
): readonly WorkbenchManagedTab[] {
  const existingIndex = tabs.findIndex((candidate) => candidate.id === tab.id);
  if (existingIndex >= 0) {
    return tabs.map((candidate) => (candidate.id === tab.id ? tab : candidate));
  }
  const clampedIndex = Math.min(Math.max(insertIndex, 0), tabs.length);
  return [...tabs.slice(0, clampedIndex), tab, ...tabs.slice(clampedIndex)];
}

function upsertTabAtIndex(
  tabs: readonly WorkbenchManagedTab[],
  tab: WorkbenchManagedTab,
  insertIndex: number,
): readonly WorkbenchManagedTab[] {
  return moveTabToIndex(upsertTab(tabs, tab, insertIndex), tab.id, insertIndex);
}

function removeTab(
  tabs: readonly WorkbenchManagedTab[],
  tabId: string,
): readonly WorkbenchManagedTab[] {
  return tabs.filter((tab) => tab.id !== tabId);
}

function planTab(label: string): WorkbenchManagedTab {
  return {
    id: PLAN_TAB_ID,
    kind: "plan",
    label,
    iconKey: "plan",
    closable: false,
    stable: true,
  };
}

function terminalSessionTab(session: TerminalSessionEntry): WorkbenchManagedTab {
  return {
    id: terminalTabId(session.id),
    kind: "terminal",
    label: terminalTabLabel(session.label),
    iconKey: "terminal",
    closable: true,
    terminalId: session.id,
  };
}

function applyPlanRuntimeTabs(
  tabs: readonly WorkbenchManagedTab[],
  plan: WorkbenchTabSnapshotRuntimeInput["plan"],
): readonly WorkbenchManagedTab[] {
  if (!plan) return tabs;

  if (!plan.available) {
    return removeTab(tabs, PLAN_TAB_ID);
  }

  return upsertTabAtIndex(tabs, planTab(plan.label), 0);
}

function applyTerminalRuntimeTabs(
  tabs: readonly WorkbenchManagedTab[],
  terminal: TerminalSessionsState | undefined,
): readonly WorkbenchManagedTab[] {
  if (!terminal) return tabs;

  const sessionIds = new Set(terminal.sessions.map((session) => session.id));
  let result: readonly WorkbenchManagedTab[] = tabs
    .filter((tab) => tab.kind !== "terminal" || (tab.terminalId && sessionIds.has(tab.terminalId)))
    .map((tab) => {
      if (tab.kind !== "terminal" || !tab.terminalId) return tab;
      const session = terminal.sessions.find((entry) => entry.id === tab.terminalId);
      return session ? terminalSessionTab(session) : tab;
    });

  const presentTerminalIds = new Set(
    result.filter((tab) => tab.kind === "terminal" && tab.terminalId).map((tab) => tab.terminalId!),
  );
  let insertIndex = result.length;

  for (const session of terminal.sessions) {
    if (presentTerminalIds.has(session.id)) continue;
    result = upsertTab(result, terminalSessionTab(session), insertIndex);
    insertIndex += 1;
    presentTerminalIds.add(session.id);
  }

  return result;
}

function applyRuntimeTabs(
  tabs: readonly WorkbenchManagedTab[],
  runtime: WorkbenchTabSnapshotRuntimeInput | undefined,
): readonly WorkbenchManagedTab[] {
  if (!runtime) return tabs;
  return applyTerminalRuntimeTabs(applyPlanRuntimeTabs(tabs, runtime.plan), runtime.terminal);
}

function activeTabIdForTabs(tabs: readonly WorkbenchManagedTab[], activeTabId: string): string {
  return tabs.some((tab) => tab.id === activeTabId)
    ? activeTabId
    : (tabs[0]?.id ?? DEFAULT_WORKBENCH_STATE.activeTabId);
}

function moveTabToIndex(
  tabs: readonly WorkbenchManagedTab[],
  tabId: string,
  targetIndex: number,
): readonly WorkbenchManagedTab[] {
  const currentIndex = tabs.findIndex((tab) => tab.id === tabId);
  if (currentIndex < 0) return tabs;

  const tab = tabs[currentIndex]!;
  const withoutTab = tabs.filter((candidate) => candidate.id !== tabId);
  const clampedIndex = Math.min(Math.max(targetIndex, 0), withoutTab.length);

  return [...withoutTab.slice(0, clampedIndex), tab, ...withoutTab.slice(clampedIndex)];
}

function tabLabelFromPath(relativePath: string): string {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? relativePath;
}

function fileWorkbenchTab(input: {
  relativePath: string;
  id: string;
  preview?: boolean | undefined;
}): WorkbenchManagedTab {
  return {
    id: input.id,
    kind: "files",
    label: tabLabelFromPath(input.relativePath),
    iconKey: "file",
    closable: true,
    filePath: input.relativePath,
    ...(input.preview ? { preview: true } : {}),
  };
}

function tabLabelFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host || "Browser";
  } catch {
    return url || "Browser";
  }
}

function tabLabelFromBrowserMetadata(url: string, title?: string): string {
  const trimmedTitle = title?.trim();
  return trimmedTitle || tabLabelFromUrl(url);
}

function terminalTabLabel(label: string): string {
  const trimmedLabel = label.trim();
  const legacyMatch = /^Terminal(?: (\d+))?$/.exec(trimmedLabel);
  if (!trimmedLabel || legacyMatch) {
    const shell = inferLoginShellCaption();
    return legacyMatch?.[1] ? `${shell} ${legacyMatch[1]}` : shell;
  }
  return trimmedLabel;
}

function browserFaviconUrlFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(parsed.href)}&sz=32`;
  } catch {
    return undefined;
  }
}

function isBrowserWorkbenchStateEmpty(state: BrowserWorkbenchState): boolean {
  return !state.committedUrl && !state.inputValue && !state.pendingUrl;
}

function reusableDefaultBrowserTab(
  workspaceKey: string | null,
  state: WorkbenchTabWorkspaceState,
): WorkbenchManagedTab | null {
  const tab = state.tabs.find((candidate) => candidate.id === BROWSER_TAB_ID);
  if (!tab || tab.kind !== "browser" || tab.browserUrl) return null;
  const browserState = readBrowserWorkbenchSnapshot(
    workspaceKey,
    tab.browserId ?? DEFAULT_BROWSER_ID,
  );
  return isBrowserWorkbenchStateEmpty(browserState) ? tab : null;
}

function previewFileTab(tabs: readonly WorkbenchManagedTab[]): WorkbenchManagedTab | null {
  return tabs.find((tab) => tab.kind === "files" && tab.preview === true) ?? null;
}

function activateTabState(
  current: WorkbenchTabWorkspaceState,
  tabId: string,
): WorkbenchTabWorkspaceState {
  if (!current.tabs.some((tab) => tab.id === tabId)) {
    return current;
  }
  return {
    ...current,
    activeTabId: tabId,
    visitedTabIds: Array.from(new Set([...current.visitedTabIds, tabId])),
  };
}

function activeTabForKind(
  workspaceKey: string | null,
  tabs: readonly WorkbenchManagedTab[],
  kind: WorkbenchTab,
  activeTabId?: string,
): WorkbenchManagedTab | null {
  if (kind === "git") {
    return tabs.find((tab) => tab.id === CHANGES_TAB_ID) ?? null;
  }
  if (kind === "terminal") {
    const activeTerminalId = readTerminalSessions(workspaceKey).activeId;
    return (
      tabs.find((tab) => tab.kind === "terminal" && tab.terminalId === activeTerminalId) ??
      tabs.find((tab) => tab.kind === "terminal") ??
      null
    );
  }
  if (kind === "files") {
    return (
      tabs.find((tab) => tab.id === FILES_TAB_ID) ??
      tabs.find((tab) => tab.kind === "files") ??
      null
    );
  }
  if (kind === "browser") {
    return (
      tabs.find((tab) => tab.kind === "browser" && tab.id === activeTabId) ??
      tabs.find((tab) => tab.kind === "browser") ??
      null
    );
  }
  return tabs.find((tab) => tab.kind === kind) ?? null;
}

function applyActivationSideEffects(workspaceKey: string | null, tab: WorkbenchManagedTab): void {
  if (tab.kind === "terminal" && tab.terminalId) {
    shellPanelsActions.setActiveTerminal(workspaceKey, tab.terminalId);
  }
  if (tab.kind === "files" && tab.filePath) {
    if (tab.preview) {
      workspaceEditorActions.previewFile(workspaceKey, tab.filePath);
    } else {
      workspaceEditorActions.openFile(workspaceKey, tab.filePath);
      workspaceEditorActions.setEditorPlacement(workspaceKey, "right-panel");
    }
  } else if (tab.kind === "files") {
    workspaceEditorActions.clearFilePreview(workspaceKey);
  }
  if (tab.kind === "browser" && tab.browserUrl) {
    const browserState = readBrowserWorkbenchSnapshot(workspaceKey, tab.browserId);
    if (isBrowserWorkbenchStateEmpty(browserState)) {
      const patch: Partial<BrowserWorkbenchState> = {
        committedUrl: tab.browserUrl,
        inputValue: tab.browserUrl,
        isLoading: true,
        loadError: null,
        pendingUrl: tab.browserUrl,
      };
      shellPanelsActions.setBrowserWorkbenchState(workspaceKey, patch, tab.browserId);
    }
  }
  shellPanelsActions.setActiveTab(tab.kind, workspaceKey);
  shellPanelsActions.setMuted(false, workspaceKey);
}

function activateManagedTab(
  workspaceKey: string | null,
  tabId: string,
): WorkbenchManagedTab | null {
  const next = updateWorkspaceState(workspaceKey, (current) => activateTabState(current, tabId));
  const active = next.tabs.find((tab) => tab.id === next.activeTabId) ?? null;
  if (active) {
    applyActivationSideEffects(workspaceKey, active);
  }
  return active;
}

function upsertPlanTab(workspaceKey: string | null, label: string): void {
  updateWorkspaceState(workspaceKey, (current) => {
    return {
      ...current,
      tabs: upsertTabAtIndex(current.tabs, planTab(label), 0),
    };
  });
}

function activatePlanTab(workspaceKey: string | null, label = "Plan"): void {
  upsertPlanTab(workspaceKey, label);
  activateManagedTab(workspaceKey, PLAN_TAB_ID);
}

export function useWorkbenchTabSnapshot(
  workspaceKey: string | null,
  runtime?: WorkbenchTabSnapshotRuntimeInput,
): WorkbenchTabSnapshot {
  const workspace = useWorkbenchTabStore(
    useShallow((state) => readWorkspaceState(state.byWorkspaceKey, workspaceKey)),
  );

  const tabs = applyRuntimeTabs(workspace.tabs, runtime);
  const activeTabId = activeTabIdForTabs(tabs, workspace.activeTabId);
  const activeTab =
    tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? DEFAULT_WORKBENCH_TABS[0]!;
  return {
    tabs,
    activeTabId: activeTab.id,
    activeTab,
    visitedTabIds: new Set(
      workspace.visitedTabIds.filter((id) => tabs.some((tab) => tab.id === id)),
    ),
  };
}

export const workbenchTabPersistenceActions = {
  activateTab: (workspaceKey: string | null, tabId: string): void => {
    if (tabId === PLAN_TAB_ID) {
      activatePlanTab(workspaceKey);
      return;
    }
    activateManagedTab(workspaceKey, tabId);
  },
  activateKind: (workspaceKey: string | null, kind: WorkbenchTab): void => {
    if (kind === "plan") {
      activatePlanTab(workspaceKey);
      return;
    }
    const workspace = readWorkspaceState(
      useWorkbenchTabStore.getState().byWorkspaceKey,
      workspaceKey,
    );
    const tab = activeTabForKind(workspaceKey, workspace.tabs, kind, workspace.activeTabId);
    if (tab) {
      activateManagedTab(workspaceKey, tab.id);
      return;
    }
    shellPanelsActions.setActiveTab(kind, workspaceKey);
    shellPanelsActions.setMuted(false, workspaceKey);
  },
  activateChanges: (workspaceKey: string | null): void => {
    activateManagedTab(workspaceKey, CHANGES_TAB_ID);
  },
  activatePlan: (workspaceKey: string | null, label = "Plan"): void => {
    activatePlanTab(workspaceKey, label);
  },
  activateDev: (workspaceKey: string | null): void => {
    updateWorkspaceState(workspaceKey, (current) => {
      return {
        ...current,
        tabs: upsertTab(
          current.tabs,
          {
            id: DEV_TAB_ID,
            kind: "dev",
            label: "Dev",
            iconKey: "dev",
            closable: true,
          },
          current.tabs.length,
        ),
      };
    });
    activateManagedTab(workspaceKey, DEV_TAB_ID);
  },
  createTerminal: (
    workspaceKey: string | null,
    input?: { id?: string | undefined; label?: string | undefined },
  ): string => {
    const terminalId = input?.id ?? createTerminalId();
    const label = input?.label ?? inferLoginShellCaption();
    shellPanelsActions.addTerminalSession(workspaceKey, { id: terminalId, label });
    const terminal = readTerminalSessions(workspaceKey);
    const session = terminal.sessions.find((entry) => entry.id === terminalId) ?? {
      id: terminalId,
      label,
    };
    updateWorkspaceState(workspaceKey, (current) => ({
      ...current,
      tabs: upsertTab(current.tabs, terminalSessionTab(session), current.tabs.length),
    }));
    activateManagedTab(workspaceKey, terminalTabId(terminalId));
    return terminalId;
  },
  activateTerminal: (workspaceKey: string | null, terminalId: string): void => {
    activateManagedTab(workspaceKey, terminalTabId(terminalId));
  },
  createBrowser: (
    workspaceKey: string | null,
    input?: { browserId?: string | undefined; url?: string | undefined },
  ): void => {
    const url = input?.url?.trim();
    const requestedBrowserId = input?.browserId?.trim();
    if (!requestedBrowserId) {
      const workspace = readWorkspaceState(
        useWorkbenchTabStore.getState().byWorkspaceKey,
        workspaceKey,
      );
      const reusableTab = reusableDefaultBrowserTab(workspaceKey, workspace);
      if (reusableTab) {
        if (url) {
          updateWorkspaceState(workspaceKey, (current) => ({
            ...current,
            tabs: current.tabs.map((tab) =>
              tab.id === reusableTab.id
                ? {
                    ...tab,
                    label: tabLabelFromUrl(url),
                    closable: true,
                    browserUrl: url,
                    browserFaviconUrl: browserFaviconUrlFromUrl(url),
                  }
                : tab,
            ),
          }));
        }
        activateManagedTab(workspaceKey, reusableTab.id);
        return;
      }
    }

    const browserId = requestedBrowserId || createBrowserId();
    const tabId = browserTabId(browserId);
    updateWorkspaceState(workspaceKey, (current) => ({
      ...current,
      tabs: upsertTab(
        current.tabs,
        {
          id: tabId,
          kind: "browser",
          label: url ? tabLabelFromUrl(url) : "New Tab",
          iconKey: "browser",
          closable: true,
          browserId,
          ...(url ? { browserUrl: url } : {}),
          ...(url ? { browserFaviconUrl: browserFaviconUrlFromUrl(url) } : {}),
        },
        current.tabs.length,
      ),
    }));
    activateManagedTab(workspaceKey, tabId);
  },
  previewFile: (workspaceKey: string | null, relativePath: string): void => {
    const trimmedPath = relativePath.trim();
    if (!trimmedPath) return;
    const durableTabId = fileTabId(trimmedPath);
    const workspace = readWorkspaceState(
      useWorkbenchTabStore.getState().byWorkspaceKey,
      workspaceKey,
    );
    const durableTab = workspace.tabs.find(
      (tab) => tab.id === durableTabId && tab.preview !== true,
    );
    if (durableTab) {
      activateManagedTab(workspaceKey, durableTab.id);
      return;
    }

    const previewTab = fileWorkbenchTab({
      id: FILE_PREVIEW_TAB_ID,
      relativePath: trimmedPath,
      preview: true,
    });
    updateWorkspaceState(workspaceKey, (current) => {
      const existingPreview = previewFileTab(current.tabs);
      if (existingPreview) {
        return {
          ...current,
          tabs: current.tabs.map((tab) => (tab.id === existingPreview.id ? previewTab : tab)),
        };
      }
      return {
        ...current,
        tabs: upsertTab(current.tabs, previewTab, current.tabs.length),
      };
    });
    activateManagedTab(workspaceKey, FILE_PREVIEW_TAB_ID);
  },
  createFile: (workspaceKey: string | null, relativePath: string): void => {
    const trimmedPath = relativePath.trim();
    if (!trimmedPath) return;
    const tabId = fileTabId(trimmedPath);
    updateWorkspaceState(workspaceKey, (current) => {
      const durableTab = fileWorkbenchTab({
        id: tabId,
        relativePath: trimmedPath,
      });
      const existingDurable = current.tabs.some((tab) => tab.id === tabId && tab.preview !== true);
      const existingPreview = previewFileTab(current.tabs);
      if (existingPreview?.filePath === trimmedPath && !existingDurable) {
        return {
          ...current,
          tabs: current.tabs.map((tab) => (tab.id === existingPreview.id ? durableTab : tab)),
        };
      }
      const tabs =
        existingPreview?.filePath === trimmedPath
          ? removeTab(current.tabs, existingPreview.id)
          : current.tabs;
      return {
        ...current,
        tabs: upsertTab(tabs, durableTab, tabs.length),
      };
    });
    activateManagedTab(workspaceKey, tabId);
  },
  renameFilePath: (
    workspaceKey: string | null,
    fromRelativePath: string,
    toRelativePath: string,
  ): void => {
    const fromPath = fromRelativePath.trim();
    const toPath = toRelativePath.trim();
    if (!fromPath || !toPath || fromPath === toPath) return;
    const fromTabId = fileTabId(fromPath);
    const toTabId = fileTabId(toPath);
    updateWorkspaceState(workspaceKey, (current) => {
      let changed = false;
      const tabs = current.tabs.map((tab) => {
        if (tab.kind !== "files" || tab.filePath !== fromPath) {
          return tab;
        }
        changed = true;
        return fileWorkbenchTab({
          id: toTabId,
          relativePath: toPath,
          preview: tab.preview,
        });
      });
      if (!changed) {
        return current;
      }
      const dedupedTabs = tabs.filter(
        (tab, index) => tabs.findIndex((candidate) => candidate.id === tab.id) === index,
      );
      return {
        ...current,
        tabs: dedupedTabs,
        activeTabId: current.activeTabId === fromTabId ? toTabId : current.activeTabId,
        visitedTabIds: current.visitedTabIds.map((tabId) =>
          tabId === fromTabId ? toTabId : tabId,
        ),
      };
    });
  },
  closeTab: (workspaceKey: string | null, tabId: string): void => {
    const workspace = readWorkspaceState(
      useWorkbenchTabStore.getState().byWorkspaceKey,
      workspaceKey,
    );
    const closingTab = workspace.tabs.find((tab) => tab.id === tabId);
    if (!closingTab) return;

    const closingDefaultBrowser =
      closingTab.id === BROWSER_TAB_ID &&
      closingTab.kind === "browser" &&
      (closingTab.closable || Boolean(closingTab.browserUrl));
    if (!closingTab.closable && !closingDefaultBrowser) return;

    if (closingDefaultBrowser) {
      shellPanelsActions.removeBrowserWorkbenchState(
        workspaceKey,
        closingTab.browserId ?? DEFAULT_BROWSER_ID,
      );
      updateWorkspaceState(workspaceKey, (current) => ({
        ...current,
        activeTabId: BROWSER_TAB_ID,
        tabs: current.tabs.map((tab) => (tab.id === BROWSER_TAB_ID ? defaultBrowserTab() : tab)),
        visitedTabIds: Array.from(new Set([...current.visitedTabIds, BROWSER_TAB_ID])),
      }));
      activateManagedTab(workspaceKey, BROWSER_TAB_ID);
      return;
    }

    if (closingTab.kind === "terminal" && closingTab.terminalId) {
      shellPanelsActions.removeTerminalSession(workspaceKey, closingTab.terminalId);
    }
    if (closingTab.kind === "browser" && closingTab.browserId) {
      shellPanelsActions.removeBrowserWorkbenchState(workspaceKey, closingTab.browserId);
    }

    const next = updateWorkspaceState(workspaceKey, (current) => {
      const currentIndex = current.tabs.findIndex((tab) => tab.id === tabId);
      const tabs = removeTab(current.tabs, tabId);
      const fallbackTab =
        tabs[Math.max(0, Math.min(currentIndex, tabs.length - 1))] ??
        tabs[0] ??
        DEFAULT_WORKBENCH_TABS[0]!;
      return {
        tabs,
        activeTabId: current.activeTabId === tabId ? fallbackTab.id : current.activeTabId,
        visitedTabIds: current.visitedTabIds.filter((id) => id !== tabId),
      };
    });
    if (next.activeTabId !== workspace.activeTabId || workspace.activeTabId === tabId) {
      activateManagedTab(workspaceKey, next.activeTabId);
    }
  },
  renameTab: (workspaceKey: string | null, tabId: string, label: string): void => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) return;
    updateWorkspaceState(workspaceKey, (current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === tabId && tab.label !== trimmedLabel ? { ...tab, label: trimmedLabel } : tab,
      ),
    }));
  },
  setBrowserTabMetadata: (
    workspaceKey: string | null,
    tabId: string,
    input: { readonly url: string; readonly title?: string | undefined },
  ): void => {
    const trimmedUrl = input.url.trim();
    if (!trimmedUrl) return;
    const label = tabLabelFromBrowserMetadata(trimmedUrl, input.title);
    const browserFaviconUrl = browserFaviconUrlFromUrl(trimmedUrl);
    updateWorkspaceState(workspaceKey, (current) => ({
      ...current,
      tabs: current.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== "browser") return tab;
        const nextTab: WorkbenchManagedTab = {
          ...tab,
          browserUrl: trimmedUrl,
          label,
          closable: tab.id === BROWSER_TAB_ID ? true : tab.closable,
          ...(browserFaviconUrl ? { browserFaviconUrl } : { browserFaviconUrl: undefined }),
        };
        return areTabsEqual(tab, nextTab) ? tab : nextTab;
      }),
    }));
  },
  moveTab: (workspaceKey: string | null, tabId: string, targetIndex: number): void => {
    updateWorkspaceState(workspaceKey, (current) => ({
      ...current,
      tabs: moveTabToIndex(current.tabs, tabId, targetIndex),
    }));
  },
};
