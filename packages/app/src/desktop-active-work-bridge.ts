import { syncAppearanceDisplayZoom } from "./lib/appearance-settings";
import { isElectron } from "./env";
import { selectSidebarThreadsAcrossEnvironments, useStore } from "./stores/thread-store";
import type { AppState } from "./stores/thread-store";

let installed = false;
let lastRunningThreadCount = -1;

export function countRunningThreadsWithServerState(state: AppState): number {
  const serverEnvironmentIds = new Set(
    Object.entries(state.environmentStateById).flatMap(([environmentId, environmentState]) =>
      environmentState.snapshotSource === "server" ? [environmentId] : [],
    ),
  );

  return selectSidebarThreadsAcrossEnvironments(state).filter(
    (summary) =>
      serverEnvironmentIds.has(summary.environmentId) &&
      summary.session?.orchestrationStatus === "running",
  ).length;
}

function publishRunningThreadCount(runningThreadCount: number): void {
  const bridge = window.desktopBridge;
  if (!bridge || runningThreadCount === lastRunningThreadCount) {
    return;
  }

  lastRunningThreadCount = runningThreadCount;
  void bridge.setActiveWorkState({ runningThreadCount }).catch(() => {
    lastRunningThreadCount = -1;
  });
}

export function installDesktopActiveWorkBridge(): void {
  if (installed || !isElectron || typeof window === "undefined" || !window.desktopBridge) {
    return;
  }

  installed = true;
  syncAppearanceDisplayZoom();
  publishRunningThreadCount(countRunningThreadsWithServerState(useStore.getState()));
  useStore.subscribe((state) => {
    publishRunningThreadCount(countRunningThreadsWithServerState(state));
  });
}
