import { syncAppearanceDisplayZoom } from "./lib/appearance-settings";
import { isElectron } from "./env";
import { hasActiveOrchestrationTurn } from "./session-logic";
import { selectSidebarThreadsAcrossEnvironments, useStore } from "./stores/thread-store";
import type { AppState } from "./stores/thread-store";

interface DesktopActiveWorkBridgeInstallation {
  lastRunningThreadCount: number;
  unsubscribe: () => void;
}

type WindowWithDesktopActiveWorkBridge = Window & {
  __honkDesktopActiveWorkBridge?: DesktopActiveWorkBridgeInstallation;
};

export function countRunningThreadsWithServerState(state: AppState): number {
  const serverEnvironmentIds = new Set(
    Object.entries(state.environmentStateById).flatMap(([environmentId, environmentState]) =>
      environmentState.snapshotSource === "server" ? [environmentId] : [],
    ),
  );

  return selectSidebarThreadsAcrossEnvironments(state).filter(
    (summary) =>
      serverEnvironmentIds.has(summary.environmentId) &&
      hasActiveOrchestrationTurn(summary.latestTurn, summary.session),
  ).length;
}

function publishRunningThreadCount(
  installation: DesktopActiveWorkBridgeInstallation,
  runningThreadCount: number,
): void {
  const bridge = window.desktopBridge;
  if (!bridge || runningThreadCount === installation.lastRunningThreadCount) {
    return;
  }

  installation.lastRunningThreadCount = runningThreadCount;
  void bridge.setActiveWorkState({ runningThreadCount }).catch(() => {
    installation.lastRunningThreadCount = -1;
  });
}

export function installDesktopActiveWorkBridge(): void {
  if (!isElectron || typeof window === "undefined" || !window.desktopBridge) {
    return;
  }

  const targetWindow = window as WindowWithDesktopActiveWorkBridge;
  if (targetWindow.__honkDesktopActiveWorkBridge) {
    return;
  }

  syncAppearanceDisplayZoom();
  const installation: DesktopActiveWorkBridgeInstallation = {
    lastRunningThreadCount: -1,
    unsubscribe: () => undefined,
  };
  installation.unsubscribe = useStore.subscribe((state) => {
    publishRunningThreadCount(installation, countRunningThreadsWithServerState(state));
  });
  targetWindow.__honkDesktopActiveWorkBridge = installation;
  publishRunningThreadCount(installation, countRunningThreadsWithServerState(useStore.getState()));
}
