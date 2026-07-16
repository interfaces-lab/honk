import { honkTheme, type ThemeMode } from "@honk/ui/theme";

function resolvedThemeMode(shouldUseDarkColors: boolean): ThemeMode {
  return shouldUseDarkColors ? "dark" : "light";
}

function desktopWindowBackground(shouldUseDarkColors: boolean): string {
  // Must equal the CSS frame's `--honk-workbench-root-background` (bgDeep) so the native
  // window paint (first frame, resize, rounded corners) never seams against the backdrop.
  return honkTheme.colors[resolvedThemeMode(shouldUseDarkColors)].bgDeep;
}

function desktopGlassBackground(shouldUseDarkColors: boolean): string {
  // Cursor Glass uses a native material with an AARRGGBB tint, not a translucent palette color.
  return shouldUseDarkColors ? "#40000000" : "#00FFFFFF";
}

export { desktopGlassBackground, desktopWindowBackground };
