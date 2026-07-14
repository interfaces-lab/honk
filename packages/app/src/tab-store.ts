// Router-coupled thread-tab store (ADR 0025 §2–§3). Plain module exporting
// {subscribe, getSnapshot, actions} — the same idiom as packages/ui/dev/tab-store.ts,
// plus bidirectional router coupling that lives HERE (never in a component effect).
//
// Laws this module owns:
//   • Home is pinned at slot 0 — not closable, not reorderable past 0, skipped by ⌘W.
//   • activate navigates; route changes activate only already-known real thread tabs.
//   • Closing the active tab activates a sensible neighbor; closed tabs push reopenStack.
//   • New tabs come from Core `threads.create`; no client-only draft ids.

import type { HonkClient, SendMessageFile, WorkspaceState } from "./sidecar";
import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import type { TabDescriptor } from "@honk/ui";

import { getSnapshot as getAppSettings } from "./app-settings-store";
import { actions as modeActions, type ModeId } from "./modes";
import { actions as toastActions } from "./toast-store";
import { getBoundHonkClient } from "./watch-registry";

export type TabStatus = TabDescriptor["status"];

export type TabItem = TabDescriptor;
export type TabRepository = Extract<TabDescriptor, { kind: "thread" }>["repository"];

export type ReopenEntry = {
  item: TabItem;
  index: number;
};

export type OpenNewThreadInput = {
  readonly prompt?: string;
  // The MODE agent this thread starts in (`honk-<mode>` — modes.ts). Soft: later prompts
  // may override it per send.
  readonly agent?: string;
  // The mode id the thread is born in, seeded as its per-thread override so it stays put
  // instead of falling back to the default. Pass alongside `agent` (which is `honk-<mode>`);
  // this is the plain id the modes store keys on.
  readonly mode?: ModeId;
  // The preset's model bundle (presets.ts) — HARD-pinned at birth; sidecar.ts resends it
  // on every prompt and no UI path changes it.
  readonly model?: { readonly providerID: string; readonly id: string };
  readonly variant?: string;
  // Working directory for the new session (opencode `directory`/cwd). Omitted → sidecar default.
  readonly directory?: string;
  // File mentions from the composer's @-menu, forwarded as FilePartInputs on the first send.
  readonly files?: readonly SendMessageFile[];
  // A slash-command invocation (composer's /-menu): runs client.session.command on the new
  // thread instead of a plain prompt send. `prompt` should carry the raw "/name args" text so
  // the title still reads honestly.
  readonly command?: { readonly name: string; readonly arguments: string };
};

type ThreadSummary = WorkspaceState["threads"][number];

type ThreadCreatePayload = Parameters<HonkClient["threads"]["create"]>[0];
type ThreadCreateSummary = Awaited<ReturnType<HonkClient["threads"]["create"]>>;
type ThreadSendPayload = Parameters<HonkClient["threads"]["send"]>[1];
type ThreadSendMessageId = ThreadSendPayload["messageId"];

export type Snapshot = {
  tabs: readonly TabItem[];
  activeKey: string;
  reopenStack: readonly ReopenEntry[];
};

// Closed tabs are undo history, not durable workspace state.
const REOPEN_LIMIT = 10;
const STORAGE_KEY = "honk:app-next:tabs";
// Legacy projectless fallback used by the old app when no project picker has selected a cwd.
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

// Router is bound from main.tsx after createRouter — keeps this module free of a
// runtime import cycle (router → shell → tab-store). Structural so we don't import
// the concrete router type into this module.
type BoundRouter = {
  subscribe: (
    eventType: "onResolved",
    fn: (event: { toLocation: { pathname: string } }) => void,
  ) => () => void;
  navigate: (opts: Record<string, unknown>) => unknown;
  state: { location: { pathname: string } };
};

let boundRouter: BoundRouter | null = null;
let unbindRouter: (() => void) | null = null;
// Suppresses the route→tab half while we are the ones driving navigation, so
// activate → navigate → onResolved does not re-enter open/activate.
let syncingFromStore = false;

let snapshot = hydrate();

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
  return DEFAULT_SNAPSHOT;
}

