import {
  OPEN_CODE_LOCAL_SESSION_TARGET,
  createOpenCodeTargetedSession,
  createOpenCodeServer,
  openCodeLocationRef,
  openCodeSessionKey,
  openCodeSessionRef,
  openCodeSessionRefFromInfo,
  parseOpenCodeSessionKey,
  type OpenCodeClient,
  type OpenCodeLocationRef,
  type OpenCodePromptFileAttachment,
  type OpenCodeServerDescriptor,
  type OpenCodeServerKey,
  type OpenCodeSessionInfo,
  type OpenCodeSessionRef,
  type OpenCodeSessionTarget,
} from "@honk/opencode";
import { basename } from "@honk/shared/paths";
import type { TabDescriptor } from "@honk/ui";
import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import { getSnapshot as getAppSettings } from "./app-settings-store";
import { removeBrowserServer, removeBrowserSessions, requestBrowserOpen } from "./browser-store";
import { readDesktopBrowserAvailability, readShellWindowID } from "./desktop-bridge";
import { errorMessage } from "./error-message";
import { actions as modeActions, type ModeId } from "./modes";
import type { AppSessionSummary } from "./open-code-view";
import { createOpenCodeTabController, type OpenCodeTabController } from "./opencode/tab-controller";
import {
  openCodeDraftIDFromTabKey,
  openCodeDraftTabKey,
  openCodeSessionTabKey,
  openCodeTabSessionRef,
  openCodeTabKey,
  type OpenCodeDraftTab,
  type OpenCodeTabKey,
} from "./opencode/tab-model";
import {
  OPEN_CODE_HOME_TAB_KEY,
  openCodeTabDescriptors,
  type OpenCodeTabDescriptor,
  type OpenCodeTabPresentation,
  type OpenCodeTabPresentations,
} from "./opencode/tab-presentation";
import { openCodeWorkbenchToolHref, parseOpenCodeTabHref } from "./opencode/tab-route";
import { createOpenCodeWindowTabStore, type OpenCodeTabStorage } from "./opencode/tab-store";
import { sendSessionPrompt } from "./session-prompt";
import { actions as toastActions } from "./toast-store";
import { getBoundOpenCodeClient, getOpenCodeClient, subscribeSessionWatch } from "./watch-registry";

export type TabStatus = TabDescriptor["status"];
export type TabItem = OpenCodeTabDescriptor;
export type TabRepository = Extract<TabDescriptor, { kind: "thread" }>["repository"];

export type ReopenEntry = {
  readonly item: TabItem;
  readonly index: number;
};

export type OpenNewThreadInput = {
  readonly prompt?: string;
  readonly agent?: string;
  readonly mode?: ModeId;
  readonly model?: { readonly providerID: string; readonly id: string };
  readonly variant?: string;
  readonly server?: OpenCodeServerKey;
  readonly location?: OpenCodeLocationRef;
  readonly target?: OpenCodeSessionTarget;
  readonly directory?: string;
  readonly files?: readonly OpenCodePromptFileAttachment[];
};

export type OpenNewThreadOptions = {
  readonly replaceDraftKey?: string;
  // Close this tab once the new session opens; an empty session tab reads as a draft.
  readonly replaceSessionKey?: string;
};

type ThreadSummary = AppSessionSummary;

export type Snapshot = {
  readonly tabs: readonly TabItem[];
  readonly activeKey: string;
  readonly reopenStack: readonly ReopenEntry[];
};

type BoundRouter = {
  readonly subscribe: (
    eventType: "onResolved",
    listener: (event: { readonly toLocation: { readonly href: string } }) => void,
  ) => () => void;
  readonly navigate: (options: Record<string, unknown>) => unknown;
  readonly state: { readonly location: { readonly href: string } };
};

