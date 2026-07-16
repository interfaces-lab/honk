import { tabStatusFromSummary } from "./command-menu-model";
import { actions as tabActions } from "./tab-store";
import { getSessionInventoryWatchSnapshot, subscribeSessionInventoryWatch } from "./watch-registry";

let uninstall: (() => void) | null = null;

export function installTabSummarySync(): void {
  uninstall?.();

  const sync = (): void => {
    const state = getSessionInventoryWatchSnapshot().state;
    if (state !== null) {
      tabActions.syncWorkspace(state.rootSessions, tabStatusFromSummary);
    }
  };

  uninstall = subscribeSessionInventoryWatch(sync);
  sync();
}
