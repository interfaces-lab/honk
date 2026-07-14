// Per-device appearance store (ADR 0025 §2). Plain {subscribe, getSnapshot, actions}
// module — same idiom as tab-store. Persists to localStorage; applies by rewriting
// published --honk-* custom properties on <html> the way packages/ui/dev/dials.ts does
// (inline setProperty beats the stylesheet defaults StyleX emits for defineVars).
//
// Apply runs at action time and once at module init — never in a component effect.

import { useSyncExternalStore } from "react";

import { colorVars, fontVars } from "@honk/ui/tokens.stylex";

export type ThemePreference = "system" | "light" | "dark";

export type AppearanceSnapshot = {
  readonly theme: ThemePreference;
  readonly tintHue: number;
  readonly tintIntensity: number;
  readonly reduceTransparency: boolean;
  readonly uiFontSize: number;
  readonly codeFontSize: number;
};

export const DEFAULT_APPEARANCE: AppearanceSnapshot = Object.freeze({
  theme: "system",
  tintHue: 210,
  tintIntensity: 0,
  reduceTransparency: false,
  uiFontSize: 13,
  codeFontSize: 12,
});

const STORAGE_KEY = "honk:app-next:appearance";

const UI_FONT_MIN = 11;
const UI_FONT_MAX = 16;
const CODE_FONT_MIN = 10;
const CODE_FONT_MAX = 18;

// StyleX defineVars compile to { '--honk-…': 'var(--honk-…)' }. Unwrap the reference
// back to the property name setProperty needs (dials.ts cssVarName).
function cssVarName(reference: unknown): string {
  const match = /^var\((--[^),\s]+)/.exec(String(reference));
  if (match?.[1] === undefined) {
    throw new Error(`appearance-store: not a StyleX var reference: ${String(reference)}`);
  }
  return match[1];
}

const ACCENT_VAR = cssVarName(colorVars["--honk-color-accent"]);
const FONT_SIZE_BODY_VAR = cssVarName(fontVars["--honk-font-size-body"]);
const FONT_SIZE_DETAIL_VAR = cssVarName(fontVars["--honk-font-size-detail"]);
const FONT_SIZE_CAPTION_VAR = cssVarName(fontVars["--honk-font-size-caption"]);
const FONT_SIZE_MICRO_VAR = cssVarName(fontVars["--honk-font-size-micro"]);
// No dedicated code-size token yet — prose detail is the closest mono-adjacent size
// consumers already read; a real --honk-code-font-size token is a DS gap.
const CODE_SIZE_VAR = cssVarName(fontVars["--honk-text-detail"]);

const listeners = new Set<() => void>();

let snapshot = hydrate();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): AppearanceSnapshot {
  return snapshot;
}

export function getServerSnapshot(): AppearanceSnapshot {
  return DEFAULT_APPEARANCE;
}

export function useAppearance(): AppearanceSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useAppearanceTheme(): ThemePreference {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().theme,
    () => DEFAULT_APPEARANCE.theme,
  );
}

export const actions = {
  setTheme(theme: ThemePreference): void {
    publish({ ...snapshot, theme });
  },

  setTintHue(tintHue: number): void {
    publish({ ...snapshot, tintHue: clamp(tintHue, 0, 360) });
  },

  setTintIntensity(tintIntensity: number): void {
    publish({ ...snapshot, tintIntensity: clamp(tintIntensity, 0, 100) });
  },

  setReduceTransparency(reduceTransparency: boolean): void {
    publish({ ...snapshot, reduceTransparency });
  },

  setUiFontSize(uiFontSize: number): void {
    publish({ ...snapshot, uiFontSize: clamp(uiFontSize, UI_FONT_MIN, UI_FONT_MAX) });
  },

  setCodeFontSize(codeFontSize: number): void {
    publish({
      ...snapshot,
      codeFontSize: clamp(codeFontSize, CODE_FONT_MIN, CODE_FONT_MAX),
    });
  },

  resetTheme(): void {
    publish({ ...snapshot, theme: DEFAULT_APPEARANCE.theme });
  },

  resetTintHue(): void {
    publish({ ...snapshot, tintHue: DEFAULT_APPEARANCE.tintHue });
  },

  resetTintIntensity(): void {
    publish({ ...snapshot, tintIntensity: DEFAULT_APPEARANCE.tintIntensity });
  },

  resetReduceTransparency(): void {
    publish({
      ...snapshot,
      reduceTransparency: DEFAULT_APPEARANCE.reduceTransparency,
    });
  },

  resetUiFontSize(): void {
    publish({ ...snapshot, uiFontSize: DEFAULT_APPEARANCE.uiFontSize });
  },

  resetCodeFontSize(): void {
    publish({ ...snapshot, codeFontSize: DEFAULT_APPEARANCE.codeFontSize });
  },

  // Section-level reset (parity: typography/appearance Reset).
  resetAll(): void {
    publish(DEFAULT_APPEARANCE);
  },
} as const;

function publish(next: AppearanceSnapshot): void {
  if (
    next.theme === snapshot.theme &&
    next.tintHue === snapshot.tintHue &&
    next.tintIntensity === snapshot.tintIntensity &&
    next.reduceTransparency === snapshot.reduceTransparency &&
    next.uiFontSize === snapshot.uiFontSize &&
    next.codeFontSize === snapshot.codeFontSize
  ) {
    return;
  }

  snapshot = Object.freeze({ ...next });
  persist(snapshot);
  applyAppearance(snapshot);

  for (const listener of listeners) {
    listener();
  }
}

