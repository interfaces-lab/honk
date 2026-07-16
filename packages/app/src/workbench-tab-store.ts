import { openCodeSessionKey, openCodeSessionRef, type OpenCodeSessionRef } from "@honk/opencode";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import { BROWSER_AUTOMATION_RESOURCE_ID } from "./browser-store";
import { isWorkbenchTool, type OpenCodeWorkbenchToolKind } from "./opencode/tab-route";

type WorkbenchOwnedToolTab =
  | {
      readonly id: "changes";
      readonly kind: "changes";
      readonly owner: OpenCodeSessionRef;
    }
  | {
      readonly id: "tasks";
      readonly kind: "tasks";
      readonly owner: OpenCodeSessionRef;
    };

type WorkbenchFilesTab = {
  readonly id: string;
  readonly kind: "files";
  /** `null` is the workspace tree; a path identifies a future file-editor tab. */
  readonly filePath: string | null;
};

type WorkbenchTerminalTab = {
  readonly id: string;
  readonly kind: "terminal";
  readonly owner: OpenCodeSessionRef;
  readonly terminalID: string;
};

type WorkbenchBrowserTab = {
  readonly id: string;
  readonly kind: "browser";
  readonly owner: OpenCodeSessionRef;
  readonly browserID: string;
};

type WorkbenchSideChatTab = {
  readonly id: string;
  readonly kind: "side-chat";
  readonly parent: OpenCodeSessionRef;
  readonly child: OpenCodeSessionRef;
  readonly label: string;
};

type WorkbenchTab =
  | WorkbenchOwnedToolTab
  | WorkbenchFilesTab
  | WorkbenchTerminalTab
  | WorkbenchBrowserTab
  | WorkbenchSideChatTab;

type WorkbenchWorkspaceTabs = {
  readonly tabs: readonly WorkbenchTab[];
  readonly sideChats: readonly WorkbenchSideChatTab[];
  readonly activeTabID: string | null;
  readonly expanded: boolean;
};

type WorkbenchTabStoreSnapshot = {
  readonly byWorkspace: Readonly<Record<string, WorkbenchWorkspaceTabs>>;
};

type WorkbenchRouteTarget =
  | { readonly type: "tab"; readonly tabID: string }
  | { readonly type: "side-chat"; readonly sessionID: string };

type WorkbenchTabStoreOptions = {
  readonly createID?: () => string;
};

type WorkbenchTabCloseResult = {
  readonly closed: WorkbenchTab | null;
  readonly activeTabID: string | null;
};

type WorkbenchTabStore = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => WorkbenchTabStoreSnapshot;
  readonly getWorkspace: (workspaceKey: string) => WorkbenchWorkspaceTabs;
  readonly actions: {
    readonly ensureTool: (
      workspaceKey: string,
      kind: WorkbenchOwnedToolTab["kind"],
      owner: OpenCodeSessionRef,
    ) => WorkbenchOwnedToolTab;
    readonly ensureRoute: (
      workspaceKey: string,
      target: WorkbenchRouteTarget,
      owner: OpenCodeSessionRef,
    ) => WorkbenchTab;
    readonly openTool: (
      workspaceKey: string,
      kind: OpenCodeWorkbenchToolKind,
      owner: OpenCodeSessionRef,
      options?: { readonly newInstance?: boolean },
    ) => WorkbenchTab;
    readonly openSideChat: (
      workspaceKey: string,
      parent: OpenCodeSessionRef,
      child: OpenCodeSessionRef,
      label?: string,
    ) => WorkbenchSideChatTab;
    readonly rememberSideChat: (
      workspaceKey: string,
      parent: OpenCodeSessionRef,
      child: OpenCodeSessionRef,
      label?: string,
    ) => WorkbenchSideChatTab;
    readonly activate: (workspaceKey: string, tabID: string) => WorkbenchTab | null;
    readonly setExpanded: (workspaceKey: string, expanded: boolean) => void;
    readonly close: (workspaceKey: string, tabID: string) => WorkbenchTabCloseResult;
  };
};

const EMPTY_WORKSPACE: WorkbenchWorkspaceTabs = Object.freeze({
  tabs: Object.freeze([]),
  sideChats: Object.freeze([]),
  activeTabID: null,
  expanded: false,
});

