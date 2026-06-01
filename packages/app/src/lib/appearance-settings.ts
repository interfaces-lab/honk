import { isElectron } from "../env";
import {
  DEFAULT_APPEARANCE_TINT_HUE,
  DEFAULT_APPEARANCE_TINT_INTENSITY,
  applyAppearanceBaseColors,
  getAppearanceThemeMode,
} from "./appearance-colors";

export const STORAGE_REDUCE_TRANSPARENCY = "multi:reduce-transparency";
export const STORAGE_TINT_HUE = "multi:accent-hue";
export const STORAGE_TINT_SATURATION = "multi:accent-saturation";
export const STORAGE_UI_FONT_SIZE = "multi:ui-font-size";
export const STORAGE_CODE_FONT_SIZE = "multi:code-font-size";
export const STORAGE_UI_FONT = "multi:ui-font";
export const STORAGE_CODE_FONT = "multi:mono-font";

export const APPEARANCE_SETTINGS_CHANGED = "appearance-settings-changed" as const;

let listeners: Array<() => void> = [];
const keys = new Set([
  STORAGE_REDUCE_TRANSPARENCY,
  STORAGE_TINT_HUE,
  STORAGE_TINT_SATURATION,
  STORAGE_UI_FONT_SIZE,
  STORAGE_CODE_FONT_SIZE,
  STORAGE_UI_FONT,
  STORAGE_CODE_FONT,
]);

export function subscribeAppearanceSettings(cb: () => void) {
  listeners.push(cb);

  const sync = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return;
    if (event.key !== null && !keys.has(event.key)) return;
    applyAppearanceSettings();
  };

  window.addEventListener("storage", sync);

  return () => {
    listeners = listeners.filter((x) => x !== cb);
    window.removeEventListener("storage", sync);
  };
}