const tabStorage: OpenCodeTabStorage = Object.freeze({
  getItem(key) {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  },
  setItem(key, value) {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
});

const windowTabStore = createOpenCodeWindowTabStore({
  windowID: typeof window === "undefined" ? "browser" : readShellWindowID(),
  storage: tabStorage,
});
const listeners = new Set<() => void>();
const servers = new Map<OpenCodeServerKey, OpenCodeServerDescriptor>();
// Server home directories for ~-abbreviated preview paths. Fetched once per server, retried on the next server event when no client was connected yet.
let serverHomes: Readonly<Record<string, string>> = Object.freeze({});
const serverHomeLoads = new Set<OpenCodeServerKey>();
let presentations: OpenCodeTabPresentations = Object.freeze({});
let controller: OpenCodeTabController | null = null;
let browserAutomationOpenInstalled = false;
const retainedSessionWatches = new Map<string, () => void>();

rememberStateServers();
syncRetainedSessionWatches();
let snapshot = projectSnapshot();

windowTabStore.subscribe(() => {
  rememberStateServers();
  syncRetainedSessionWatches();
  publishProjection();
});

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): Snapshot {
  return snapshot;
}

export function getServerSnapshot(): Snapshot {
  return snapshot;
}

export function useTabs(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useTabsSelector<T>(
  selector: (current: Snapshot) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  return useSyncExternalStoreWithSelector(
    subscribe,
    getSnapshot,
    getServerSnapshot,
    selector,
    isEqual,
  );
}

export function useNewSessionDraft(key: string): OpenCodeDraftTab | null {
  return useSyncExternalStoreWithSelector(
    subscribe,
    () => windowTabStore.getSnapshot(),
    () => windowTabStore.getSnapshot(),
    (state) => {
      const draftID = openCodeDraftIDFromTabKey(key);
      if (draftID === null) return null;
      const tab = state.tabs.find(
        (candidate) => candidate.type === "draft" && candidate.draftID === draftID,
      );
      return tab?.type === "draft" ? tab : null;
    },
  );
}

export function bindRouter(router: BoundRouter): void {
  controller?.dispose();
  controller = createOpenCodeTabController({
    store: windowTabStore,
    navigator: {
      currentHref: () => router.state.location.href,
      navigate(href, options) {
        void router.navigate({ href, ...(options?.replace === true ? { replace: true } : {}) });
      },
      subscribe(listener) {
        return router.subscribe("onResolved", (event) => {
          listener(event.toLocation.href);
        });
      },
    },
    discardDrafts(draftIDs) {
      let next = presentations;
      for (const draftID of draftIDs) {
        next = withoutPresentation(next, openCodeDraftTabKey(draftID));
      }
      if (next !== presentations) {
        presentations = next;
        publishProjection();
      }
    },
  });
}

export function installBrowserAutomationOpenBridge(): void {
  if (browserAutomationOpenInstalled || typeof window === "undefined") return;
  const availability = readDesktopBrowserAvailability();
  if (availability.status !== "ready") return;
  browserAutomationOpenInstalled = true;
  availability.bridge.onBrowserAutomationOpen((request) => {
    const ref = sessionRefForInput(request.threadId);
    if (ref === null) return;
    requestBrowserOpen(ref, request.url);
    openCanonicalWorkbenchTool(ref, "browser");
  });
}

export const actions = {
  registerServer(server: OpenCodeServerDescriptor): void {
    rememberServer(server);
  },

  removeServer(server: OpenCodeServerKey): void {
    removeBrowserServer(server);
    if (controller === null) {
      windowTabStore.actions.removeServer(server);
    } else {
      controller.actions.removeServer(server);
    }
    if (servers.delete(server)) publishProjection();
  },

  removeSessions(server: OpenCodeServerKey, sessionIDs: readonly string[]): void {
    removeBrowserSessions(server, sessionIDs);
    if (controller === null) {
      windowTabStore.actions.removeSessions(server, sessionIDs);
    } else {
      controller.actions.removeSessions(server, sessionIDs);
    }
  },

  open(item: TabItem, options?: { readonly activate?: boolean }): void {
    if (item.kind === "home") {
      if (options?.activate !== false) showHome();
      return;
    }
    const stateTab = windowTabStore
      .getSnapshot()
      .tabs.find((candidate) => openCodeTabKey(candidate) === item.key);
    const ref =
      stateTab === undefined ? sessionRefForInput(item.key) : openCodeTabSessionRef(stateTab);
    if (ref === null) {
      showConnectionError("The OpenCode connection is not ready yet.");
      return;
    }
    rememberServerForRef(ref);
    setPresentation(openCodeSessionKey(ref), {
      title: item.title,
      status: item.status,
      repository: item.repository,
    });
    openSession(ref, options);
  },

  activate(key: string): void {
    if (key === OPEN_CODE_HOME_TAB_KEY) {
      showHome();
      return;
    }
    const resolved = resolveOpenTabKey(key);
    if (resolved === null) return;
    if (controller === null) {
      windowTabStore.actions.select(resolved);
    } else {
      controller.actions.activate(resolved);
    }
  },

  close(key: string): void {
    const resolved = resolveOpenTabKey(key);
    if (resolved === null) return;
    const closing = windowTabStore
      .getSnapshot()
      .tabs.find((candidate) => openCodeTabKey(candidate) === resolved);
    if (controller === null) {
      windowTabStore.actions.close(resolved);
    } else {
      controller.actions.close(resolved);
    }
    if (closing?.type === "session") {
      removeBrowserSessions(closing.server, [closing.sessionID]);
    }
  },

  closeActive(): void {
    const key = windowTabStore.getSnapshot().activeKey;
    if (key !== null) actions.close(key);
  },

  reorder(from: number, to: number): void {
    if (controller !== null) {
      controller.actions.reorder(from, to);
      return;
    }
    const fromIndex = Math.trunc(from) - 1;
    const toIndex = Math.trunc(to) - 1;
    const keys = windowTabStore.getSnapshot().tabs.map(openCodeTabKey);
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= keys.length ||
      toIndex >= keys.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [key] = keys.splice(fromIndex, 1);
    if (key === undefined) return;
    keys.splice(toIndex, 0, key);
    windowTabStore.actions.reorder(keys);
  },

  reopen(): void {
    if (controller === null) {
      windowTabStore.actions.reopenClosed();
    } else {
      controller.actions.reopenClosed();
    }
  },

  openDraft(input?: { readonly server?: OpenCodeServerKey; readonly directory?: string }): void {
    const client =
      input?.server === undefined ? getBoundOpenCodeClient() : getOpenCodeClient(input.server);
    if (client === null) {
      showConnectionError("The OpenCode connection is not ready yet.");
      return;
    }
    rememberServer(client.server);
    void openNewDraft(client, input?.directory);
  },

  openNew(input?: OpenNewThreadInput, options?: OpenNewThreadOptions): void {
    const client =
      input?.server === undefined ? getBoundOpenCodeClient() : getOpenCodeClient(input.server);
    if (client === null) {
      showConnectionError("The OpenCode connection is not ready yet.");
      return;
    }
    rememberServer(client.server);
    if (input === undefined) {
      void openNewDraft(client);
      return;
    }
    void createAndOpenThread(client, input.prompt ?? "", input, options);
  },

  openNewInWorkspace(key: string): void {
    const tab = snapshot.tabs.find((candidate) => candidate.key === key);
    const resolved = resolveOpenTabKey(key);
    const stateTab =
      resolved === null
        ? undefined
        : windowTabStore
            .getSnapshot()
            .tabs.find((candidate) => openCodeTabKey(candidate) === resolved);
    if (
      tab === undefined ||
      tab.kind === "home" ||
      tab.path === undefined ||
      stateTab === undefined
    ) {
      actions.openNew();
      return;
    }
    actions.openDraft({ server: stateTab.server, directory: tab.path });
  },

  closeWorkspaceTabs(key: string): void {
    const tab = snapshot.tabs.find((candidate) => candidate.key === key);
    if (tab === undefined || tab.kind === "home") {
      return;
    }
    const keys = snapshot.tabs
      .filter((candidate) => candidate.kind !== "home" && isSameWorkspace(candidate, tab))
      .map((candidate) => candidate.key);
    for (const candidateKey of keys) {
      actions.close(candidateKey);
    }
  },

  openSessionRoute(
    ref: OpenCodeSessionRef,
    href: string,
    options?: { readonly replace?: boolean },
  ): void {
    rememberServerForRef(ref);
    if (controller === null) {
      windowTabStore.actions.openSession(ref);
      windowTabStore.actions.rememberSessionRoute(ref, href);
      return;
    }
    controller.actions.openSessionRoute(ref, href, options);
  },

  setTabTitle(key: string, title: string): void {
    const resolved = resolveOpenTabKey(key);
    if (resolved !== null) setPresentation(resolved, { title });
  },

  // User rename. Optimistic locally, canonical on the server, reverted with a toast on failure.
  rename(key: string, title: string): void {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    const resolved = resolveOpenTabKey(key);
    if (resolved === null) return;
    const state = windowTabStore.getSnapshot();
    const stateTab = state.tabs.find((candidate) => openCodeTabKey(candidate) === resolved);
    const ref = stateTab === undefined ? null : openCodeTabSessionRef(stateTab);
    // Drafts have no session to rename. Their titles stay generated.
    if (ref === null) return;
    const sessionKey = openCodeSessionTabKey(ref);
    const previousTitle = presentations[sessionKey]?.title ?? state.info[sessionKey]?.title;
    if (trimmed === previousTitle) return;
    const client = getOpenCodeClient(ref.server);
    if (client === null) {
      showConnectionError("The OpenCode connection is not ready yet.");
      return;
    }
    const directory = state.info[sessionKey]?.directory;
    const remember = (value: string): void => {
      setPresentation(sessionKey, { title: value });
      if (directory !== undefined) {
        windowTabStore.actions.rememberSessionInfo(ref, {
          title: value,
          location: { directory },
        });
      }
    };
    remember(trimmed);
    void client.sessions.update(ref, { title: trimmed }).catch((error: unknown) => {
      if (previousTitle !== undefined) remember(previousTitle);
      const message = errorMessage(error);
      toastActions.add({
        type: "error",
        title: "Rename failed",
        description: message,
        copyableError: message,
      });
    });
  },

  setStatus(key: string, status: TabStatus): void {
    const resolved = resolveOpenTabKey(key);
    if (resolved !== null) setPresentation(resolved, { status });
  },

  setRepository(key: string, repository: TabRepository): void {
    const resolved = resolveOpenTabKey(key);
    if (resolved !== null) setPresentation(resolved, { repository });
  },

  updateDraftDirectory(key: string, directory: string): void {
    const draftID = openCodeDraftIDFromTabKey(key);
    if (draftID === null) return;
    const location = openCodeLocationRef({ directory });
    if (controller === null) {
      windowTabStore.actions.updateDraft(draftID, {
        location,
        target: OPEN_CODE_LOCAL_SESSION_TARGET,
      });
    } else {
      controller.actions.updateDraft(draftID, {
        location,
        target: OPEN_CODE_LOCAL_SESSION_TARGET,
      });
    }
  },

  updateDraftTarget(key: string, target: OpenCodeSessionTarget): void {
    const draftID = openCodeDraftIDFromTabKey(key);
    if (draftID === null) return;
    if (controller === null) {
      windowTabStore.actions.updateDraft(draftID, { target });
    } else {
      controller.actions.updateDraft(draftID, { target });
    }
  },

  syncWorkspace(
    threads: readonly ThreadSummary[],
    statusForSummary: (summary: ThreadSummary) => TabStatus,
  ): void {
    const client = getBoundOpenCodeClient();
    if (client !== null) rememberServer(client.server);
    const openSessionKeys = new Set<string>(
      windowTabStore.getSnapshot().tabs.flatMap((tab) => {
        const owner = openCodeTabSessionRef(tab);
        return owner === null ? [] : [openCodeSessionTabKey(owner)];
      }),
    );
    let nextPresentations: OpenCodeTabPresentations = presentations;
    for (const thread of threads) {
      const ref = openCodeSessionRef(thread.server, thread.id);
      const key = openCodeSessionTabKey(ref);
      if (!openSessionKeys.has(key)) continue;
      rememberServerKey(thread.server);
      const directory = thread.worktree?.path;
      nextPresentations = withPresentation(nextPresentations, key, {
        title: thread.title,
        status: statusForSummary(thread),
        repository:
          directory === undefined || directory === null
            ? { state: "loading" }
            : { state: "ready", label: basename(directory) },
      });
      if (directory !== undefined && directory !== null) {
        windowTabStore.actions.rememberSessionInfo(ref, {
          title: thread.title,
          location: { directory },
        });
      }
    }
    if (nextPresentations !== presentations) {
      presentations = nextPresentations;
      publishProjection();
    }
  },
} as const;

export function newSessionTabKey(draftID: string): string {
  return openCodeDraftTabKey(draftID);
}

export function sessionRefForTabKey(key: string): OpenCodeSessionRef | null {
  return sessionRefForInput(key);
}

export function sessionTabKey(sessionID: string): string | null {
  const ref = sessionRefForInput(sessionID);
  return ref === null ? null : openCodeSessionKey(ref);
}

function projectSnapshot(): Snapshot {
  const state = windowTabStore.getSnapshot();
  const descriptors = openCodeTabDescriptors({
    state,
    servers: [...servers.values()],
    presentations,
    homes: serverHomes,
  });
  const reopenStack = state.closed.map((entry): ReopenEntry => {
    const key = openCodeTabKey(entry.tab);
    const owner = openCodeTabSessionRef(entry.tab);
    const ownerKey = owner === null ? key : openCodeSessionTabKey(owner);
    const presentation = presentations[ownerKey];
    const repository: TabRepository = presentation?.repository ?? { state: "loading" };
    return Object.freeze({
      index: entry.index + 1,
      item: Object.freeze({
        key,
        kind: "thread",
        title: presentation?.title ?? "Loading session",
        status: presentation?.status ?? "idle",
        repository,
      }),
    });
  });
  return Object.freeze({
    tabs: descriptors,
    activeKey: state.activeKey ?? OPEN_CODE_HOME_TAB_KEY,
    reopenStack: Object.freeze(reopenStack),
  });
}

function publishProjection(): void {
  snapshot = projectSnapshot();
  for (const listener of listeners) listener();
}

function rememberStateServers(): void {
  const state = windowTabStore.getSnapshot();
  for (const tab of state.tabs) rememberServerKey(tab.server);
  for (const entry of state.closed) rememberServerKey(entry.tab.server);
}

function syncRetainedSessionWatches(): void {
  const tabState = windowTabStore.getSnapshot();
  const refs = new Map<string, OpenCodeSessionRef>();
  for (const tab of tabState.tabs) {
    const ref = openCodeTabSessionRef(tab);
    if (ref === null) continue;
    refs.set(openCodeSessionKey(ref), ref);
    const route = tabState.info[openCodeSessionTabKey(ref)]?.route;
    const parsed = route === undefined ? null : parseOpenCodeTabHref(route);
    if (parsed?.type !== "session") continue;
    if (parsed.workbench?.type === "side-chat") {
      const child = openCodeSessionRef(parsed.ref.server, parsed.workbench.sessionID);
      refs.set(openCodeSessionKey(child), child);
    }
  }

  for (const [key, release] of retainedSessionWatches) {
    if (refs.has(key)) continue;
    release();
    retainedSessionWatches.delete(key);
  }
  for (const [key, ref] of refs) {
    if (retainedSessionWatches.has(key)) continue;
    retainedSessionWatches.set(
      key,
      subscribeSessionWatch(ref, () => {}),
    );
  }
}

function rememberServerKey(key: OpenCodeServerKey): void {
  if (!servers.has(key)) servers.set(key, createOpenCodeServer({ origin: key }));
  ensureServerHome(key);
}

function ensureServerHome(key: OpenCodeServerKey): void {
  if (serverHomes[key] !== undefined || serverHomeLoads.has(key)) return;
  const client = getOpenCodeClient(key);
  if (client === null) return;
  serverHomeLoads.add(key);
  client
    .resolvePath()
    .then((path) => {
      serverHomes = Object.freeze({ ...serverHomes, [key]: path.home });
      publishProjection();
    })
    .catch(() => {
      // Preview paths stay unabbreviated. The next server event retries.
    })
    .finally(() => {
      serverHomeLoads.delete(key);
    });
}

function rememberServer(server: OpenCodeServerDescriptor): void {
  ensureServerHome(server.key);
  const previous = servers.get(server.key);
  if (
    previous?.origin === server.origin &&
    previous.label === server.label &&
    previous.kind === server.kind
  ) {
    return;
  }
  servers.set(server.key, server);
  publishProjection();
}

function rememberServerForRef(ref: OpenCodeSessionRef): void {
  const client = getBoundOpenCodeClient();
  if (client?.server.key === ref.server) {
    rememberServer(client.server);
  } else {
    rememberServerKey(ref.server);
  }
}

function sessionRefForInput(value: string): OpenCodeSessionRef | null {
  const parsed = parseOpenCodeSessionKey(value);
  if (parsed !== null) return parsed;

  const state = windowTabStore.getSnapshot();
  const exact = state.tabs.find((tab) => tab.type === "session" && openCodeTabKey(tab) === value);
  if (exact?.type === "session") return openCodeSessionRef(exact.server, exact.sessionID);

  const matching = state.tabs.filter((tab) => tab.type === "session" && tab.sessionID === value);
  const currentServer = getBoundOpenCodeClient()?.server.key;
  const current = matching.find((tab) => tab.type === "session" && tab.server === currentServer);
  if (current?.type === "session") return openCodeSessionRef(current.server, current.sessionID);
  const only = matching.length === 1 ? matching[0] : undefined;
  if (only?.type === "session") return openCodeSessionRef(only.server, only.sessionID);

  const client = getBoundOpenCodeClient();
  return client === null ? null : openCodeSessionRef(client.server.key, value);
}

function resolveOpenTabKey(value: string): OpenCodeTabKey | null {
  const exact = windowTabStore.getSnapshot().tabs.find((tab) => openCodeTabKey(tab) === value);
  if (exact !== undefined) return openCodeTabKey(exact);
  if (openCodeDraftIDFromTabKey(value) !== null) {
    const key = value as OpenCodeTabKey;
    return windowTabStore.getSnapshot().tabs.some((tab) => openCodeTabKey(tab) === key)
      ? key
      : null;
  }
  const ref = sessionRefForInput(value);
  if (ref === null) return null;
  const key = openCodeSessionTabKey(ref);
  return windowTabStore.getSnapshot().tabs.some((tab) => openCodeTabKey(tab) === key) ? key : null;
}

function openSession(ref: OpenCodeSessionRef, options?: { readonly activate?: boolean }): void {
  if (controller === null) {
    windowTabStore.actions.openSession(ref, options);
  } else {
    controller.actions.openSession(ref, options);
  }
}

function openCanonicalWorkbenchTool(
  ref: OpenCodeSessionRef,
  tool: "browser" | "changes",
  options?: { readonly activate?: boolean },
): void {
  const href = openCodeWorkbenchToolHref(ref, tool);
  if (controller === null) {
    windowTabStore.actions.openSession(ref, options);
    windowTabStore.actions.rememberSessionRoute(ref, href);
  } else {
    if (options?.activate === false) {
      windowTabStore.actions.openSession(ref, options);
      windowTabStore.actions.rememberSessionRoute(ref, href);
      return;
    }
    controller.actions.openSessionRoute(ref, href);
  }
}

function showHome(): void {
  if (controller === null) {
    windowTabStore.actions.showHome();
  } else {
    controller.actions.showHome();
  }
}

async function openNewDraft(client: OpenCodeClient, directory?: string): Promise<void> {
  const configuredDirectory = directory ?? getAppSettings().defaultProjectDirectory ?? undefined;
  try {
    const resolved = await client.resolveLocation(
      configuredDirectory === undefined ? undefined : { directory: configuredDirectory },
    );
    const input = {
      draftID: crypto.randomUUID(),
      server: client.server.key,
      location: openCodeLocationRef({ directory: resolved.project.directory }),
    };
    if (controller === null) {
      windowTabStore.actions.openDraft(input);
    } else {
      controller.actions.openDraft(input);
    }
  } catch (error) {
    const message = errorMessage(error);
    toastActions.add({
      type: "error",
      title: "New session failed",
      description: message,
      copyableError: message,
    });
  }
}

async function createAndOpenThread(
  client: OpenCodeClient,
  prompt: string,
  input: OpenNewThreadInput,
  options?: OpenNewThreadOptions,
): Promise<void> {
  const trimmedPrompt = prompt.trim();
  let summary: OpenCodeSessionInfo;
  try {
    const directory = input.directory ?? getAppSettings().defaultProjectDirectory ?? undefined;
    const source =
      input.location ??
      (directory === undefined
        ? openCodeLocationRef(await client.resolveLocation())
        : openCodeLocationRef({ directory }));
    summary = await createOpenCodeTargetedSession(client, {
      source,
      target: input.target ?? OPEN_CODE_LOCAL_SESSION_TARGET,
      ...(input.agent === undefined ? {} : { agent: input.agent }),
      ...(input.model === undefined
        ? {}
        : {
            model: {
              ...input.model,
              ...(input.variant === undefined ? {} : { variant: input.variant }),
            },
          }),
    });
  } catch (error) {
    const message = errorMessage(error);
    toastActions.add({
      type: "error",
      title: "New session failed",
      description: message,
      copyableError: message,
    });
    return;
  }

  const ref = openCodeSessionRefFromInfo(client.server.key, summary);
  const key = openCodeSessionKey(ref);
  setPresentation(key, {
    title: summary.title,
    status: "idle",
    repository: { state: "ready", label: basename(summary.location.directory) },
  });
  const draftID =
    options?.replaceDraftKey === undefined
      ? null
      : openCodeDraftIDFromTabKey(options.replaceDraftKey);
  if (draftID === null) {
    openSession(ref);
  } else if (controller === null) {
    windowTabStore.actions.promoteDraft(draftID, ref, summary);
  } else {
    controller.actions.promoteDraft(draftID, ref, summary);
  }
  if (options?.replaceSessionKey !== undefined && options.replaceSessionKey !== key) {
    actions.close(options.replaceSessionKey);
  }

  if (input.mode !== undefined && input.mode !== "build") {
    modeActions.setThreadMode(key, input.mode);
  }
  if (trimmedPrompt.length === 0 && (input.files === undefined || input.files.length === 0)) {
    return;
  }

  try {
    await sendSessionPrompt(client, ref.sessionID, {
      text: trimmedPrompt,
      ...(input.files === undefined || input.files.length === 0 ? {} : { files: input.files }),
    });
  } catch (error) {
    const message = errorMessage(error);
    toastActions.add({
      type: "error",
      title: "Send failed",
      description: message,
      copyableError: message,
      threadKey: key,
    });
  }
}

function setPresentation(key: string, update: OpenCodeTabPresentation): void {
  const next = withPresentation(presentations, key, update);
  if (next === presentations) return;
  presentations = next;
  publishProjection();
}

function withPresentation(
  source: OpenCodeTabPresentations,
  key: string,
  update: OpenCodeTabPresentation,
): OpenCodeTabPresentations {
  const current = source[key];
  const next = Object.freeze({ ...current, ...update });
  if (
    current?.title === next.title &&
    current?.status === next.status &&
    repositoriesEqual(current?.repository, next.repository)
  ) {
    return source;
  }
  return Object.freeze({ ...source, [key]: next });
}

function withoutPresentation(
  source: OpenCodeTabPresentations,
  key: string,
): OpenCodeTabPresentations {
  if (source[key] === undefined) return source;
  const next: Record<string, OpenCodeTabPresentation> = {};
  for (const [candidate, presentation] of Object.entries(source)) {
    if (candidate !== key) next[candidate] = presentation;
  }
  return Object.freeze(next);
}

function repositoriesEqual(
  left: TabRepository | undefined,
  right: TabRepository | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined || left.state !== right.state) return false;
  return left.state !== "ready" || (right.state === "ready" && left.label === right.label);
}

function isSameWorkspace(
  left: Exclude<TabDescriptor, { readonly kind: "home" }>,
  right: Exclude<TabDescriptor, { readonly kind: "home" }>,
): boolean {
  const leftServer =
    left.server === undefined ? "default" : `${left.server.kind}:${left.server.label}`;
  const rightServer =
    right.server === undefined ? "default" : `${right.server.kind}:${right.server.label}`;
  if (leftServer !== rightServer) {
    return false;
  }
  const leftPath = left.path ?? `${left.repository.state}:${left.key}`;
  const rightPath = right.path ?? `${right.repository.state}:${right.key}`;
  return leftPath === rightPath;
}

function showConnectionError(description: string): void {
  toastActions.add({ type: "error", title: "Not connected", description });
}
