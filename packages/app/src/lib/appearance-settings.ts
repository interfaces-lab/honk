import { ALL_PRESET_VAR_KEYS, PIERRE_DARK_VARS, PIERRE_LIGHT_VARS } from "./pierre-color-presets";

export const STORAGE_COLOR_PALETTE = "multi:color-preset";
export const STORAGE_REDUCE_TRANSPARENCY = "multi:reduce-transparency";
export const STORAGE_WINDOW_TRANSPARENCY = "multi:window-transparency";
export const STORAGE_TINT_HUE = "multi:accent-hue";
export const STORAGE_TINT_SATURATION = "multi:accent-saturation";
export const STORAGE_UI_FONT_SIZE = "multi:ui-font-size";
export const STORAGE_CODE_FONT_SIZE = "multi:code-font-size";
export const STORAGE_UI_FONT = "multi:ui-font";
export const STORAGE_CODE_FONT = "multi:mono-font";

export type ColorPaletteId = "multi" | "pierre";

const APPEARANCE_SETTINGS_EVENT = "appearance-settings-changed";

let listeners: Array<() => void> = [];
const keys = new Set([
  STORAGE_COLOR_PALETTE,
  STORAGE_REDUCE_TRANSPARENCY,
  STORAGE_WINDOW_TRANSPARENCY,
  STORAGE_TINT_HUE,
  STORAGE_TINT_SATURATION,
  "multi:accent-intensity",
  STORAGE_UI_FONT_SIZE,
  STORAGE_CODE_FONT_SIZE,
  STORAGE_UI_FONT,
  STORAGE_CODE_FONT,
]);

function emit() {
  for (const fn of listeners) fn();
  window.dispatchEvent(new CustomEvent(APPEARANCE_SETTINGS_EVENT));
}

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
  const raw =
    localStorage.getItem(STORAGE_TINT_SATURATION) ?? localStorage.getItem("multi:accent-intensity");
  return parseIntStored(raw, 33, 0, 100);
}

export function getColorPalette(): ColorPaletteId {
  const raw = localStorage.getItem(STORAGE_COLOR_PALETTE);
  if (raw === "pierre") return "pierre";
  return "multi";
}

export function applyColorPalette() {
  const root = document.documentElement;
  const preset = getColorPalette();
  const hue = parseIntStored(localStorage.getItem(STORAGE_TINT_HUE), 255, 0, 360);
  const saturation = readTintSaturation();

  if (preset === "pierre") {
    const map = root.classList.contains("dark") ? PIERRE_DARK_VARS : PIERRE_LIGHT_VARS;
    for (const k of ALL_PRESET_VAR_KEYS) {
      root.style.removeProperty(k);
    }
    for (const [k, v] of Object.entries(map)) {
      root.style.setProperty(k, v);
    }
    root.style.removeProperty("--multi-user-hue");
    root.style.removeProperty("--multi-intensity");
    emit();
    return;
  }

  for (const k of ALL_PRESET_VAR_KEYS) {
    root.style.removeProperty(k);
  }
  root.style.setProperty("--multi-user-hue", String(hue));
  root.style.setProperty("--multi-intensity", String(saturation));
  emit();
}

function wantsOsVibrancy() {
  if (getColorPalette() !== "multi") return false;
  if (localStorage.getItem(STORAGE_REDUCE_TRANSPARENCY) === "1") return false;
  return true;
}

function syncVibrancy() {
  const bridge = window.desktopBridge as
    | (typeof window.desktopBridge & { setVibrancy?: (enabled: boolean) => Promise<void> })
    | undefined;
  if (!bridge?.setVibrancy) return;
  void bridge.setVibrancy(wantsOsVibrancy());
}

function applyChromeRoot() {
  const root = document.documentElement;

  const reduce = localStorage.getItem(STORAGE_REDUCE_TRANSPARENCY) === "1";
  const transparency = parseIntStored(
    localStorage.getItem(STORAGE_WINDOW_TRANSPARENCY),
    18,
    0,
    100,
  );
  root.classList.toggle("multi-reduce-transparency", reduce);
  root.classList.remove("multi-hide-email");
  root.style.setProperty("--multi-transparency", String(transparency));

  const uiPx = parseIntStored(localStorage.getItem(STORAGE_UI_FONT_SIZE), 13, 11, 16);
  const codePx = parseIntStored(localStorage.getItem(STORAGE_CODE_FONT_SIZE), 12, 10, 18);
  root.style.setProperty("--multi-sidebar-label-size-user", `${uiPx}px`);
  root.style.setProperty("--multi-ui-font-size-user", `${uiPx}px`);
  root.style.setProperty("--multi-code-font-size-user", `${codePx}px`);

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

  applyColorPalette();
}

export function applyAppearanceBoot() {
  applyChromeRoot();
}

function applyAppearanceSettings() {
  applyChromeRoot();
  syncVibrancy();
}

export function resetAppearanceSettings() {
  localStorage.removeItem(STORAGE_COLOR_PALETTE);
  localStorage.removeItem(STORAGE_WINDOW_TRANSPARENCY);
  localStorage.removeItem(STORAGE_TINT_HUE);
  localStorage.removeItem(STORAGE_TINT_SATURATION);
  localStorage.removeItem("multi:accent-intensity");
  localStorage.removeItem(STORAGE_REDUCE_TRANSPARENCY);
  localStorage.removeItem(STORAGE_UI_FONT_SIZE);
  localStorage.removeItem(STORAGE_CODE_FONT_SIZE);
  localStorage.removeItem(STORAGE_UI_FONT);
  localStorage.removeItem(STORAGE_CODE_FONT);
  localStorage.removeItem("multi:hide-email");
  applyAppearanceSettings();
}

export function setColorPalette(next: ColorPaletteId) {
  localStorage.setItem(STORAGE_COLOR_PALETTE, next);
  applyAppearanceSettings();
}

export function setReduceTransparency(on: boolean) {
  localStorage.setItem(STORAGE_REDUCE_TRANSPARENCY, on ? "1" : "0");
  applyAppearanceSettings();
}

export function setWindowTransparency(value: number) {
  localStorage.setItem(STORAGE_WINDOW_TRANSPARENCY, String(Math.min(100, Math.max(0, value))));
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

type AppearanceSnapshot = {
  readonly palette: ColorPaletteId;
  readonly reduceTransparency: boolean;
  readonly transparency: number;
  readonly hue: number;
  readonly saturation: number;
  readonly uiFontSize: number;
  readonly codeFontSize: number;
  readonly uiFont: string;
  readonly codeFont: string;
};

function buildSnapshot(): AppearanceSnapshot {
  return {
    palette: getColorPalette(),
    reduceTransparency: localStorage.getItem(STORAGE_REDUCE_TRANSPARENCY) === "1",
    transparency: parseIntStored(localStorage.getItem(STORAGE_WINDOW_TRANSPARENCY), 18, 0, 100),
    hue: parseIntStored(localStorage.getItem(STORAGE_TINT_HUE), 255, 0, 360),
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
    cached.palette === next.palette &&
    cached.reduceTransparency === next.reduceTransparency &&
    cached.transparency === next.transparency &&
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
