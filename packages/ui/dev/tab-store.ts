import { useSyncExternalStore } from "react";

import type { TabDescriptor } from "../src";

export type TabStatus = TabDescriptor["status"];

export type TabItem = TabDescriptor;

type TabRepository = Extract<TabDescriptor, { kind: "thread" }>["repository"];

export type Snapshot = {
  tabs: readonly TabItem[];
  activeKey: string;
  reopenStack: readonly { item: TabItem; index: number }[];
};

const STORAGE_KEY = "honk-ui-dev:tabs";
// Closed tabs are undo history, not durable workspace state — keep it short.
const REOPEN_LIMIT = 10;
const TAB_STATUSES = ["idle", "working", "needs-you", "done", "failed", "draft"] as const;

const HOME_TAB: TabItem = Object.freeze({
  key: "home",
  kind: "home",
  title: "Home",
  status: "idle",
});

const DEFAULT_SNAPSHOT: Snapshot = Object.freeze({
  tabs: Object.freeze([HOME_TAB]),
  activeKey: HOME_TAB.key,
  reopenStack: Object.freeze([]),
});

const listeners = new Set<() => void>();

let snapshot = hydrate();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getTabsSnapshot(): Snapshot {
  return snapshot;
}

export function useTabs(): Snapshot {
  return useSyncExternalStore(subscribe, getTabsSnapshot, getServerSnapshot);
}

// The store trusts its own actions: every mutation below maintains the
// invariants (Home frozen at slot 0, unique keys, activeKey always a member),
// so publish never re-validates or re-clones — untrusted data is normalized
// exactly once, at the hydration boundary. TabItem references are reused
// wherever a tab is unchanged so React.memo rows bail on identity; this is
// the structural-sharing shape the SDK adapter copies (ADR 0025 §2).
export const tabActions = {
  open(item: TabItem, opts?: { activate?: boolean }): void {
    if (item.kind === "home") {
      return;
    }

    if (snapshot.tabs.some((tab) => tab.key === item.key)) {
      if (opts?.activate !== false) {
        tabActions.activate(item.key);
      }

      return;
    }

    publish(
      Object.freeze([...snapshot.tabs, Object.freeze({ ...item })]),
      opts?.activate === false ? snapshot.activeKey : item.key,
      snapshot.reopenStack,
    );
  },

  activate(key: string): void {
    if (!snapshot.tabs.some((tab) => tab.key === key)) {
      return;
    }

    publish(snapshot.tabs, key, snapshot.reopenStack);
  },

  close(key: string): void {
    const index = snapshot.tabs.findIndex((tab) => tab.key === key);

    // Home lives at slot 0 and never closes (the pinned-tab law).
    if (index <= 0) {
      return;
    }

    const item = snapshot.tabs[index];

    if (!item) {
      return;
    }

    const tabs = Object.freeze(snapshot.tabs.filter((tab) => tab.key !== key));
    const fallback = tabs[Math.min(index, tabs.length - 1)] ?? HOME_TAB;

    publish(
      tabs,
      snapshot.activeKey === key ? fallback.key : snapshot.activeKey,
      Object.freeze([
        ...snapshot.reopenStack.slice(-(REOPEN_LIMIT - 1)),
        Object.freeze({ item, index }),
      ]),
    );
  },

  closeActive(): void {
    tabActions.close(snapshot.activeKey);
  },

  reorder(from: number, to: number): void {
    const lastIndex = snapshot.tabs.length - 1;
    const fromIndex = clampIndex(from, lastIndex);
    const toIndex = clampIndex(to, lastIndex);

    // Home is the fixed anchor: no drag may source from it or insert before it.
    if (fromIndex === 0 || toIndex === 0 || fromIndex === toIndex) {
      return;
    }

    const tabs = [...snapshot.tabs];
    const [item] = tabs.splice(fromIndex, 1);

    if (!item) {
      return;
    }

    tabs.splice(toIndex, 0, item);
    publish(Object.freeze(tabs), snapshot.activeKey, snapshot.reopenStack);
  },

  reopen(): void {
    const entry = snapshot.reopenStack[snapshot.reopenStack.length - 1];

    if (!entry) {
      return;
    }

    const reopenStack = Object.freeze(snapshot.reopenStack.slice(0, -1));

    if (snapshot.tabs.some((tab) => tab.key === entry.item.key)) {
      publish(snapshot.tabs, entry.item.key, reopenStack);
      return;
    }

    const tabs = [...snapshot.tabs];
    tabs.splice(Math.min(entry.index, tabs.length), 0, entry.item);
    publish(Object.freeze(tabs), entry.item.key, reopenStack);
  },

  rename(key: string, title: string): void {
    publish(
      replaceTab(key, (tab) => (tab.title === title ? tab : { ...tab, title })),
      snapshot.activeKey,
      snapshot.reopenStack,
    );
  },

  setStatus(key: string, status: TabStatus): void {
    publish(
      replaceTab(key, (tab) => {
        if (tab.kind !== "thread") return tab;
        return tab.status === status ? tab : { ...tab, status };
      }),
      snapshot.activeKey,
      snapshot.reopenStack,
    );
  },
} as const;

