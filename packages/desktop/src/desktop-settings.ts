import * as FS from "node:fs";
import * as Path from "node:path";
import type { DesktopServerExposureMode, DesktopTheme } from "@multi/contracts";

export interface DesktopSettings {
  readonly serverExposureMode: DesktopServerExposureMode;
  readonly themeSource: DesktopTheme;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  serverExposureMode: "local-only",
  themeSource: "system",
};

export function setDesktopServerExposurePreference(
  settings: DesktopSettings,
  requestedMode: DesktopServerExposureMode,
): DesktopSettings {
  return settings.serverExposureMode === requestedMode
    ? settings
    : {
        ...settings,
        serverExposureMode: requestedMode,
      };
}

export function setDesktopThemePreference(
  settings: DesktopSettings,
  requestedTheme: DesktopTheme,
): DesktopSettings {
  return settings.themeSource === requestedTheme
    ? settings
    : {
        ...settings,
        themeSource: requestedTheme,
      };
}

export function readDesktopSettings(settingsPath: string): DesktopSettings {
  try {
    if (!FS.existsSync(settingsPath)) {
      return DEFAULT_DESKTOP_SETTINGS;
    }

    const raw = FS.readFileSync(settingsPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_DESKTOP_SETTINGS;
    }

    const serverExposureMode =
      "serverExposureMode" in parsed && parsed.serverExposureMode === "network-accessible"
        ? "network-accessible"
        : "local-only";
    const themeSource =
      "themeSource" in parsed &&
      (parsed.themeSource === "light" || parsed.themeSource === "dark")
        ? parsed.themeSource
        : "system";

    return {
      serverExposureMode,
      themeSource,
    };
  } catch {
    return DEFAULT_DESKTOP_SETTINGS;
  }
}

export function writeDesktopSettings(settingsPath: string, settings: DesktopSettings): void {
  const directory = Path.dirname(settingsPath);
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  FS.mkdirSync(directory, { recursive: true });
  FS.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, settingsPath);
}
