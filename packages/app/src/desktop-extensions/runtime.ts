import { useSyncExternalStore } from "react";

import {
  actions as tabActions,
  getSnapshot as getTabsSnapshot,
  subscribe as subscribeTabs,
} from "../tab-store";
import { getBoundOpenCodeClient } from "../watch-registry";
import {
  createHonkDesktopExtensionHost,
  type HonkDesktopCell,
  type HonkDesktopPaneContribution,
  type HonkDesktopSettingsToggleContribution,
  type HonkDesktopTabs,
} from "./sdk";
import { verticalSidebarExtension } from "./vertical-sidebar";

const EMPTY_SETTINGS: readonly HonkDesktopSettingsToggleContribution[] = Object.freeze([]);
const EMPTY_PANES: readonly HonkDesktopPaneContribution[] = Object.freeze([]);

const tabs: HonkDesktopTabs = Object.freeze({
  getSnapshot: () => getTabsSnapshot(),
  subscribe: (listener: () => void) => subscribeTabs(listener),
  activate: (key: string) => {
    tabActions.activate(key);
  },
  close: (key: string) => {
    tabActions.close(key);
  },
  create: (relativeToKey?: string) => {
    if (relativeToKey === undefined) {
      tabActions.openNew();
      return;
    }
    tabActions.openNewInWorkspace(relativeToKey);
  },
  reorder: (from: number, to: number) => {
    tabActions.reorder(from, to);
  },
});

const host = createHonkDesktopExtensionHost({
  storage: desktopExtensionStorage(),
  tabs,
  opencode: Object.freeze({ client: () => getBoundOpenCodeClient() }),
});

let isInstalled = false;

export function installHonkDesktopExtensions(): void {
  if (isInstalled || typeof window === "undefined") {
    return;
  }
  host.register(verticalSidebarExtension);
  isInstalled = true;
}

export function useHonkDesktopSettings(): readonly HonkDesktopSettingsToggleContribution[] {
  return useSyncExternalStore(
    (listener) => host.subscribeSettings(listener),
    () => host.getSettingsSnapshot(),
    () => EMPTY_SETTINGS,
  );
}

export function useHonkDesktopPanes(): readonly HonkDesktopPaneContribution[] {
  return useSyncExternalStore(
    (listener) => host.subscribePanes(listener),
    () => host.getPanesSnapshot(),
    () => EMPTY_PANES,
  );
}

export function useIsHonkDesktopTabStripHidden(): boolean {
  return useSyncExternalStore(
    (listener) => host.subscribeTitlebar(listener),
    () => host.getTitlebarTabStripHiddenSnapshot(),
    () => false,
  );
}

export function useHonkDesktopCell<T>(cell: HonkDesktopCell<T>): T {
  return useSyncExternalStore(
    (listener) => cell.subscribe(() => listener()),
    () => cell.get(),
    () => cell.get(),
  );
}

function desktopExtensionStorage(): Pick<Storage, "getItem" | "setItem"> {
  if (typeof window !== "undefined") {
    return window.localStorage;
  }
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