function createWorkbenchTabStore(options: WorkbenchTabStoreOptions = {}): WorkbenchTabStore {
  const listeners = new Set<() => void>();
  const createID = options.createID ?? randomID;
  let snapshot = freezeSnapshot({});

  const publishWorkspace = (workspaceKey: string, workspace: WorkbenchWorkspaceTabs): void => {
    const current = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
    if (workspace === current) return;
    snapshot = freezeSnapshot({ ...snapshot.byWorkspace, [workspaceKey]: workspace });
    for (const listener of listeners) listener();
  };

  const actions: WorkbenchTabStore["actions"] = {
    ensureTool(workspaceKey, kind, owner) {
      const workspace = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
      const existing = workspace.tabs.find(
        (tab): tab is WorkbenchOwnedToolTab => tab.kind === kind,
      );
      if (existing !== undefined && sameRef(existing.owner, owner)) return existing;

      const tab = createOwnedToolTab(kind, owner);
      const tabs =
        existing === undefined ? [...workspace.tabs, tab] : replaceTab(workspace.tabs, tab);
      publishWorkspace(
        workspaceKey,
        freezeWorkspace(tabs, workspace.sideChats, workspace.activeTabID, workspace.expanded),
      );
      return tab;
    },
    ensureRoute(workspaceKey, target, owner) {
      const workspace = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
      if (target.type === "side-chat") {
        const child = openCodeSessionRef(owner.server, target.sessionID);
        const result = openSideChatTab(workspace, owner, child, true);
        publishWorkspace(workspaceKey, result.workspace);
        return result.tab;
      }

      if (isWorkbenchTool(target.tabID)) {
        const result = openToolTab(workspace, target.tabID, owner, false, createID);
        publishWorkspace(workspaceKey, result.workspace);
        return result.tab;
      }
      const exact = workspace.tabs.find((tab) => tab.id === target.tabID);
      if (exact !== undefined) {
        const next = activateTab(workspace, exact.id);
        publishWorkspace(workspaceKey, next);
        return exact;
      }
      const deepLinked = tabFromDeepLink(target.tabID, owner, createID);
      if (deepLinked !== null) {
        const next = freezeWorkspace(
          [...workspace.tabs, deepLinked],
          workspace.sideChats,
          deepLinked.id,
          true,
        );
        publishWorkspace(workspaceKey, next);
        return deepLinked;
      }

      const fallback = openToolTab(workspace, "changes", owner, false, createID);
      publishWorkspace(workspaceKey, fallback.workspace);
      return fallback.tab;
    },
    openTool(workspaceKey, kind, owner, actionOptions) {
      const workspace = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
      const result = openToolTab(
        workspace,
        kind,
        owner,
        actionOptions?.newInstance === true,
        createID,
      );
      publishWorkspace(workspaceKey, result.workspace);
      return result.tab;
    },
    openSideChat(workspaceKey, parent, child, label) {
      const workspace = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
      const result = openSideChatTab(workspace, parent, child, true, label);
      publishWorkspace(workspaceKey, result.workspace);
      return result.tab;
    },
    rememberSideChat(workspaceKey, parent, child, label) {
      const workspace = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
      const result = openSideChatTab(workspace, parent, child, false, label);
      publishWorkspace(workspaceKey, result.workspace);
      return result.tab;
    },
    activate(workspaceKey, tabID) {
      const workspace = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
      const tab = workspace.tabs.find((candidate) => candidate.id === tabID) ?? null;
      if (tab === null) return null;
      publishWorkspace(workspaceKey, activateTab(workspace, tabID));
      return tab;
    },
    setExpanded(workspaceKey, expanded) {
      const workspace = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
      if (workspace.expanded === expanded || (expanded && workspace.activeTabID === null)) return;
      publishWorkspace(
        workspaceKey,
        freezeWorkspace(workspace.tabs, workspace.sideChats, workspace.activeTabID, expanded),
      );
    },
    close(workspaceKey, tabID) {
      const workspace = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
      const index = workspace.tabs.findIndex((tab) => tab.id === tabID);
      const closed = index < 0 ? null : (workspace.tabs[index] ?? null);
      if (closed === null) {
        return Object.freeze({ closed: null, activeTabID: workspace.activeTabID });
      }
      const tabs = workspace.tabs.filter((tab) => tab.id !== tabID);
      const activeTabID =
        workspace.activeTabID !== tabID
          ? workspace.activeTabID
          : (tabs[Math.min(index, tabs.length - 1)]?.id ?? null);
      publishWorkspace(
        workspaceKey,
        freezeWorkspace(
          tabs,
          workspace.sideChats,
          activeTabID,
          activeTabID === null ? false : workspace.expanded,
        ),
      );
      return Object.freeze({ closed, activeTabID });
    },
  };

  return Object.freeze({
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getWorkspace: (workspaceKey) => snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE,
    actions: Object.freeze(actions),
  });
}

