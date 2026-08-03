import {
  OPEN_CODE_NEW_WORKSPACE_SESSION_TARGET,
  createOpenCodeServer,
  openCodeLocationRef,
  openCodeSessionKey,
  openCodeSessionRef,
  type OpenCodeServerDescriptor,
} from "@honk/opencode";
import { describe, expect, it } from "vitest";

import {
  OPEN_CODE_CLOSED_TAB_LIMIT,
  OPEN_CODE_TAB_SCHEMA,
  OPEN_CODE_TAB_VERSION,
  openCodeSessionTabKey,
  openCodeTabKey,
  type OpenCodeSessionTab,
  type OpenCodeTab,
} from "./tab-model";
import { openCodeSessionHref } from "./tab-route";
import {
  createOpenCodeWindowTabStore,
  openCodeWindowTabStorageKey,
  type OpenCodeTabStorage,
} from "./tab-store";

const local = createOpenCodeServer({
  origin: "http://127.0.0.1:4096",
  label: "This Mac",
  kind: "local",
});
const cloud = createOpenCodeServer({
  origin: "https://cloud.example.test",
  label: "Cloud",
  kind: "cloud",
});

function createMemoryStorage(): OpenCodeTabStorage & {
  readonly values: ReadonlyMap<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function session(server: OpenCodeServerDescriptor, sessionID: string) {
  return openCodeSessionRef(server.key, sessionID);
}

function sessionTab(tab: OpenCodeTab): OpenCodeSessionTab {
  if (tab.type !== "session") throw new Error("Expected a session tab.");
  return tab;
}

describe("OpenCode window tabs", () => {
  it("keeps same-id sessions distinct by server and restores each window independently", () => {
    const storage = createMemoryStorage();
    const first = createOpenCodeWindowTabStore({ windowID: "window-a", storage });
    const localRef = session(local, "ses_same");
    const cloudRef = session(cloud, "ses_same");

    first.actions.openSession(localRef);
    first.actions.openSession(cloudRef);
    first.actions.rememberSessionInfo(localRef, {
      title: "Local session",
      location: { directory: "/Users/me/local" },
    });

    const before = first.getSnapshot();
    const localKey = openCodeTabKey(sessionTab(before.tabs[0]!));
    const cloudKey = openCodeTabKey(sessionTab(before.tabs[1]!));
    expect(localKey).not.toBe(cloudKey);

    first.actions.reorder([cloudKey, localKey]);
    first.actions.select(localKey);

    const restored = createOpenCodeWindowTabStore({ windowID: "window-a", storage });
    expect(restored.getSnapshot().tabs.map(openCodeTabKey)).toEqual([cloudKey, localKey]);
    expect(restored.getSnapshot().activeKey).toBe(localKey);
    expect(restored.getSnapshot().recentKey).toBe(localKey);
    expect(restored.getSnapshot().info[localKey]).toEqual({
      title: "Local session",
      directory: "/Users/me/local",
    });

    const otherWindow = createOpenCodeWindowTabStore({ windowID: "window-b", storage });
    expect(otherWindow.getSnapshot().tabs).toEqual([]);
    expect(openCodeWindowTabStorageKey("window-a")).not.toBe(
      openCodeWindowTabStorageKey("window-b"),
    );
  });

  it("persists closed sessions, restores their old index, and skips stale entries", () => {
    const storage = createMemoryStorage();
    const store = createOpenCodeWindowTabStore({ windowID: "window-close", storage });
    const first = session(local, "ses_first");
    const middle = session(local, "ses_middle");
    const last = session(local, "ses_last");

    store.actions.openSession(first);
    store.actions.openSession(middle);
    store.actions.openSession(last);
    const middleKey = openCodeTabKey(sessionTab(store.getSnapshot().tabs[1]!));
    const lastKey = openCodeTabKey(sessionTab(store.getSnapshot().tabs[2]!));
    store.actions.select(middleKey);
    store.actions.close(middleKey);

    expect(store.getSnapshot().activeKey).toBe(lastKey);
    expect(store.getSnapshot().closed).toHaveLength(1);
    expect(store.getSnapshot().closed[0]?.index).toBe(1);

    const restored = createOpenCodeWindowTabStore({ windowID: "window-close", storage });
    restored.actions.reopenClosed();
    expect(restored.getSnapshot().tabs.map(openCodeTabKey)[1]).toBe(middleKey);
    expect(restored.getSnapshot().activeKey).toBe(middleKey);

    restored.actions.close(middleKey);
    restored.actions.openSession(middle);
    restored.actions.reopenClosed();
    expect(
      restored.getSnapshot().tabs.filter((tab) => openCodeTabKey(tab) === middleKey),
    ).toHaveLength(1);
    expect(restored.getSnapshot().closed).toEqual([]);
  });

  it("does not reopen discarded drafts and promotes a draft atomically in place", () => {
    const storage = createMemoryStorage();
    const store = createOpenCodeWindowTabStore({ windowID: "window-draft", storage });
    const existing = session(local, "ses_existing");
    store.actions.openSession(existing);
    store.actions.openDraft({
      draftID: "draft-1",
      server: cloud.key,
      location: openCodeLocationRef({
        directory: "/workspace/cloud",
        workspaceID: "worktree-1",
      }),
      target: OPEN_CODE_NEW_WORKSPACE_SESSION_TARGET,
    });

    const restoredDraft = createOpenCodeWindowTabStore({
      windowID: "window-draft",
      storage,
    }).getSnapshot().tabs[1];
    expect(restoredDraft).toMatchObject({
      type: "draft",
      target: { type: "new-workspace" },
    });

    const draftKey = openCodeTabKey(store.getSnapshot().tabs[1]!);
    expect(store.actions.close(draftKey)).toEqual(["draft-1"]);
    expect(store.getSnapshot().closed).toEqual([]);

    store.actions.openDraft({
      draftID: "draft-2",
      server: cloud.key,
      location: openCodeLocationRef({ directory: "/workspace/cloud" }),
    });
    const promoted = session(cloud, "ses_created");
    expect(
      store.actions.promoteDraft("draft-2", promoted, {
        title: "Created from draft",
        location: { directory: "/workspace/cloud" },
      }),
    ).toEqual(["draft-2"]);

    const snapshot = store.getSnapshot();
    expect(snapshot.tabs).toHaveLength(2);
    expect(snapshot.tabs[1]).toMatchObject({
      type: "session",
      server: cloud.key,
      sessionID: "ses_created",
    });
    const promotedKey = openCodeTabKey(snapshot.tabs[1]!);
    expect(snapshot.activeKey).toBe(promotedKey);
    expect(snapshot.recentKey).toBe(promotedKey);
    expect(snapshot.info[promotedKey]).toEqual({
      title: "Created from draft",
      directory: "/workspace/cloud",
    });
  });

  it("caps durable close history and rejects the legacy persistence shape", () => {
    const storage = createMemoryStorage();
    const store = createOpenCodeWindowTabStore({ windowID: "window-limit", storage });

    for (let index = 0; index < OPEN_CODE_CLOSED_TAB_LIMIT + 5; index += 1) {
      store.actions.openSession(session(local, `ses_${String(index)}`));
      const tab = store.getSnapshot().tabs.at(-1);
      if (tab === undefined) throw new Error("Expected an opened tab.");
      store.actions.close(openCodeTabKey(tab));
    }
    expect(store.getSnapshot().closed).toHaveLength(OPEN_CODE_CLOSED_TAB_LIMIT);
    expect(store.getSnapshot().closed[0]?.tab.sessionID).toBe("ses_5");

    const legacyKey = openCodeWindowTabStorageKey("legacy-window");
    storage.setItem(
      legacyKey,
      JSON.stringify({
        tabs: [{ key: "ses_legacy", kind: "thread", title: "Legacy" }],
        activeKey: "ses_legacy",
      }),
    );
    const legacy = createOpenCodeWindowTabStore({
      windowID: "legacy-window",
      storage,
    });
    expect(legacy.getSnapshot().tabs).toEqual([]);
    expect(legacy.getSnapshot().activeKey).toBeNull();
  });

  it("migrates version-one session state without changing its keys", () => {
    const storage = createMemoryStorage();
    const storageKey = openCodeWindowTabStorageKey("version-one");
    const ref = session(local, "ses_v1");
    const server = local.key;
    storage.setItem(
      storageKey,
      JSON.stringify({
        schema: OPEN_CODE_TAB_SCHEMA,
        version: 1,
        tabs: [{ type: "session", server, sessionID: ref.sessionID }],
        activeKey: openCodeSessionKey(ref),
        recentKey: openCodeSessionKey(ref),
        info: {
          [openCodeSessionKey(ref)]: { title: "Version one", directory: "/repo/v1" },
        },
        closed: [],
      }),
    );

    const store = createOpenCodeWindowTabStore({ windowID: "version-one", storage });
    expect(store.getSnapshot()).toMatchObject({
      version: OPEN_CODE_TAB_VERSION,
      activeKey: openCodeSessionKey(ref),
      recentKey: openCodeSessionKey(ref),
    });
    expect(store.getSnapshot().tabs).toEqual([
      expect.objectContaining({ type: "session", server, sessionID: "ses_v1" }),
    ]);
  });

  it("removes one server without touching tabs from another instance", () => {
    const storage = createMemoryStorage();
    const store = createOpenCodeWindowTabStore({ windowID: "window-server", storage });
    store.actions.openSession(session(local, "ses_local"));
    store.actions.openSession(session(cloud, "ses_cloud"));
    store.actions.openDraft({
      draftID: "local-draft",
      server: local.key,
      location: openCodeLocationRef({ directory: "/workspace/local" }),
    });

    expect(store.actions.removeServer(local.key)).toEqual(["local-draft"]);
    expect(store.getSnapshot().tabs).toEqual([
      expect.objectContaining({
        type: "session",
        server: cloud.key,
        sessionID: "ses_cloud",
      }),
    ]);
  });

  it("rekeys tabs, selection, info, routes, and closed entries onto a new server origin", () => {
    const stale = createOpenCodeServer({ origin: "http://127.0.0.1:53747", kind: "local" });
    const fresh = createOpenCodeServer({ origin: "http://127.0.0.1:62242", kind: "local" });
    const storage = createMemoryStorage();
    const store = createOpenCodeWindowTabStore({ windowID: "window-rekey", storage });
    const staleRef = session(stale, "ses_restored");
    const freshRef = session(fresh, "ses_restored");

    store.actions.openSession(session(stale, "ses_closed"));
    store.actions.openSession(staleRef);
    store.actions.openSession(session(cloud, "ses_cloud"));
    store.actions.openDraft({
      draftID: "stale-draft",
      server: stale.key,
      location: openCodeLocationRef({ directory: "/workspace/local" }),
    });
    store.actions.rememberSessionInfo(staleRef, {
      title: "Restored session",
      location: { directory: "/repo/restored" },
    });
    store.actions.rememberSessionRoute(
      staleRef,
      `${openCodeSessionHref(staleRef)}/workbench/browser`,
    );
    store.actions.close(openCodeSessionTabKey(session(stale, "ses_closed")));
    store.actions.select(openCodeSessionTabKey(staleRef));

    store.actions.rekeyServer(stale.key, fresh.key);

    const state = store.getSnapshot();
    expect(state.tabs).toEqual([
      expect.objectContaining({ type: "session", server: fresh.key, sessionID: "ses_restored" }),
      expect.objectContaining({ type: "session", server: cloud.key, sessionID: "ses_cloud" }),
      expect.objectContaining({ type: "draft", server: fresh.key, draftID: "stale-draft" }),
    ]);
    expect(state.activeKey).toBe(openCodeSessionTabKey(freshRef));
    expect(state.recentKey).toBe(openCodeSessionTabKey(freshRef));
    expect(state.info[openCodeSessionTabKey(freshRef)]).toEqual({
      title: "Restored session",
      directory: "/repo/restored",
      route: `${openCodeSessionHref(freshRef)}/workbench/browser`,
    });
    expect(state.info[openCodeSessionTabKey(staleRef)]).toBeUndefined();
    expect(state.closed).toEqual([
      expect.objectContaining({
        tab: expect.objectContaining({ server: fresh.key, sessionID: "ses_closed" }),
      }),
    ]);
  });
});