export function useTabs(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useTabsSelector<T>(
  selector: (snapshot: Snapshot) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  return useSyncExternalStoreWithSelector(
    subscribe,
    getSnapshot,
    getServerSnapshot,
    selector,
    isEqual,
  );
}

// Wire the store to the app router. Call once from main.tsx after createRouter.
// Subscribes to onResolved so route changes activate (and open) tabs without any
// component effect — ADR 0025 §1 replacement for "subscribe in useEffect".
export function bindRouter(router: BoundRouter): void {
  unbindRouter?.();
  boundRouter = router;

  const sync = (pathname: string): void => {
    syncFromPathname(pathname);
  };

  // Seed from the current location before the first navigation resolves.
  sync(router.state.location.pathname);

  unbindRouter = router.subscribe("onResolved", (event) => {
    if (syncingFromStore) {
      // We drove this navigation; activeKey is already correct. Drop the guard
      // so the next external route change (back button, deep link) syncs again.
      syncingFromStore = false;
      return;
    }
    sync(event.toLocation.pathname);
  });
}

export const actions = {
  open(item: TabItem, opts?: { activate?: boolean }): void {
    if (item.kind === "home") {
      return;
    }

    if (snapshot.tabs.some((tab) => tab.key === item.key)) {
      if (opts?.activate !== false) {
        actions.activate(item.key);
      }
      return;
    }

    publish(
      Object.freeze([...snapshot.tabs, Object.freeze({ ...item })]),
      opts?.activate === false ? snapshot.activeKey : item.key,
      snapshot.reopenStack,
    );

    if (opts?.activate !== false) {
      navigateToKey(item.key);
    }
  },

  // Activation is the mousedown path TabStrip already fires — we navigate here.
  activate(key: string): void {
    if (!snapshot.tabs.some((tab) => tab.key === key)) {
      return;
    }

    if (snapshot.activeKey !== key) {
      publish(snapshot.tabs, key, snapshot.reopenStack);
    }

    navigateToKey(key);
  },

  close(key: string): void {
    const index = snapshot.tabs.findIndex((tab) => tab.key === key);

    // Home lives at slot 0 and never closes (the pinned-tab law / ⌘W skip).
    if (index <= 0) {
      return;
    }

    const item = snapshot.tabs[index];
    if (item === undefined) {
      return;
    }

    const tabs = Object.freeze(snapshot.tabs.filter((tab) => tab.key !== key));
    const fallback = tabs[Math.min(index, tabs.length - 1)] ?? HOME_TAB;
    const wasActive = snapshot.activeKey === key;
    const nextActive = wasActive ? fallback.key : snapshot.activeKey;

    publish(
      tabs,
      nextActive,
      Object.freeze([
        ...snapshot.reopenStack.slice(-(REOPEN_LIMIT - 1)),
        Object.freeze({ item, index }),
      ]),
    );

    if (wasActive) {
      navigateToKey(nextActive);
    }
  },

  closeActive(): void {
    actions.close(snapshot.activeKey);
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
    if (item === undefined) {
      return;
    }

    tabs.splice(toIndex, 0, item);
    publish(Object.freeze(tabs), snapshot.activeKey, snapshot.reopenStack);
  },

  reopen(): void {
    const entry = snapshot.reopenStack[snapshot.reopenStack.length - 1];
    if (entry === undefined) {
      return;
    }

    const reopenStack = Object.freeze(snapshot.reopenStack.slice(0, -1));

    if (snapshot.tabs.some((tab) => tab.key === entry.item.key)) {
      publish(snapshot.tabs, entry.item.key, reopenStack);
      navigateToKey(entry.item.key);
      return;
    }

    const tabs = [...snapshot.tabs];
    tabs.splice(Math.min(entry.index, tabs.length), 0, entry.item);
    publish(Object.freeze(tabs), entry.item.key, reopenStack);
    navigateToKey(entry.item.key);
  },

  // ⌘N / + / Home omnibox — create in Core first, then navigate to the real thread id.
  openNew(input?: OpenNewThreadInput): void {
    const client = getBoundHonkClient();
    if (client === null) {
      toastActions.add({
        type: "error",
        title: "Not connected",
        description: "The Core connection is not ready yet.",
      });
      return;
    }

    void createAndOpenThread(client, input?.prompt ?? "", input);
  },

  // Seam for the SDK watch adapter: swap the placeholder threadId title for a
  // real summary without the tab store knowing about watches.
  setTabTitle(key: string, title: string): void {
    publish(
      replaceTab(key, (tab) => (tab.title === title ? tab : { ...tab, title })),
      snapshot.activeKey,
      snapshot.reopenStack,
    );
  },

  setStatus(key: string, status: TabStatus): void {
    publish(
      replaceTab(key, (tab) => (tab.status === status ? tab : { ...tab, status })),
      snapshot.activeKey,
      snapshot.reopenStack,
    );
  },

  setRepository(key: string, repository: TabRepository): void {
    publish(
      replaceTab(key, (tab) => {
        if (tab.kind !== "thread" || repositoriesEqual(tab.repository, repository)) {
          return tab;
        }
        return { ...tab, repository };
      }),
      snapshot.activeKey,
      snapshot.reopenStack,
    );
  },

  // Workspace summaries are the authority for tab chrome. Apply the whole
  // snapshot in one publish so a streaming status update cannot briefly leave
  // Home and its thread tab disagreeing about attention state.
  syncWorkspace(
    threads: readonly ThreadSummary[],
    statusForSummary: (summary: ThreadSummary) => TabStatus,
  ): void {
    const activeSummaries = threads.filter((thread) => thread.archivedAt === null);
    const byId = new Map(threads.map((thread) => [String(thread.id), thread]));
    const homeStatus = worstStatus(activeSummaries.map(statusForSummary));
    let didChange = false;

    const tabs = snapshot.tabs.map((tab) => {
      if (tab.kind === "home") {
        if (tab.status === homeStatus) {
          return tab;
        }
        didChange = true;
        return Object.freeze({ ...tab, status: homeStatus });
      }

      const summary = byId.get(tab.key);
      if (summary === undefined) {
        return tab;
      }

      const status = statusForSummary(summary);
      const repository =
        summary.worktree?.path === undefined || summary.worktree.path === null
          ? tab.repository
          : { state: "ready" as const, label: basename(summary.worktree.path) };
      if (
        tab.title === summary.title &&
        tab.status === status &&
        repositoriesEqual(tab.repository, repository)
      ) {
        return tab;
      }
      didChange = true;
      return Object.freeze({ ...tab, title: summary.title, status, repository });
    });

    if (didChange) {
      publish(Object.freeze(tabs), snapshot.activeKey, snapshot.reopenStack);
    }
  },
} as const;

function syncFromPathname(pathname: string): void {
  if (pathname === "/" || pathname === "") {
    if (snapshot.activeKey !== HOME_TAB.key) {
      publish(snapshot.tabs, HOME_TAB.key, snapshot.reopenStack);
    }
    return;
  }

  const match = /^\/thread\/([^/]+)\/?$/.exec(pathname);
  if (match === null) {
    return;
  }

  const threadId = match[1];
  if (threadId === undefined || threadId.length === 0) {
    return;
  }

  const existing = snapshot.tabs.find((tab) => tab.key === threadId);
  if (existing !== undefined) {
    if (snapshot.activeKey !== threadId) {
      publish(snapshot.tabs, threadId, snapshot.reopenStack);
    }
    return;
  }

  // A direct URL is a legitimate browser-style open. Start with honest loading
  // chrome; the workspace summary synchronizer replaces the title/status once
  // Core validates the id, while the route surface owns its unavailable state.
  publish(
    Object.freeze([
      ...snapshot.tabs,
      Object.freeze({
        key: threadId,
        title: "Loading thread",
        kind: "thread" as const,
        status: "idle" as const,
        repository: { state: "loading" as const },
      }),
    ]),
    threadId,
    snapshot.reopenStack,
  );
}

const STATUS_SEVERITY: Readonly<Record<TabStatus, number>> = Object.freeze({
  failed: 5,
  "needs-you": 4,
  working: 3,
  draft: 2,
  done: 1,
  idle: 0,
});

function worstStatus(statuses: readonly TabStatus[]): TabStatus {
  let worst: TabStatus = "idle";
  for (const status of statuses) {
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) {
      worst = status;
    }
  }
  return worst;
}