function openToolTab(
  workspace: WorkbenchWorkspaceTabs,
  kind: OpenCodeWorkbenchToolKind,
  owner: OpenCodeSessionRef,
  newInstance: boolean,
  createID: () => string,
): { readonly workspace: WorkbenchWorkspaceTabs; readonly tab: WorkbenchTab } {
  const existing = reusableToolTab(workspace, kind, newInstance);
  if (existing !== null) {
    const tab =
      (existing.kind === "changes" || existing.kind === "tasks") && !sameRef(existing.owner, owner)
        ? Object.freeze({ ...existing, owner: openCodeSessionRef(owner.server, owner.sessionID) })
        : existing;
    const tabs = tab === existing ? workspace.tabs : replaceTab(workspace.tabs, tab);
    return Object.freeze({
      workspace: freezeWorkspace(tabs, workspace.sideChats, tab.id, true),
      tab,
    });
  }

  const tab = createToolTab(kind, owner, createID());
  return Object.freeze({
    workspace: freezeWorkspace([...workspace.tabs, tab], workspace.sideChats, tab.id, true),
    tab,
  });
}

function reusableToolTab(
  workspace: WorkbenchWorkspaceTabs,
  kind: OpenCodeWorkbenchToolKind,
  newInstance: boolean,
): WorkbenchTab | null {
  if (newInstance && (kind === "terminal" || kind === "browser")) return null;
  const active = workspace.tabs.find(
    (tab) => tab.id === workspace.activeTabID && tab.kind === kind,
  );
  return active ?? workspace.tabs.find((tab) => tab.kind === kind) ?? null;
}

function createToolTab(
  kind: OpenCodeWorkbenchToolKind,
  owner: OpenCodeSessionRef,
  resourceID: string,
): WorkbenchTab {
  if (kind === "changes" || kind === "tasks") return createOwnedToolTab(kind, owner);
  if (kind === "files") {
    return Object.freeze({ id: "files", kind, filePath: null });
  }
  const normalizedOwner = openCodeSessionRef(owner.server, owner.sessionID);
  if (kind === "terminal") {
    return Object.freeze({
      id: `terminal:${encodeURIComponent(resourceID)}`,
      kind,
      owner: normalizedOwner,
      terminalID: resourceID,
    });
  }
  return Object.freeze({
    id: browserTabID(normalizedOwner, resourceID),
    kind,
    owner: normalizedOwner,
    browserID: resourceID,
  });
}

function createOwnedToolTab(
  kind: WorkbenchOwnedToolTab["kind"],
  owner: OpenCodeSessionRef,
): WorkbenchOwnedToolTab {
  const normalizedOwner = openCodeSessionRef(owner.server, owner.sessionID);
  if (kind === "changes") {
    return Object.freeze({ id: "changes", kind, owner: normalizedOwner });
  }
  return Object.freeze({ id: "tasks", kind, owner: normalizedOwner });
}

function openSideChatTab(
  workspace: WorkbenchWorkspaceTabs,
  parent: OpenCodeSessionRef,
  child: OpenCodeSessionRef,
  activate: boolean,
  label = "New Side Chat",
): { readonly workspace: WorkbenchWorkspaceTabs; readonly tab: WorkbenchSideChatTab } {
  const id = sideChatTabID(child);
  const open = workspace.tabs.find(
    (tab): tab is WorkbenchSideChatTab => tab.kind === "side-chat" && tab.id === id,
  );
  if (open !== undefined) {
    return Object.freeze({
      workspace: activate ? activateTab(workspace, id) : workspace,
      tab: open,
    });
  }
  const known = workspace.sideChats.find((tab) => tab.id === id);
  const tab: WorkbenchSideChatTab =
    known ??
    Object.freeze({
      id,
      kind: "side-chat",
      parent: openCodeSessionRef(parent.server, parent.sessionID),
      child: openCodeSessionRef(child.server, child.sessionID),
      label: label.trim() || "New Side Chat",
    });
  const sideChats = known === undefined ? [...workspace.sideChats, tab] : workspace.sideChats;
  return Object.freeze({
    workspace: activate
      ? freezeWorkspace([...workspace.tabs, tab], sideChats, tab.id, true)
      : freezeWorkspace(workspace.tabs, sideChats, workspace.activeTabID, workspace.expanded),
    tab,
  });
}

