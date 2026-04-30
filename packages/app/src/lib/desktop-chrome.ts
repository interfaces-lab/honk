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
export const TITLEBAR_CONTROL_OFFSET_TOP_PX =
  MACOS_TRAFFIC_LIGHTS.y - (TITLEBAR_CONTROL_HEIGHT_PX - TRAFFIC_LIGHT_CLUSTER_HEIGHT_PX) / 2;

const INSET = "--multi-electron-traffic-inset";
const TOP = "--multi-electron-traffic-padding-top";
const CONTROL_HEIGHT = "--multi-titlebar-control-height";
const ROW_TOP = "--multi-titlebar-control-row-top";

export function applyDesktopChromeMetrics() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!isElectronHost()) {
    root.style.removeProperty(INSET);
    root.style.removeProperty(TOP);
    root.style.removeProperty(CONTROL_HEIGHT);
    root.style.removeProperty(ROW_TOP);
    return;
  }
  root.style.setProperty(INSET, `${MACOS_TRAFFIC_LIGHTS.spacerWidth}px`);
  root.style.setProperty(TOP, `${MACOS_TRAFFIC_LIGHTS.paddingTop}px`);
  root.style.setProperty(CONTROL_HEIGHT, `${TITLEBAR_CONTROL_HEIGHT_PX}px`);
  root.style.setProperty(ROW_TOP, `${TITLEBAR_CONTROL_OFFSET_TOP_PX}px`);
}