async function createAndOpenThread(
  client: HonkClient,
  prompt: string,
  input?: OpenNewThreadInput,
): Promise<void> {
  const trimmedPrompt = prompt.trim();
  let summary: ThreadCreateSummary;

  try {
    // With a directory, the session is scoped to that project instance; without one (`~` does not
    // expand server-side), the sidecar's default directory governs. The folder picker feeds
    // input.directory once the project picker lands.
    // New tabs without an explicit directory inherit the app-wide default (the last folder a thread
    // was started in — app-settings-store), so ⌘N / command menu / the tab "+" all land in the same
    // project instead of the sidecar's bare default.
    const directory = input?.directory ?? getAppSettings().defaultProjectDirectory ?? undefined;
    const payload: ThreadCreatePayload = {
      ...(directory !== undefined ? { cwd: directory } : {}),
      ...(trimmedPrompt.length > 0 ? { title: trimmedPrompt } : {}),
      ...(input?.agent !== undefined ? { agent: input.agent } : {}),
      ...(input?.model !== undefined ? { model: input.model } : {}),
      ...(input?.variant !== undefined ? { variant: input.variant } : {}),
    };
    summary = await client.threads.create(payload);
  } catch (error) {
    const message = errorMessage(error);
    toastActions.add({
      type: "error",
      title: "New thread failed",
      description: message,
      copyableError: message,
    });
    return;
  }

  const key = String(summary.id);
  actions.open({
    key,
    title: summary.title,
    kind: "thread",
    status: "idle",
    repository:
      summary.worktree?.path === undefined || summary.worktree.path === null
        ? { state: "loading" }
        : { state: "ready", label: basename(summary.worktree.path) },
  });

  // Pin the birth mode as this thread's own override so it never floats on the home pill
  // (see modes.useThreadMode). Only a constrained mode needs pinning; a build-mode thread is
  // already the fallback, and leaving it unset keeps the store lean.
  if (input?.mode !== undefined && input.mode !== "build") {
    modeActions.setThreadMode(key, input.mode);
  }

  if (trimmedPrompt.length === 0 && input?.command === undefined) {
    return;
  }

  try {
    if (input?.command !== undefined) {
      // Slash command: opencode runs it server-side (session.command). The model stays the
      // birth pin on the session; the mode agent rides along like a prompt send would.
      await client.threads.runCommand(summary.id, {
        command: input.command.name,
        arguments: input.command.arguments,
        ...(input.agent !== undefined ? { agent: input.agent } : {}),
      });
    } else {
      await client.threads.send(summary.id, {
        messageId: newMessageId(),
        text: trimmedPrompt,
        ...(input?.files !== undefined && input.files.length > 0 ? { files: input.files } : {}),
      });
    }
  } catch (error) {
    const message = errorMessage(error);
    toastActions.add({
      type: "error",
      title: input?.command !== undefined ? "Command failed" : "Send failed",
      description: message,
      copyableError: message,
      threadKey: key,
    });
  }
}

