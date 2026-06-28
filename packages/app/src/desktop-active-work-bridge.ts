import { syncAppearanceDisplayZoom } from "./lib/appearance-settings";
import {
  countRunningThreadsWithServerState,
  selectRunningThreadTitlesWithServerState,
} from "./desktop-active-work";
import { isElectron } from "./env";
import { useStore } from "./stores/thread-store";

interface DesktopActiveWorkBridgeInstallation {
  lastRunningThreadCount: number;
  lastRunningThreadTitles: string[];
  unsubscribe: () => void;
}

type WindowWithDesktopActiveWorkBridge = Window & {
  __honkDesktopActiveWorkBridge?: DesktopActiveWorkBridgeInstallation;
};

function publishRunningThreadState(
  installation: DesktopActiveWorkBridgeInstallation,
  runningThreadCount: number,
  runningThreadTitles: string[],
): void {
  const bridge = window.desktopBridge;
  if (
    !bridge ||
    (runningThreadCount === installation.lastRunningThreadCount &&
      runningThreadTitles.length === installation.lastRunningThreadTitles.length &&
      runningThreadTitles.every(
        (title, index) => title === installation.lastRunningThreadTitles[index],
      ))
  ) {
    return;
  }

  installation.lastRunningThreadCount = runningThreadCount;
  installation.lastRunningThreadTitles = runningThreadTitles;
  void bridge.setActiveWorkState({ runningThreadCount, runningThreadTitles }).catch(() => {
    installation.lastRunningThreadCount = -1;
    installation.lastRunningThreadTitles = [];
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
    lastRunningThreadTitles: [],
    unsubscribe: () => undefined,
  };
  installation.unsubscribe = useStore.subscribe((state) => {
    publishRunningThreadState(
      installation,
      countRunningThreadsWithServerState(state),
      selectRunningThreadTitlesWithServerState(state),
    );
  });
  targetWindow.__honkDesktopActiveWorkBridge = installation;
  publishRunningThreadState(
    installation,
    countRunningThreadsWithServerState(useStore.getState()),
    selectRunningThreadTitlesWithServerState(useStore.getState()),
  );
}