function tabFromDeepLink(
  tabID: string,
  owner: OpenCodeSessionRef,
  createID: () => string,
): WorkbenchTab | null {
  if (tabID.startsWith("terminal:")) {
    const terminalID = decodeResourceID(tabID.slice("terminal:".length));
    return terminalID === null
      ? null
      : Object.freeze({
          id: tabID,
          kind: "terminal",
          owner: openCodeSessionRef(owner.server, owner.sessionID),
          terminalID,
        });
  }
  if (tabID.startsWith("browser:")) {
    const prefix = `browser:${encodeURIComponent(openCodeSessionKey(owner))}:`;
    if (!tabID.startsWith(prefix)) return null;
    const encodedResource = tabID.slice(prefix.length);
    const decoded = decodeResourceID(encodedResource);
    const browserID = decoded === BROWSER_AUTOMATION_RESOURCE_ID ? createID() : decoded;
    return browserID === null
      ? null
      : Object.freeze({
          id: browserTabID(owner, browserID),
          kind: "browser",
          owner: openCodeSessionRef(owner.server, owner.sessionID),
          browserID,
        });
  }
  return null;
}

function activateTab(workspace: WorkbenchWorkspaceTabs, tabID: string): WorkbenchWorkspaceTabs {
  return workspace.activeTabID === tabID && workspace.expanded
    ? workspace
    : freezeWorkspace(workspace.tabs, workspace.sideChats, tabID, true);
}

function replaceTab(
  tabs: readonly WorkbenchTab[],
  replacement: WorkbenchTab,
): readonly WorkbenchTab[] {
  return tabs.map((tab) => (tab.id === replacement.id ? replacement : tab));
}

function sideChatTabID(child: OpenCodeSessionRef): string {
  return `side-chat:${encodeURIComponent(openCodeSessionKey(child))}`;
}

function browserTabID(owner: OpenCodeSessionRef, browserID: string): string {
  return `browser:${encodeURIComponent(openCodeSessionKey(owner))}:${encodeURIComponent(browserID)}`;
}

function sameRef(left: OpenCodeSessionRef, right: OpenCodeSessionRef): boolean {
  return left.server === right.server && left.sessionID === right.sessionID;
}

function decodeResourceID(value: string): string | null {
  if (value.length === 0) return null;
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded.length === 0 ? null : decoded;
  } catch {
    return null;
  }
}

function freezeWorkspace(
  tabs: readonly WorkbenchTab[],
  sideChats: readonly WorkbenchSideChatTab[],
  activeTabID: string | null,
  expanded = false,
): WorkbenchWorkspaceTabs {
  const resolvedActive =
    activeTabID !== null && tabs.some((tab) => tab.id === activeTabID) ? activeTabID : null;
  return Object.freeze({
    tabs: Object.freeze([...tabs]),
    sideChats: Object.freeze([...sideChats]),
    activeTabID: resolvedActive,
    expanded: resolvedActive !== null && expanded,
  });
}

function freezeSnapshot(
  byWorkspace: Readonly<Record<string, WorkbenchWorkspaceTabs>>,
): WorkbenchTabStoreSnapshot {
  return Object.freeze({ byWorkspace: Object.freeze({ ...byWorkspace }) });
}

function randomID(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const workbenchTabStore = createWorkbenchTabStore();

function useWorkbenchTabs(workspaceKey: string): WorkbenchWorkspaceTabs {
  return useSyncExternalStoreWithSelector(
    workbenchTabStore.subscribe,
    workbenchTabStore.getSnapshot,
    workbenchTabStore.getSnapshot,
    (snapshot) => snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE,
  );
}

const workbenchTabActions = workbenchTabStore.actions;

export {
  browserTabID,
  createWorkbenchTabStore,
  sideChatTabID,
  useWorkbenchTabs,
  workbenchTabActions,
};
export type {
  WorkbenchBrowserTab,
  WorkbenchRouteTarget,
  WorkbenchSideChatTab,
  WorkbenchTab,
  WorkbenchTabCloseResult,
  WorkbenchTabStore,
  WorkbenchTabStoreOptions,
  WorkbenchTerminalTab,
  WorkbenchWorkspaceTabs,
};
