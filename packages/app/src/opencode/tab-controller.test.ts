import { createOpenCodeServer, openCodeLocationRef, openCodeSessionRef } from "@honk/opencode";
import { describe, expect, it } from "vitest";

import { createOpenCodeTabController, type OpenCodeTabNavigator } from "./tab-controller";
import { openCodeSessionTabKey, openCodeTabKey } from "./tab-model";
import {
  openCodeDraftHref,
  openCodeSideChatHref,
  openCodeSessionHref,
  openCodeWorkbenchClosedHref,
  openCodeWorkbenchTabHref,
  openCodeWorkbenchToolHref,
  parseOpenCodeTabHref,
} from "./tab-route";
import { createOpenCodeWindowTabStore, type OpenCodeTabStorage } from "./tab-store";

const local = createOpenCodeServer({ origin: "http://127.0.0.1:4096", kind: "local" });
const cloud = createOpenCodeServer({
  origin: "https://cloud.example.test/api",
  label: "Cloud",
  kind: "cloud",
});

function createMemoryStorage(): OpenCodeTabStorage {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function createNavigator(initialHref: string): OpenCodeTabNavigator & {
  readonly navigations: Array<{ readonly href: string; readonly replace: boolean }>;
} {
  let href = initialHref;
  const listeners = new Set<(nextHref: string) => void>();
  const navigations: Array<{ readonly href: string; readonly replace: boolean }> = [];
  return {
    navigations,
    currentHref() {
      return href;
    },
    navigate(nextHref, options) {
      href = nextHref;
      navigations.push({ href: nextHref, replace: options?.replace === true });
      for (const listener of listeners) listener(nextHref);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

describe("OpenCode tab routes", () => {
  it("round-trips server-scoped sessions, canonical utilities, and draft routes", () => {
    const ref = openCodeSessionRef(cloud.key, "ses/a b");
    const href = openCodeSessionHref(ref);
    expect(parseOpenCodeTabHref(href)).toEqual({ type: "session", ref });
    expect(parseOpenCodeTabHref(openCodeDraftHref("draft 1"))).toEqual({
      type: "draft",
      draftID: "draft 1",
    });
    expect(parseOpenCodeTabHref(openCodeWorkbenchToolHref(ref, "browser"))).toEqual({
      type: "session",
      ref,
      workbench: { type: "tab", tabID: "browser" },
    });
    expect(parseOpenCodeTabHref("/server/not+canonical/session/ses_1")).toBeNull();
  });

  it("keeps only the active workbench deep link in route state", () => {
    const ref = openCodeSessionRef(cloud.key, "ses_parent");
    expect(parseOpenCodeTabHref(openCodeWorkbenchTabHref(ref, "terminal:term/a"))).toEqual({
      type: "session",
      ref,
      workbench: { type: "tab", tabID: "terminal:term/a" },
    });
    expect(parseOpenCodeTabHref(openCodeSideChatHref(ref, "ses_child/a"))).toEqual({
      type: "session",
      ref,
      workbench: { type: "side-chat", sessionID: "ses_child/a" },
    });
    expect(parseOpenCodeTabHref(openCodeWorkbenchClosedHref(ref))).toEqual({
      type: "session",
      ref,
    });
  });
});

describe("OpenCode tab controller", () => {
  it("restores the persisted active route on relaunch", () => {
    const storage = createMemoryStorage();
    const first = createOpenCodeWindowTabStore({ windowID: "main", storage });
    const ref = openCodeSessionRef(cloud.key, "ses_restore");
    first.actions.openSession(ref);

    const restored = createOpenCodeWindowTabStore({ windowID: "main", storage });
    const navigator = createNavigator("/");
    const controller = createOpenCodeTabController({ store: restored, navigator });

    expect(navigator.navigations).toEqual([{ href: openCodeSessionHref(ref), replace: true }]);
    expect(restored.getSnapshot().activeKey).toBe(openCodeTabKey(restored.getSnapshot().tabs[0]!));
    controller.dispose();
  });

  it("opens direct routes, maps pinned-Home drag indexes, closes, and reopens", () => {
    const storage = createMemoryStorage();
    const firstRef = openCodeSessionRef(local.key, "ses_first");
    const secondRef = openCodeSessionRef(cloud.key, "ses_second");
    const navigator = createNavigator(openCodeSessionHref(firstRef));
    const store = createOpenCodeWindowTabStore({ windowID: "direct", storage });
    const controller = createOpenCodeTabController({ store, navigator });

    expect(store.getSnapshot().tabs).toMatchObject([
      { type: "session", server: local.key, sessionID: "ses_first" },
    ]);
    controller.actions.openSession(secondRef);
    const [firstTab, secondTab] = store.getSnapshot().tabs;
    if (firstTab === undefined || secondTab === undefined) throw new Error("Expected two tabs.");
    const firstKey = openCodeTabKey(firstTab);
    const secondKey = openCodeTabKey(secondTab);

    controller.actions.reorder(2, 1);
    expect(store.getSnapshot().tabs.map(openCodeTabKey)).toEqual([secondKey, firstKey]);
    controller.actions.reorder(0, 2);
    expect(store.getSnapshot().tabs.map(openCodeTabKey)).toEqual([secondKey, firstKey]);

    controller.actions.close(secondKey);
    expect(navigator.currentHref()).toBe(openCodeSessionHref(firstRef));
    controller.actions.reopenClosed();
    expect(navigator.currentHref()).toBe(openCodeSessionHref(secondRef));
    controller.dispose();
  });

  it("owns a canonical Browser route with the parent session tab", () => {
    const storage = createMemoryStorage();
    const ref = openCodeSessionRef(local.key, "ses_browser");
    const navigator = createNavigator(openCodeWorkbenchToolHref(ref, "browser"));
    const store = createOpenCodeWindowTabStore({ windowID: "browser-workbench", storage });
    const controller = createOpenCodeTabController({ store, navigator });

    expect(store.getSnapshot().tabs).toEqual([
      expect.objectContaining({ type: "session", sessionID: "ses_browser" }),
    ]);
    expect(store.getSnapshot().tabs).toHaveLength(1);
    expect(navigator.currentHref()).toBe(openCodeWorkbenchToolHref(ref, "browser"));
    controller.dispose();
  });

  it("restores the session's nested workbench route after switching tabs", () => {
    const storage = createMemoryStorage();
    const ref = openCodeSessionRef(local.key, "ses_workbench");
    const other = openCodeSessionRef(local.key, "ses_other");
    const workbenchHref = openCodeWorkbenchTabHref(ref, "terminal:term-1");
    const navigator = createNavigator(workbenchHref);
    const store = createOpenCodeWindowTabStore({ windowID: "workbench-route", storage });
    const controller = createOpenCodeTabController({ store, navigator });

    controller.actions.openSession(other);
    controller.actions.activate(openCodeTabKey(store.getSnapshot().tabs[0]!));

    expect(navigator.currentHref()).toBe(workbenchHref);
    expect(store.getSnapshot().info[openCodeSessionTabKey(ref)]?.route).toBe(workbenchHref);
    controller.dispose();
  });

  it("replaces an active draft route when OpenCode creates the session", () => {
    const storage = createMemoryStorage();
    const navigator = createNavigator("/");
    const store = createOpenCodeWindowTabStore({ windowID: "draft", storage });
    const discarded: string[][] = [];
    const controller = createOpenCodeTabController({
      store,
      navigator,
      discardDrafts(draftIDs) {
        discarded.push([...draftIDs]);
      },
    });

    controller.actions.openDraft({
      draftID: "draft-create",
      server: cloud.key,
      location: openCodeLocationRef({ directory: "/cloud/repo", workspaceID: "ws_1" }),
    });
    expect(navigator.currentHref()).toBe(openCodeDraftHref("draft-create"));

    const created = openCodeSessionRef(cloud.key, "ses_created");
    controller.actions.promoteDraft("draft-create", created, {
      title: "Created",
      location: { directory: "/cloud/repo", workspaceID: "ws_1" },
    });
    expect(navigator.navigations.at(-1)).toEqual({
      href: openCodeSessionHref(created),
      replace: true,
    });
    expect(discarded).toEqual([["draft-create"]]);
    controller.dispose();
  });
});