function getServerSnapshot(): Snapshot {
  return DEFAULT_SNAPSHOT;
}

// Returns the SAME tabs array when nothing changed, so publish no-ops and
// unaffected React.memo rows keep their item references when something did.
function replaceTab(key: string, update: (tab: TabItem) => TabItem): readonly TabItem[] {
  // Home's title/status are fixed; it is the stable landmark of the plane.
  if (key === HOME_TAB.key) {
    return snapshot.tabs;
  }

  const index = snapshot.tabs.findIndex((tab) => tab.key === key);
  const current = index >= 0 ? snapshot.tabs[index] : undefined;

  if (!current) {
    return snapshot.tabs;
  }

  const next = update(current);

  if (next === current) {
    return snapshot.tabs;
  }

  const tabs = [...snapshot.tabs];
  tabs[index] = Object.freeze(next);
  return Object.freeze(tabs);
}

function publish(
  tabs: readonly TabItem[],
  activeKey: string,
  reopenStack: Snapshot["reopenStack"],
): void {
  if (
    tabs === snapshot.tabs &&
    activeKey === snapshot.activeKey &&
    reopenStack === snapshot.reopenStack
  ) {
    return;
  }

  snapshot = Object.freeze({ tabs, activeKey, reopenStack });
  persist(snapshot);

  for (const listener of listeners) {
    listener();
  }
}

function clampIndex(index: number, lastIndex: number): number {
  return Math.min(Math.max(Math.trunc(index), 0), lastIndex);
}

function hydrate(): Snapshot {
  if (typeof window === "undefined") {
    return DEFAULT_SNAPSHOT;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return DEFAULT_SNAPSHOT;
    }

    // The one untrusted boundary: a single structural pass keeps well-formed,
    // unique thread tabs and drops everything else. Home is re-seeded rather
    // than trusted from storage.
    const parsed = JSON.parse(raw) as { tabs?: unknown; activeKey?: unknown };
    const seen = new Set<string>([HOME_TAB.key]);
    const tabs: TabItem[] = [HOME_TAB];

    for (const value of Array.isArray(parsed.tabs) ? parsed.tabs : []) {
      const tab = value as {
        key?: unknown;
        title?: unknown;
        kind?: unknown;
        status?: unknown;
        repository?: unknown;
      } | null;

      if (
        !tab ||
        typeof tab.key !== "string" ||
        typeof tab.title !== "string" ||
        tab.kind !== "thread" ||
        typeof tab.status !== "string" ||
        !(TAB_STATUSES as readonly string[]).includes(tab.status) ||
        seen.has(tab.key)
      ) {
        continue;
      }

      seen.add(tab.key);
      tabs.push(
        Object.freeze({
          key: tab.key,
          title: tab.title,
          kind: "thread" as const,
          status: tab.status as TabStatus,
          repository: decodeRepository(tab.repository),
        }),
      );
    }

    const activeKey =
      typeof parsed.activeKey === "string" && seen.has(parsed.activeKey)
        ? parsed.activeKey
        : HOME_TAB.key;

    return Object.freeze({
      tabs: Object.freeze(tabs),
      activeKey,
      reopenStack: DEFAULT_SNAPSHOT.reopenStack,
    });
  } catch {
    return DEFAULT_SNAPSHOT;
  }
}

function persist(next: Snapshot): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tabs: next.tabs, activeKey: next.activeKey }),
    );
  } catch {
    // Dev storage must never break the tab plane; dropping persistence is
    // safer than interrupting the session.
  }
}

function decodeRepository(value: unknown): TabRepository {
  if (typeof value !== "object" || value === null) {
    return { state: "ready", label: "honk" };
  }
  const state = Reflect.get(value, "state");
  if (state === "ready") {
    const label = Reflect.get(value, "label");
    if (typeof label === "string" && label.trim().length > 0) {
      return { state, label };
    }
    return { state: "unavailable" };
  }
  if (state === "loading" || state === "unavailable") {
    return { state };
  }
  return { state: "ready", label: "honk" };
}
