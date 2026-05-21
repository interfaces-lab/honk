import type { DesktopAppBranding, DesktopAppStageLabel } from "@multi/contracts";

const APP_BASE_NAME = "Multi";

export function resolveDesktopAppStageLabel(input: {
  readonly isDevelopment: boolean;
}): DesktopAppStageLabel | null {
  if (input.isDevelopment) {
    return "Dev";
  }

  return null;
}

export function resolveDesktopAppBranding(input: {
  readonly isDevelopment: boolean;
}): DesktopAppBranding {
  const stageLabel = resolveDesktopAppStageLabel(input);
  return {
    baseName: APP_BASE_NAME,
    stageLabel,
    displayName: stageLabel ? `${APP_BASE_NAME} (${stageLabel})` : APP_BASE_NAME,
  };
}
