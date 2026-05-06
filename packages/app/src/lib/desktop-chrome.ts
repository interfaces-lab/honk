import type { DesktopWindowChromeState } from "@multi/contracts";

import { isElectronHost } from "../env";

/** Must stay in sync with `trafficLightPosition` in packages/desktop/src/main.ts (getWindowTitleBarOptions). */
export const MACOS_TRAFFIC_LIGHTS = {
  x: 14,
  y: 14,
  spacerWidth: 80,
  paddingTop: 28,
} as const;

const TRAFFIC_LIGHT_CLUSTER_HEIGHT_PX = 16;
const TITLEBAR_CONTROL_HEIGHT_PX = 22;
const TITLEBAR_HEIGHT_PX = 34;
export const TITLEBAR_CONTROL_OFFSET_TOP_PX =
  MACOS_TRAFFIC_LIGHTS.y - (TITLEBAR_CONTROL_HEIGHT_PX - TRAFFIC_LIGHT_CLUSTER_HEIGHT_PX) / 2;
const FULLSCREEN_TITLEBAR_CONTROL_OFFSET_TOP_PX =
  (TITLEBAR_HEIGHT_PX - TITLEBAR_CONTROL_HEIGHT_PX) / 2;

const INSET = "--multi-electron-traffic-inset";
const TOP = "--multi-electron-traffic-padding-top";
const CONTROL_HEIGHT = "--multi-titlebar-control-height";
const ROW_TOP = "--multi-titlebar-control-row-top";
const SIDEBAR_CONTENT_TOP_OFFSET = "--multi-shell-sidebar-content-top-offset";
/** Match Cursor/VS Code `.part.titlebar` (`height: 34px` in workbench.desktop.main.css). */
const TITLEBAR_HEIGHT = "--multi-header-height";
/** Match Cursor no-titlebar content/top-tab reserve (`padding-top: 35px`). */
const TITLEBAR_CONTENT_RESERVE_PX = 35;
const FULLSCREEN_TRAFFIC_INSET_PX = 8;

function applyFullscreenShellChromeMetrics(): void {
  const root = document.documentElement;
  delete root.dataset.electronFullscreen;
  root.style.setProperty(INSET, `${FULLSCREEN_TRAFFIC_INSET_PX}px`);
  root.style.setProperty(TOP, "0px");
  root.style.setProperty(SIDEBAR_CONTENT_TOP_OFFSET, `${TITLEBAR_CONTENT_RESERVE_PX}px`);
  root.style.setProperty(CONTROL_HEIGHT, `${TITLEBAR_CONTROL_HEIGHT_PX}px`);
  root.style.setProperty(ROW_TOP, `${FULLSCREEN_TITLEBAR_CONTROL_OFFSET_TOP_PX}px`);
  root.style.setProperty(TITLEBAR_HEIGHT, `${TITLEBAR_HEIGHT_PX}px`);
}

function applyElectronChromeState(state: DesktopWindowChromeState): void {
  const root = document.documentElement;
  root.dataset.electronFullscreen = state.fullscreen ? "true" : "false";
  root.style.setProperty(
    INSET,
    `${state.fullscreen ? FULLSCREEN_TRAFFIC_INSET_PX : MACOS_TRAFFIC_LIGHTS.spacerWidth}px`,
  );
  root.style.setProperty(TOP, `${state.fullscreen ? 0 : MACOS_TRAFFIC_LIGHTS.paddingTop}px`);
  root.style.setProperty(
    SIDEBAR_CONTENT_TOP_OFFSET,
    `${state.fullscreen ? TITLEBAR_CONTENT_RESERVE_PX : MACOS_TRAFFIC_LIGHTS.paddingTop}px`,
  );
  root.style.setProperty(CONTROL_HEIGHT, `${TITLEBAR_CONTROL_HEIGHT_PX}px`);
  root.style.setProperty(
    ROW_TOP,
    `${state.fullscreen ? FULLSCREEN_TITLEBAR_CONTROL_OFFSET_TOP_PX : TITLEBAR_CONTROL_OFFSET_TOP_PX}px`,
  );
  root.style.setProperty(TITLEBAR_HEIGHT, `${TITLEBAR_HEIGHT_PX}px`);
}

export function applyDesktopChromeMetrics() {
  if (typeof document === "undefined") return;
  if (!isElectronHost()) {
    applyFullscreenShellChromeMetrics();
    return;
  }
  applyElectronChromeState(window.desktopBridge?.getWindowChromeState?.() ?? { fullscreen: false });
  window.desktopBridge?.onWindowChromeState?.(applyElectronChromeState);
}
