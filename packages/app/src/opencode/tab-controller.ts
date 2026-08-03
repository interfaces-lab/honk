import type {
  OpenCodeServerKey,
  OpenCodeSessionRef,
  OpenCodeLocationRef,
  OpenCodeSessionTarget,
  OpenCodeSessionInfo,
} from "@honk/opencode";

import {
  openCodeSessionTabKey,
  openCodeTabKey,
  type OpenCodeDraftInput,
  type OpenCodeTab,
  type OpenCodeTabKey,
} from "./tab-model";
import { openCodeTabHref, parseOpenCodeTabHref } from "./tab-route";
import type { OpenCodeWindowTabStore } from "./tab-store";

type OpenCodeTabNavigator = {
  readonly currentHref: () => string;
  readonly navigate: (
    href: string,
    options?: { readonly replace?: boolean },
  ) => void | Promise<void>;
  readonly subscribe: (listener: (href: string) => void) => () => void;
};

type OpenCodeTabControllerOptions = {
  readonly store: OpenCodeWindowTabStore;
  readonly navigator: OpenCodeTabNavigator;
  readonly discardDrafts?: (draftIDs: readonly string[]) => void;
};

type OpenCodeTabControllerActions = {
  readonly openSession: (
    ref: OpenCodeSessionRef,
    options?: { readonly activate?: boolean },
  ) => void;
  readonly openSessionRoute: (
    ref: OpenCodeSessionRef,
    href: string,
    options?: { readonly replace?: boolean },
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
  readonly activate: (key: OpenCodeTabKey) => void;
  readonly showHome: () => void;
  readonly toggleHome: () => void;
  /** Home is index 0 in TabStrip and absent from persisted tabs. */
  readonly reorder: (from: number, to: number) => void;
  readonly close: (key: OpenCodeTabKey) => void;
  readonly reopenClosed: () => void;
  readonly promoteDraft: (
    draftID: string,
    ref: OpenCodeSessionRef,
    session?: Pick<OpenCodeSessionInfo, "title" | "location">,
  ) => void;
  readonly removeSessions: (server: OpenCodeServerKey, sessionIDs: readonly string[]) => void;
  readonly removeServer: (server: OpenCodeServerKey) => void;
  readonly rememberSessionInfo: (
    ref: OpenCodeSessionRef,
    session: Pick<OpenCodeSessionInfo, "title" | "location">,
  ) => void;
};

type OpenCodeTabController = {
  readonly actions: OpenCodeTabControllerActions;
  readonly dispose: () => void;
};

function createOpenCodeTabController(options: OpenCodeTabControllerOptions): OpenCodeTabController {
  const { navigator, store } = options;

  function discardDrafts(draftIDs: readonly string[]): void {
    if (draftIDs.length > 0) options.discardDrafts?.(draftIDs);
  }

  function navigateTo(tab: OpenCodeTab | null, replace = false): void {
    const href = tab === null ? "/" : (rememberedHref(tab) ?? openCodeTabHref(tab));
    void navigator.navigate(href, replace ? { replace: true } : undefined);
  }

  function rememberedHref(tab: OpenCodeTab): string | null {
    if (tab.type !== "session") return null;
    const ref: OpenCodeSessionRef = { server: tab.server, sessionID: tab.sessionID };
    const href = store.getSnapshot().info[openCodeSessionTabKey(ref)]?.route;
    return href !== undefined && isSessionRouteForRef(href, ref) ? href : null;
  }

  function isSessionRouteForRef(href: string, ref: OpenCodeSessionRef): boolean {
    const route = parseOpenCodeTabHref(href);
    return (
      route?.type === "session" &&
      route.ref.server === ref.server &&
      route.ref.sessionID === ref.sessionID
    );
  }

  function activeTab(): OpenCodeTab | null {
    const snapshot = store.getSnapshot();
    if (snapshot.activeKey === null) return null;
    return snapshot.tabs.find((tab) => openCodeTabKey(tab) === snapshot.activeKey) ?? null;
  }

  function navigateToActive(replace = false): void {
    navigateTo(activeTab(), replace);
  }

  function syncFromRoute(href: string): void {
    const route = parseOpenCodeTabHref(href);
    if (route === null) return;
    if (route.type === "home") {
      store.actions.showHome();
      return;
    }
    if (route.type === "session") {
      store.actions.openSession(route.ref);
      store.actions.rememberSessionRoute(route.ref, href);
      return;
    }
    const draft = store
      .getSnapshot()
      .tabs.find((tab) => tab.type === "draft" && tab.draftID === route.draftID);
    if (draft === undefined) {
      store.actions.showHome();
      navigateTo(null, true);
      return;
    }
    store.actions.select(openCodeTabKey(draft));
  }

  const unsubscribe = navigator.subscribe(syncFromRoute);
  const initialRoute = parseOpenCodeTabHref(navigator.currentHref());
  if (initialRoute?.type === "home" && store.getSnapshot().activeKey !== null) {
    navigateToActive(true);
  } else {
    syncFromRoute(navigator.currentHref());
  }

  const actions: OpenCodeTabControllerActions = {
    openSession(ref, actionOptions) {
      store.actions.openSession(ref, actionOptions);
      if (actionOptions?.activate !== false) navigateToActive();
    },
    openSessionRoute(ref, href, actionOptions) {
      if (!isSessionRouteForRef(href, ref)) {
        throw new Error("The OpenCode route does not belong to this session.");
      }
      store.actions.openSession(ref);
      store.actions.rememberSessionRoute(ref, href);
      void navigator.navigate(
        href,
        actionOptions?.replace === true ? { replace: true } : undefined,
      );
    },
    openDraft(input, actionOptions) {
      store.actions.openDraft(input, actionOptions);
      if (actionOptions?.activate !== false) navigateToActive();
    },
    updateDraft(draftID, update) {
      store.actions.updateDraft(draftID, update);
    },
    activate(key) {
      store.actions.select(key);
      navigateToActive();
    },
    showHome() {
      store.actions.showHome();
      navigateTo(null);
    },
    toggleHome() {
      store.actions.toggleHome();
      navigateToActive();
    },
    reorder(from, to) {
      const fromIndex = Math.trunc(from) - 1;
      const toIndex = Math.trunc(to) - 1;
      const keys = store.getSnapshot().tabs.map(openCodeTabKey);
      if (
        fromIndex < 0 ||
        fromIndex >= keys.length ||
        toIndex < 0 ||
        toIndex >= keys.length ||
        fromIndex === toIndex
      ) {
        return;
      }
      const [key] = keys.splice(fromIndex, 1);
      if (key === undefined) return;
      keys.splice(toIndex, 0, key);
      store.actions.reorder(keys);
    },
    close(key) {
      const previousActiveKey = store.getSnapshot().activeKey;
      discardDrafts(store.actions.close(key));
      if (store.getSnapshot().activeKey !== previousActiveKey) navigateToActive();
    },
    reopenClosed() {
      const previousActiveKey = store.getSnapshot().activeKey;
      store.actions.reopenClosed();
      if (store.getSnapshot().activeKey !== previousActiveKey) navigateToActive();
    },
    promoteDraft(draftID, ref, session) {
      const previousActiveKey = store.getSnapshot().activeKey;
      discardDrafts(store.actions.promoteDraft(draftID, ref, session));
      if (store.getSnapshot().activeKey !== previousActiveKey) navigateToActive(true);
    },
    removeSessions(server, sessionIDs) {
      const previousActiveKey = store.getSnapshot().activeKey;
      store.actions.removeSessions(server, sessionIDs);
      if (store.getSnapshot().activeKey !== previousActiveKey) navigateToActive(true);
    },
    removeServer(server) {
      const previousActiveKey = store.getSnapshot().activeKey;
      discardDrafts(store.actions.removeServer(server));
      if (store.getSnapshot().activeKey !== previousActiveKey) navigateToActive(true);
    },
    rememberSessionInfo(ref, session) {
      store.actions.rememberSessionInfo(ref, session);
    },
  };

  return Object.freeze({
    actions: Object.freeze(actions),
    dispose: unsubscribe,
  });
}

export { createOpenCodeTabController };
export type {
  OpenCodeTabController,
  OpenCodeTabControllerActions,
  OpenCodeTabControllerOptions,
  OpenCodeTabNavigator,
};
