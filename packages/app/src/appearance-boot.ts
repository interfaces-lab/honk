import { applyHostMarkers } from "./env";
import { applyStoredTheme } from "./hooks/use-theme";
import { applyDesktopChromeMetrics } from "./lib/desktop-chrome";
import { applyAppearanceBoot } from "./lib/appearance-settings";

applyHostMarkers();
applyDesktopChromeMetrics();
applyStoredTheme();
applyAppearanceBoot();
