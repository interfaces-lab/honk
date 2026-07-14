// Workspace summary → thread-tab chrome bridge. This lives at module altitude,
// beside the router/watch adapters, so components stay render-pure (ADR 0025).

import { tabStatusFromSummary } from "./command-menu-model";
import {
  actions as tabActions,
  getSnapshot as getTabsSnapshot,
  subscribe as subscribeTabs,
} from "./tab-store";
import {
  getBoundHonkClient,
  getWorkspaceWatchSnapshot,
  subscribeWorkspaceWatch,
} from "./watch-registry";

let uninstall: (() => void) | null = null;
const repositoryLoads = new Set<string>();

export function installTabSummarySync(): void {
  uninstall?.();
  repositoryLoads.clear();

  const sync = (): void => {
    const state = getWorkspaceWatchSnapshot().state;
    if (state === null) {
      return;
    }
    tabActions.syncWorkspace(state.threads, tabStatusFromSummary);

    const client = getBoundHonkClient();
    if (client === null) {
      return;
    }

    const summaries = new Map(state.threads.map((thread) => [String(thread.id), thread]));
    for (const tab of getTabsSnapshot().tabs) {
      if (tab.kind !== "thread" || tab.repository.state !== "loading") {
        continue;
      }

      const summary = summaries.get(tab.key);
      if (summary === undefined) {
        tabActions.setRepository(tab.key, { state: "unavailable" });
        continue;
      }
      if (repositoryLoads.has(tab.key)) {
        continue;
      }

      repositoryLoads.add(tab.key);
      void client.threads
        .get(summary.id)
        .then((detail) => {
          tabActions.setRepository(tab.key, {
            state: "ready",
            label: basename(detail.cwd),
          });
        })
        .catch(() => {
          tabActions.setRepository(tab.key, { state: "unavailable" });
        })
        .finally(() => {
          repositoryLoads.delete(tab.key);
        });
    }
  };

  const unsubscribeWorkspace = subscribeWorkspaceWatch(sync);
  const unsubscribeTabs = subscribeTabs(sync);
  uninstall = () => {
    unsubscribeWorkspace();
    unsubscribeTabs();
  };
  sync();
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const [last = trimmed] = trimmed.split(/[\\/]/).slice(-1);
  return last.length > 0 ? last : path;
}
