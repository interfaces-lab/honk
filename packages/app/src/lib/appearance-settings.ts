import { isElectron } from "../env";
import {
  DEFAULT_APPEARANCE_TINT_HUE,
  DEFAULT_APPEARANCE_TINT_INTENSITY,
  applyAppearanceBaseColors,
  getAppearanceThemeMode,
} from "./appearance-colors";
import { BASE_UI_FONT_PX, uiFontSizeToZoomFactor } from "./display-zoom";

export const STORAGE_REDUCE_TRANSPARENCY = "honk:reduce-transparency";
export const STORAGE_TINT_HUE = "honk:accent-hue";
export const STORAGE_TINT_SATURATION = "honk:accent-saturation";
export const STORAGE_UI_FONT_SIZE = "honk:ui-font-size";
export const STORAGE_CODE_FONT_SIZE = "honk:code-font-size";
export const STORAGE_UI_FONT = "honk:ui-font";
export const STORAGE_CODE_FONT = "honk:mono-font";

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
    liveAppearance = undefined;
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

function readTintSaturationFromStorage() {
  return parseIntStored(
    localStorage.getItem(STORAGE_TINT_SATURATION),
    DEFAULT_APPEARANCE_TINT_INTENSITY,
    0,
    100,
  );
}

function clampTintHue(value: number) {
  return Math.min(360, Math.max(0, value));
}

function clampTintSaturation(value: number) {
  return Math.min(100, Math.max(0, value));
}

function emitAppearanceSettingsChanged() {
  for (const listener of listeners) listener();
  window.dispatchEvent(new CustomEvent(APPEARANCE_SETTINGS_CHANGED));
}

