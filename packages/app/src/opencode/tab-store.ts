import type {
  OpenCodeServerKey,
  OpenCodeSessionRef,
  OpenCodeLocationRef,
  OpenCodeSessionTarget,
  OpenCodeSessionInfo,
} from "@honk/opencode";

import {
  addOpenCodeDraftTab,
  addOpenCodeSessionTab,
  closeOpenCodeTab,
  hydrateOpenCodeTabState,
  promoteOpenCodeDraft,
  rememberOpenCodeSessionInfo,
  rememberOpenCodeSessionRoute,
  removeOpenCodeServer,
  removeOpenCodeSessions,
  reorderOpenCodeTabs,
  reopenClosedOpenCodeTab,
  selectOpenCodeTab,
  serializeOpenCodeTabState,
  showOpenCodeHome,
  toggleOpenCodeHome,
  updateOpenCodeDraftTab,
  type OpenCodeDraftInput,
  type OpenCodeTabKey,
  type OpenCodeTabState,
  type OpenCodeTabTransition,
} from "./tab-model";

const OPEN_CODE_WINDOW_TAB_STORAGE_PREFIX = "honk:opencode:window-tabs:";

type OpenCodeTabStorage = {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
};

type OpenCodeWindowTabStoreOptions = {
  /** Desktop uses its window UUID. Web uses `browser`. */
  readonly windowID: string;
  readonly storage: OpenCodeTabStorage;
};

type OpenCodeWindowTabActions = {
  readonly openSession: (
    ref: OpenCodeSessionRef,
    options?: { readonly activate?: boolean },
  ) => void;
  readonly openDraft: (
    input: OpenCodeDraftInput,
    options?: { readonly activate?: boolean },
  ) => void;
  readonly updateDraft: (
    draftID: string,
    update: {
      readonly server?: OpenCodeServerKey;
      readonly location?: OpenCodeLocationRef;
      readonly target?: OpenCodeSessionTarget;
    },
  ) => void;
  readonly select: (key: OpenCodeTabKey) => void;
  readonly showHome: () => void;
  readonly toggleHome: () => void;
  readonly reorder: (keys: readonly OpenCodeTabKey[]) => void;
  readonly close: (key: OpenCodeTabKey) => readonly string[];
  readonly reopenClosed: () => void;
  readonly promoteDraft: (
    draftID: string,
    ref: OpenCodeSessionRef,
    session?: Pick<OpenCodeSessionInfo, "title" | "location">,
  ) => readonly string[];
  readonly removeSessions: (server: OpenCodeServerKey, sessionIDs: readonly string[]) => void;
  readonly removeServer: (server: OpenCodeServerKey) => readonly string[];
  readonly rememberSessionInfo: (
    ref: OpenCodeSessionRef,
    session: Pick<OpenCodeSessionInfo, "title" | "location">,
  ) => void;
  readonly rememberSessionRoute: (ref: OpenCodeSessionRef, route: string) => void;
};

type OpenCodeWindowTabStore = {
  readonly windowID: string;
  readonly storageKey: string;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => OpenCodeTabState;
  readonly actions: OpenCodeWindowTabActions;
};

function openCodeWindowTabStorageKey(windowID: string): string {
  const value = requireWindowID(windowID);
  return `${OPEN_CODE_WINDOW_TAB_STORAGE_PREFIX}${encodeURIComponent(value)}`;
}

function createOpenCodeWindowTabStore(
  options: OpenCodeWindowTabStoreOptions,
): OpenCodeWindowTabStore {
  const windowID = requireWindowID(options.windowID);
  const storageKey = openCodeWindowTabStorageKey(windowID);
  const listeners = new Set<() => void>();
  let snapshot = readSnapshot(options.storage, storageKey);

  function publish(next: OpenCodeTabState): void {
    if (next === snapshot) return;
    snapshot = next;
    writeSnapshot(options.storage, storageKey, snapshot);
    for (const listener of listeners) listener();
  }

  function applyTransition(result: OpenCodeTabTransition): readonly string[] {
    publish(result.state);
    return result.discardedDraftIDs;
  }

  const actions: OpenCodeWindowTabActions = {
    openSession(ref, actionOptions) {
      publish(addOpenCodeSessionTab(snapshot, ref, actionOptions));
    },
    openDraft(input, actionOptions) {
      publish(addOpenCodeDraftTab(snapshot, input, actionOptions));
    },
    updateDraft(draftID, update) {
      publish(updateOpenCodeDraftTab(snapshot, draftID, update));
    },
    select(key) {
      publish(selectOpenCodeTab(snapshot, key));
    },
    showHome() {
      publish(showOpenCodeHome(snapshot));
    },
    toggleHome() {
      publish(toggleOpenCodeHome(snapshot));
    },
    reorder(keys) {
      publish(reorderOpenCodeTabs(snapshot, keys));
    },
    close(key) {
      return applyTransition(closeOpenCodeTab(snapshot, key));
    },
    reopenClosed() {
      applyTransition(reopenClosedOpenCodeTab(snapshot));
    },
    promoteDraft(draftID, ref, session) {
      return applyTransition(promoteOpenCodeDraft(snapshot, draftID, ref, session));
    },
    removeSessions(server, sessionIDs) {
      applyTransition(removeOpenCodeSessions(snapshot, server, sessionIDs));
    },
    removeServer(server) {
      return applyTransition(removeOpenCodeServer(snapshot, server));
    },
    rememberSessionInfo(ref, session) {
      publish(rememberOpenCodeSessionInfo(snapshot, ref, session));
    },
    rememberSessionRoute(ref, route) {
      publish(rememberOpenCodeSessionRoute(snapshot, ref, route));
    },
  };

  return Object.freeze({
    windowID,
    storageKey,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    actions: Object.freeze(actions),
  });
}

function readSnapshot(storage: OpenCodeTabStorage, key: string): OpenCodeTabState {
  try {
    return hydrateOpenCodeTabState(storage.getItem(key));
  } catch {
    return hydrateOpenCodeTabState(null);
  }
}

function writeSnapshot(storage: OpenCodeTabStorage, key: string, snapshot: OpenCodeTabState): void {
  try {
    storage.setItem(key, serializeOpenCodeTabState(snapshot));
  } catch {
    // A storage failure must not break the live tab model.
  }
}

function requireWindowID(windowID: string): string {
  const value = windowID.trim();
  if (value.length === 0) {
    throw new Error("A stable window ID is required for OpenCode tab persistence.");
  }
  return value;
}

export {
  OPEN_CODE_WINDOW_TAB_STORAGE_PREFIX,
  createOpenCodeWindowTabStore,
  openCodeWindowTabStorageKey,
};
export type {
  OpenCodeTabStorage,
  OpenCodeWindowTabActions,
  OpenCodeWindowTabStore,
  OpenCodeWindowTabStoreOptions,
};
