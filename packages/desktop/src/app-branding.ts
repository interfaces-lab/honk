import type { DesktopAppBranding, DesktopAppStageLabel } from "@honk/contracts";

const APP_BASE_NAME = "Honk";

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