// dials.ts applyPanelValues: at the config default → un-pin (removeProperty) so the
// stylesheet token (both arms of a light-dark() pair) paints again; otherwise setProperty.
function applyAppearance(next: AppearanceSnapshot): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const rootStyle = root.style;

  // Theme drives light-dark() resolution — a scheme keyword, not a --honk-* var
  // (dials.ts Theme panel). Shell still needs its own xstyle pin; this covers everything
  // outside the frame and keeps first paint honest before React mounts.
  rootStyle.colorScheme =
    next.theme === "light" || next.theme === "dark" ? next.theme : "light dark";

  // Tint → accent. Intensity 0 (default) un-pins so light-dark() accent stays in charge.
  if (
    next.tintIntensity === DEFAULT_APPEARANCE.tintIntensity &&
    next.tintHue === DEFAULT_APPEARANCE.tintHue
  ) {
    rootStyle.removeProperty(ACCENT_VAR);
  } else if (next.tintIntensity === 0) {
    rootStyle.removeProperty(ACCENT_VAR);
  } else {
    rootStyle.setProperty(ACCENT_VAR, accentHex(next.tintHue, next.tintIntensity));
  }

  // Reduce transparency: attribute seam for a future surface createTheme swap. The rewrite
  // has no glass/vibrancy tokens yet — persisting + marking is the honest apply today.
  if (next.reduceTransparency) {
    root.dataset.reduceTransparency = "";
  } else {
    delete root.dataset.reduceTransparency;
  }

  // UI chrome ramp — body is the dialed size; siblings keep their default offsets from 13.
  if (next.uiFontSize === DEFAULT_APPEARANCE.uiFontSize) {
    rootStyle.removeProperty(FONT_SIZE_BODY_VAR);
    rootStyle.removeProperty(FONT_SIZE_DETAIL_VAR);
    rootStyle.removeProperty(FONT_SIZE_CAPTION_VAR);
    rootStyle.removeProperty(FONT_SIZE_MICRO_VAR);
  } else {
    const body = next.uiFontSize;
    rootStyle.setProperty(FONT_SIZE_BODY_VAR, `${body}px`);
    rootStyle.setProperty(FONT_SIZE_DETAIL_VAR, `${Math.max(body - 1, 8)}px`);
    rootStyle.setProperty(FONT_SIZE_CAPTION_VAR, `${Math.max(body - 2, 8)}px`);
    rootStyle.setProperty(FONT_SIZE_MICRO_VAR, `${Math.max(body - 3, 8)}px`);
  }

  if (next.codeFontSize === DEFAULT_APPEARANCE.codeFontSize) {
    rootStyle.removeProperty(CODE_SIZE_VAR);
  } else {
    rootStyle.setProperty(CODE_SIZE_VAR, `${next.codeFontSize}px`);
  }
}

function accentHex(hue: number, intensity: number): string {
  // Lightness sits near the dark-arm accent so a dialed tint stays readable on both
  // schemes until a real per-arm tint builder lands (old appearance-colors.ts).
  const s = intensity / 100;
  const l = 0.55;
  return hslToHex(hue, s, l);
}

function hslToHex(h: number, s: number, l: number): string {
  if (s === 0) {
    const channel = Math.round(l * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${channel}${channel}${channel}`;
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = h / 360;
  const r = Math.round(hueToRgb(p, q, hk + 1 / 3) * 255);
  const g = Math.round(hueToRgb(p, q, hk) * 255);
  const b = Math.round(hueToRgb(p, q, hk - 1 / 3) * 255);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b
    .toString(16)
    .padStart(2, "0")}`;
}

function hueToRgb(p: number, q: number, t: number): number {
  let wrappedHue = t;
  if (wrappedHue < 0) wrappedHue += 1;
  if (wrappedHue > 1) wrappedHue -= 1;
  if (wrappedHue < 1 / 6) return p + (q - p) * 6 * wrappedHue;
  if (wrappedHue < 1 / 2) return q;
  if (wrappedHue < 2 / 3) return p + (q - p) * (2 / 3 - wrappedHue) * 6;
  return p;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function hydrate(): AppearanceSnapshot {
  if (typeof window === "undefined") {
    return DEFAULT_APPEARANCE;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_APPEARANCE;
    }

    const parsed = JSON.parse(raw) as Partial<AppearanceSnapshot>;
    return Object.freeze({
      theme:
        parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system"
          ? parsed.theme
          : DEFAULT_APPEARANCE.theme,
      tintHue: clamp(
        typeof parsed.tintHue === "number" ? parsed.tintHue : DEFAULT_APPEARANCE.tintHue,
        0,
        360,
      ),
      tintIntensity: clamp(
        typeof parsed.tintIntensity === "number"
          ? parsed.tintIntensity
          : DEFAULT_APPEARANCE.tintIntensity,
        0,
        100,
      ),
      reduceTransparency:
        typeof parsed.reduceTransparency === "boolean"
          ? parsed.reduceTransparency
          : DEFAULT_APPEARANCE.reduceTransparency,
      uiFontSize: clamp(
        typeof parsed.uiFontSize === "number"
          ? parsed.uiFontSize
          : DEFAULT_APPEARANCE.uiFontSize,
        UI_FONT_MIN,
        UI_FONT_MAX,
      ),
      codeFontSize: clamp(
        typeof parsed.codeFontSize === "number"
          ? parsed.codeFontSize
          : DEFAULT_APPEARANCE.codeFontSize,
        CODE_FONT_MIN,
        CODE_FONT_MAX,
      ),
    });
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function persist(next: AppearanceSnapshot): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Persistence must never break the appearance plane.
  }
}

// Apply once at import so a reload restores CSS vars before React paints (dials bind-at-import).
if (typeof document !== "undefined") {
  applyAppearance(snapshot);
}
