import type { DesktopAppBranding } from "@multi/contracts";

function readInjectedDesktopAppBranding(): DesktopAppBranding | null {
  return globalThis.window?.desktopBridge?.getAppBranding?.() ?? null;
}

const injectedDesktopAppBranding = readInjectedDesktopAppBranding();
const fallbackStageLabel = import.meta.env.DEV ? "Dev" : null;

export const APP_BASE_NAME = injectedDesktopAppBranding?.baseName ?? "Multi";
export const APP_STAGE_LABEL = injectedDesktopAppBranding
  ? injectedDesktopAppBranding.stageLabel
  : fallbackStageLabel;
export const APP_DISPLAY_NAME =
  injectedDesktopAppBranding?.displayName ??
  (APP_STAGE_LABEL ? `${APP_BASE_NAME} (${APP_STAGE_LABEL})` : APP_BASE_NAME);
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