function wantsOsVibrancy() {
  if (getLiveAppearance().reduceTransparency) return false;
  if (!isElectron) return false;
  if (document.body.getAttribute("data-honk-glass-mode") !== "true") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function syncVibrancy() {
  const wantsVibrancy = wantsOsVibrancy();
  const glassMode = document.body.getAttribute("data-honk-glass-mode") === "true";
  document.body.classList.toggle("honk-os-vibrancy-on", glassMode && wantsVibrancy);
  document.body.classList.toggle("honk-os-vibrancy-off", glassMode && !wantsVibrancy);

  const bridge = window.desktopBridge;
  if (!bridge?.setVibrancy) return;
  void bridge.setVibrancy(wantsVibrancy);
}

function readStoredUiFontSizePx() {
  return parseIntStored(localStorage.getItem(STORAGE_UI_FONT_SIZE), BASE_UI_FONT_PX, 11, 16);
}

export function syncAppearanceDisplayZoom() {
  const uiFontSizePx = readStoredUiFontSizePx();
  const zoomFactor = uiFontSizeToZoomFactor(uiFontSizePx);
  const root = document.documentElement;
  root.style.setProperty("--honk-display-zoom-factor", String(zoomFactor));

  if (!isElectron) {
    return;
  }

  const bridge = window.desktopBridge;
  if (!bridge?.setDisplayZoom) return;
  void bridge.setDisplayZoom(zoomFactor);
}

export function syncAppearanceVibrancy() {
  syncVibrancy();
}

function applyTintToDom(hue: number, intensity: number) {
  const root = document.documentElement;
  root.style.setProperty("--honk-user-hue", String(hue));
  root.style.setProperty("--honk-intensity", String(intensity));
  applyAppearanceBaseColors(root, getAppearanceThemeMode(root), hue, intensity);
}

function applyChromeRoot() {
  const root = document.documentElement;
  const body = document.body;
  const appearance = getLiveAppearance();

  body.classList.toggle("honk-reduce-transparency", appearance.reduceTransparency);

  root.style.setProperty("--honk-ui-font-size-user", `${BASE_UI_FONT_PX}px`);
  root.style.setProperty("--honk-code-font-size-user", `${appearance.codeFontSize}px`);

  if (appearance.uiFont) {
    root.style.setProperty("--honk-font-ui", appearance.uiFont);
  } else {
    root.style.removeProperty("--honk-font-ui");
  }
  if (appearance.codeFont) {
    root.style.setProperty("--honk-font-mono", appearance.codeFont);
  } else {
    root.style.removeProperty("--honk-font-mono");
  }

  applyTintToDom(appearance.hue, appearance.saturation);
}

export function applyAppearanceBoot() {
  applyChromeRoot();
  syncVibrancy();
  syncAppearanceDisplayZoom();
}

function applyAppearanceSettings() {
  applyChromeRoot();
  syncVibrancy();
  syncAppearanceDisplayZoom();
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
  liveAppearance = undefined;
  applyAppearanceSettings();
}

const TINT_PERSIST_DELAY_MS = 300;

let tintPersistTimer: ReturnType<typeof setTimeout> | undefined;

function persistTintToStorage() {
  const { hue, saturation } = getLiveAppearance();
  localStorage.setItem(STORAGE_TINT_HUE, String(hue));
  localStorage.setItem(STORAGE_TINT_SATURATION, String(saturation));
}

function scheduleTintPersist() {
  if (tintPersistTimer !== undefined) {
    clearTimeout(tintPersistTimer);
  }
  tintPersistTimer = setTimeout(() => {
    tintPersistTimer = undefined;
    persistTintToStorage();
  }, TINT_PERSIST_DELAY_MS);
}

function previewTint(hue: number, intensity: number) {
  const nextHue = clampTintHue(hue);
  const nextSaturation = clampTintSaturation(intensity);
  updateLiveAppearance((current) => ({
    ...current,
    hue: nextHue,
    saturation: nextSaturation,
  }));
  applyTintToDom(nextHue, nextSaturation);
  emitAppearanceSettingsChanged();
  scheduleTintPersist();
}

export function previewTintHue(value: number, intensity: number) {
  previewTint(value, intensity);
}

export function previewTintSaturation(hue: number, value: number) {
  previewTint(hue, value);
}

export function setReduceTransparency(on: boolean) {
  updateLiveAppearance((current) => ({ ...current, reduceTransparency: on }));
  localStorage.setItem(STORAGE_REDUCE_TRANSPARENCY, on ? "1" : "0");
  applyAppearanceSettings();
}

export function setTintHue(value: number) {
  const hue = clampTintHue(value);
  updateLiveAppearance((current) => ({ ...current, hue }));
  localStorage.setItem(STORAGE_TINT_HUE, String(hue));
  applyAppearanceSettings();
}

export function setTintSaturation(value: number) {
  const saturation = clampTintSaturation(value);
  updateLiveAppearance((current) => ({ ...current, saturation }));
  localStorage.setItem(STORAGE_TINT_SATURATION, String(saturation));
  applyAppearanceSettings();
}

export function setUiFontSize(px: number) {
  updateLiveAppearance((current) => ({ ...current, uiFontSize: px }));
  localStorage.setItem(STORAGE_UI_FONT_SIZE, String(px));
  applyAppearanceSettings();
}

export function setCodeFontSize(px: number) {
  updateLiveAppearance((current) => ({ ...current, codeFontSize: px }));
  localStorage.setItem(STORAGE_CODE_FONT_SIZE, String(px));
  applyAppearanceSettings();
}

export function setUiFontFamily(css: string) {
  const uiFont = css.trim();
  updateLiveAppearance((current) => ({ ...current, uiFont }));
  if (uiFont) {
    localStorage.setItem(STORAGE_UI_FONT, uiFont);
  } else {
    localStorage.removeItem(STORAGE_UI_FONT);
  }
  applyAppearanceSettings();
}

export function setCodeFontFamily(css: string) {
  const codeFont = css.trim();
  updateLiveAppearance((current) => ({ ...current, codeFont }));
  if (codeFont) {
    localStorage.setItem(STORAGE_CODE_FONT, codeFont);
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

function readSnapshotFromStorage(): AppearanceSnapshot {
  return {
    reduceTransparency: localStorage.getItem(STORAGE_REDUCE_TRANSPARENCY) === "1",
    hue: parseIntStored(
      localStorage.getItem(STORAGE_TINT_HUE),
      DEFAULT_APPEARANCE_TINT_HUE,
      0,
      360,
    ),
    saturation: readTintSaturationFromStorage(),
    uiFontSize: parseIntStored(localStorage.getItem(STORAGE_UI_FONT_SIZE), 13, 11, 16),
    codeFontSize: parseIntStored(localStorage.getItem(STORAGE_CODE_FONT_SIZE), 12, 10, 18),
    uiFont: localStorage.getItem(STORAGE_UI_FONT)?.trim() ?? "",
    codeFont: localStorage.getItem(STORAGE_CODE_FONT)?.trim() ?? "",
  };
}

let liveAppearance: AppearanceSnapshot | undefined;

function getLiveAppearance(): AppearanceSnapshot {
  liveAppearance ??= readSnapshotFromStorage();
  return liveAppearance;
}

function updateLiveAppearance(
  updater: (current: AppearanceSnapshot) => AppearanceSnapshot,
): void {
  liveAppearance = updater(getLiveAppearance());
  cached = undefined;
}

let cached: AppearanceSnapshot | undefined;

export function readAppearanceSnapshot() {
  const next = getLiveAppearance();
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