function newMessageId(): ThreadSendMessageId {
  return crypto.randomUUID() as ThreadSendMessageId;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function navigateToKey(key: string): void {
  if (boundRouter === null) {
    return;
  }

  const pathname = boundRouter.state.location.pathname;
  const targetPath = key === HOME_TAB.key ? "/" : `/thread/${key}`;
  if (pathname === targetPath || pathname === `${targetPath}/`) {
    return;
  }

  syncingFromStore = true;
  try {
    const result =
      key === HOME_TAB.key
        ? boundRouter.navigate({ to: "/" })
        : boundRouter.navigate({
            to: "/thread/$threadId",
            params: { threadId: key },
          });
    // Backup clear if onResolved never fires (cancelled / identical href edge).
    void Promise.resolve(result).finally(() => {
      syncingFromStore = false;
    });
  } catch {
    syncingFromStore = false;
  }
}

function replaceTab(key: string, update: (tab: TabItem) => TabItem): readonly TabItem[] {
  if (key === HOME_TAB.key) {
    return snapshot.tabs;
  }

  const index = snapshot.tabs.findIndex((tab) => tab.key === key);
  const current = index >= 0 ? snapshot.tabs[index] : undefined;
  if (current === undefined) {
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
    if (raw === null) {
      return DEFAULT_SNAPSHOT;
    }

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
        tab === null ||
        typeof tab.key !== "string" ||
        // Thread tabs are opencode sessions; drop anything else at hydration — pre-cutover
        // "thread_…" ids otherwise 500 against the sidecar on every watch mount.
        !tab.key.startsWith("ses_") ||
        typeof tab.title !== "string" ||
        tab.kind !== "thread" ||
        typeof tab.status !== "string" ||
        tab.status === "draft" ||
        !(TAB_STATUSES as readonly string[]).includes(tab.status) ||
        seen.has(tab.key)
      ) {
        continue;
      }

      seen.add(tab.key);
      const repository = decodeRepository(tab.repository);
      tabs.push(
        Object.freeze({
          key: tab.key,
          title: tab.title,
          kind: "thread" as const,
          status: tab.status as TabStatus,
          repository,
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
    // Persistence must never break the tab plane.
  }
}

function repositoriesEqual(a: TabRepository, b: TabRepository): boolean {
  if (a.state !== b.state) {
    return false;
  }
  return a.state !== "ready" || (b.state === "ready" && a.label === b.label);
}

function decodeRepository(value: unknown): TabRepository {
  if (typeof value !== "object" || value === null) {
    return { state: "loading" };
  }
  const state = Reflect.get(value, "state");
  if (state === "ready") {
    const label = Reflect.get(value, "label");
    if (typeof label === "string" && label.trim().length > 0) {
      return { state, label };
    }
    return { state: "unavailable" };
  }
  return state === "unavailable" ? { state } : { state: "loading" };
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const [last = trimmed] = trimmed.split(/[\\/]/).slice(-1);
  return last.length > 0 ? last : path;
}