function parseIntStored(raw: string | null, fallback: number, min: number, max: number) {
  if (raw === null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function readTintSaturation() {
  return parseIntStored(
    localStorage.getItem(STORAGE_TINT_SATURATION),
    DEFAULT_APPEARANCE_TINT_INTENSITY,
    0,
    100,
  );
}

function emitAppearanceSettingsChanged() {
  for (const listener of listeners) listener();
  window.dispatchEvent(new CustomEvent(APPEARANCE_SETTINGS_CHANGED));
}

function wantsOsVibrancy() {
  if (localStorage.getItem(STORAGE_REDUCE_TRANSPARENCY) === "1") return false;
  if (!isElectron) return false;
  if (document.body.getAttribute("data-multi-glass-mode") !== "true") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function syncVibrancy() {
  const wantsVibrancy = wantsOsVibrancy();
  const glassMode = document.body.getAttribute("data-multi-glass-mode") === "true";
  document.body.classList.toggle("multi-os-vibrancy-on", glassMode && wantsVibrancy);
  document.body.classList.toggle("multi-os-vibrancy-off", glassMode && !wantsVibrancy);

  const bridge = window.desktopBridge;
  if (!bridge?.setVibrancy) return;
  void bridge.setVibrancy(wantsVibrancy);
}

export function syncAppearanceVibrancy() {
  syncVibrancy();
}

function applyChromeRoot() {
  const root = document.documentElement;
  const body = document.body;

  const reduce = localStorage.getItem(STORAGE_REDUCE_TRANSPARENCY) === "1";
  body.classList.toggle("multi-reduce-transparency", reduce);

  const uiPx = parseIntStored(localStorage.getItem(STORAGE_UI_FONT_SIZE), 13, 11, 16);
  const codePx = parseIntStored(localStorage.getItem(STORAGE_CODE_FONT_SIZE), 12, 10, 18);
  root.style.setProperty("--multi-ui-font-size-user", `${uiPx}px`);
  root.style.setProperty("--multi-code-font-size-user", `${codePx}px`);
  root.style.removeProperty("--multi-sidebar-label-size-user");
  root.style.removeProperty("--multi-sidebar-label-leading-user");

  const uiFont = localStorage.getItem(STORAGE_UI_FONT)?.trim() ?? "";
  const codeFont = localStorage.getItem(STORAGE_CODE_FONT)?.trim() ?? "";
  if (uiFont) {
    root.style.setProperty("--multi-font-ui", uiFont);
  } else {
    root.style.removeProperty("--multi-font-ui");
  }
  if (codeFont) {
    root.style.setProperty("--multi-font-mono", codeFont);
  } else {
    root.style.removeProperty("--multi-font-mono");
  }

  const hue = parseIntStored(
    localStorage.getItem(STORAGE_TINT_HUE),
    DEFAULT_APPEARANCE_TINT_HUE,
    0,
    360,
  );
  const intensity = readTintSaturation();
  root.style.setProperty("--multi-user-hue", String(hue));
  root.style.setProperty("--multi-intensity", String(intensity));
  applyAppearanceBaseColors(root, getAppearanceThemeMode(root), hue, intensity);
}

export function applyAppearanceBoot() {
  applyChromeRoot();
  syncVibrancy();
}

function applyAppearanceSettings() {
  applyChromeRoot();
  syncVibrancy();
  emitAppearanceSettingsChanged();
}

export function resetAppearanceSettings() {
  localStorage.removeItem(STORAGE_TINT_HUE);
  localStorage.removeItem(STORAGE_TINT_SATURATION);
  localStorage.removeItem(STORAGE_REDUCE_TRANSPARENCY);
  localStorage.removeItem(STORAGE_UI_FONT_SIZE);
  localStorage.removeItem(STORAGE_CODE_FONT_SIZE);
  localStorage.removeItem(STORAGE_UI_FONT);
  localStorage.removeItem(STORAGE_CODE_FONT);
  applyAppearanceSettings();
}

export function setReduceTransparency(on: boolean) {
  localStorage.setItem(STORAGE_REDUCE_TRANSPARENCY, on ? "1" : "0");
  applyAppearanceSettings();
}

export function setTintHue(value: number) {
  localStorage.setItem(STORAGE_TINT_HUE, String(Math.min(360, Math.max(0, value))));
  applyAppearanceSettings();
}

export function setTintSaturation(value: number) {
  localStorage.setItem(STORAGE_TINT_SATURATION, String(Math.min(100, Math.max(0, value))));
  applyAppearanceSettings();
}

export function setUiFontSize(px: number) {
  localStorage.setItem(STORAGE_UI_FONT_SIZE, String(px));
  applyAppearanceSettings();
}

export function setCodeFontSize(px: number) {
  localStorage.setItem(STORAGE_CODE_FONT_SIZE, String(px));
  applyAppearanceSettings();
}

export function setUiFontFamily(css: string) {
  if (css.trim()) {
    localStorage.setItem(STORAGE_UI_FONT, css);
  } else {
    localStorage.removeItem(STORAGE_UI_FONT);
  }
  applyAppearanceSettings();
}

export function setCodeFontFamily(css: string) {
  if (css.trim()) {
    localStorage.setItem(STORAGE_CODE_FONT, css);
  } else {
    localStorage.removeItem(STORAGE_CODE_FONT);
  }
  applyAppearanceSettings();
}

export type AppearanceSnapshot = {
  readonly reduceTransparency: boolean;
  readonly hue: number;
  readonly saturation: number;
  readonly uiFontSize: number;
  readonly codeFontSize: number;
  readonly uiFont: string;
  readonly codeFont: string;
};

function buildSnapshot(): AppearanceSnapshot {
  return {
    reduceTransparency: localStorage.getItem(STORAGE_REDUCE_TRANSPARENCY) === "1",
    hue: parseIntStored(
      localStorage.getItem(STORAGE_TINT_HUE),
      DEFAULT_APPEARANCE_TINT_HUE,
      0,
      360,
    ),
    saturation: readTintSaturation(),
    uiFontSize: parseIntStored(localStorage.getItem(STORAGE_UI_FONT_SIZE), 13, 11, 16),
    codeFontSize: parseIntStored(localStorage.getItem(STORAGE_CODE_FONT_SIZE), 12, 10, 18),
    uiFont: localStorage.getItem(STORAGE_UI_FONT)?.trim() ?? "",
    codeFont: localStorage.getItem(STORAGE_CODE_FONT)?.trim() ?? "",
  };
}

let cached: AppearanceSnapshot | undefined;

export function readAppearanceSnapshot() {
  const next = buildSnapshot();
  if (
    cached &&
    cached.reduceTransparency === next.reduceTransparency &&
    cached.hue === next.hue &&
    cached.saturation === next.saturation &&
    cached.uiFontSize === next.uiFontSize &&
    cached.codeFontSize === next.codeFontSize &&
    cached.uiFont === next.uiFont &&
    cached.codeFont === next.codeFont
  ) {
    return cached;
  }
  cached = next;
  return next;
}
