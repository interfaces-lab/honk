export type AppearanceThemeMode = "light" | "dark";

export type AppearanceBaseTokenName =
  | "--multi-base-sidebar"
  | "--multi-base-chrome"
  | "--multi-base-editor"
  | "--multi-base-accent"
  | "--multi-base-focus";

export type AppearanceBaseColors = Record<AppearanceBaseTokenName, string>;

type CursorCoreToken = "sidebar" | "chrome" | "editor" | "accent" | "focus";

type CursorCoreColors = Record<CursorCoreToken, string>;

type CursorCoreTokenName =
  | "--cursor-sidebar"
  | "--cursor-chrome"
  | "--cursor-editor"
  | "--cursor-accent"
  | "--cursor-focus";

type MultiCursorTokenName =
  | "--multi-cursor-sidebar"
  | "--multi-cursor-chrome"
  | "--multi-cursor-editor"
  | "--multi-cursor-accent"
  | "--multi-cursor-focus";

type HslColor = {
  readonly h: number;
  readonly s: number;
  readonly l: number;
};

type TintTokenConfig = {
  readonly token: CursorCoreToken;
  readonly chromaScale?: number;
  readonly hueShift?: boolean;
};

const CURSOR_CORE_COLORS: Record<AppearanceThemeMode, CursorCoreColors> = {
  light: {
    sidebar: "#F3F3F3",
    chrome: "#F8F8F8",
    editor: "#FCFCFC",
    accent: "#3685BF",
    focus: "#3685BF",
  },
  dark: {
    sidebar: "#181818",
    chrome: "#141414",
    editor: "#181818",
    accent: "#599CE7",
    focus: "#E4E4E4",
  },
};

const TINT_TOKENS: readonly TintTokenConfig[] = [
  { token: "sidebar" },
  { token: "chrome", chromaScale: 0.5 },
  { token: "editor", chromaScale: 0.5 },
  { token: "accent", hueShift: true },
  { token: "focus", hueShift: true },
];

const APPEARANCE_BASE_TOKEN_NAMES: readonly AppearanceBaseTokenName[] = [
  "--multi-base-sidebar",
  "--multi-base-chrome",
  "--multi-base-editor",
  "--multi-base-accent",
  "--multi-base-focus",
];

const MULTI_CURSOR_TOKEN_NAMES: readonly MultiCursorTokenName[] = [
  "--multi-cursor-sidebar",
  "--multi-cursor-chrome",
  "--multi-cursor-editor",
  "--multi-cursor-accent",
  "--multi-cursor-focus",
];

const CURSOR_CORE_TOKEN_NAMES: readonly CursorCoreTokenName[] = [
  "--cursor-sidebar",
  "--cursor-chrome",
  "--cursor-editor",
  "--cursor-accent",
  "--cursor-focus",
];

const APPEARANCE_TINT_STYLE_ID = "multi-custom-tint-tokens";

export const DEFAULT_APPEARANCE_TINT_HUE = 261;
export const DEFAULT_APPEARANCE_TINT_INTENSITY = 20;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHue(hue: number) {
  if (!Number.isFinite(hue)) return DEFAULT_APPEARANCE_TINT_HUE;
  return clamp(Math.round(hue), 0, 360);
}

function normalizeIntensity(intensity: number) {
  if (!Number.isFinite(intensity)) return DEFAULT_APPEARANCE_TINT_INTENSITY;
  return clamp(Math.round(intensity), 0, 100);
}

function hexToHsl(hex: string): HslColor {
  const normalized = hex.replace("#", "").trim();
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;

  if (max === r) {
    h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / delta + 2) / 6;
  } else {
    h = ((r - g) / delta + 4) / 6;
  }

  return { h: h * 360, s, l };
}

function hueToRgb(p: number, q: number, t: number) {
  let normalizedT = t;
  if (normalizedT < 0) normalizedT += 1;
  if (normalizedT > 1) normalizedT -= 1;
  if (normalizedT < 1 / 6) return p + (q - p) * 6 * normalizedT;
  if (normalizedT < 1 / 2) return q;
  if (normalizedT < 2 / 3) return p + (q - p) * (2 / 3 - normalizedT) * 6;
  return p;
}

function hslToHex(color: HslColor) {
  if (color.s === 0) {
    const channel = Math.round(color.l * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${channel}${channel}${channel}`.toUpperCase();
  }

  const q = color.l < 0.5 ? color.l * (1 + color.s) : color.l + color.s - color.l * color.s;
  const p = 2 * color.l - q;
  const h = color.h / 360;
  const r = Math.round(hueToRgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hueToRgb(p, q, h) * 255);
  const b = Math.round(hueToRgb(p, q, h - 1 / 3) * 255);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b
    .toString(16)
    .padStart(2, "0")}`.toUpperCase();
}

function tintSurface(hex: string, hue: number, intensity: number) {
  const { l } = hexToHsl(hex);
  return hslToHex({ h: hue, s: intensity / 100, l });
}

function shiftHue(hex: string, hue: number) {
  const { s, l } = hexToHsl(hex);
  return hslToHex({ h: hue, s, l });
}

export function getAppearanceThemeMode(root: Pick<Element, "classList">): AppearanceThemeMode {
  return root.classList.contains("dark") ? "dark" : "light";
}

function getAppearanceTintStyleElement(root: HTMLElement) {
  const ownerDocument = root.ownerDocument;
  const existing = ownerDocument.getElementById(APPEARANCE_TINT_STYLE_ID);
  if (existing instanceof HTMLStyleElement) return existing;

  const style = ownerDocument.createElement("style");
  style.id = APPEARANCE_TINT_STYLE_ID;
  ownerDocument.head.append(style);
  return style;
}

function removeAppearanceTintStyleElement(root: HTMLElement) {
  root.ownerDocument.getElementById(APPEARANCE_TINT_STYLE_ID)?.remove();
}

function removeStaleInlineTintTokens(root: HTMLElement) {
  for (const token of APPEARANCE_BASE_TOKEN_NAMES) root.style.removeProperty(token);
  for (const token of MULTI_CURSOR_TOKEN_NAMES) root.style.removeProperty(token);
  for (const token of CURSOR_CORE_TOKEN_NAMES) root.style.removeProperty(token);
}

export function buildAppearanceBaseColors(
  mode: AppearanceThemeMode,
  hue: number,
  intensity: number,
): AppearanceBaseColors {
  const normalizedHue = normalizeHue(hue);
  const normalizedIntensity = normalizeIntensity(intensity);
  const core = CURSOR_CORE_COLORS[mode];
  const colors = { ...core };

  if (normalizedIntensity > 0) {
    for (const { token, chromaScale, hueShift } of TINT_TOKENS) {
      const baseColor = core[token];
      colors[token] = hueShift
        ? shiftHue(baseColor, normalizedHue)
        : tintSurface(baseColor, normalizedHue, normalizedIntensity * (chromaScale ?? 1));
    }
  }

  return {
    "--multi-base-sidebar": colors.sidebar,
    "--multi-base-chrome": colors.chrome,
    "--multi-base-editor": colors.editor,
    "--multi-base-accent": colors.accent,
    "--multi-base-focus": colors.focus,
  };
}

export function applyAppearanceBaseColors(
  root: HTMLElement,
  mode: AppearanceThemeMode,
  hue: number,
  intensity: number,
) {
  if (normalizeIntensity(intensity) <= 0) {
    removeStaleInlineTintTokens(root);
    removeAppearanceTintStyleElement(root);
    return;
  }

  const colors = buildAppearanceBaseColors(mode, hue, intensity);
  const lines: string[] = [];

  for (const [token, value] of Object.entries(colors) as Array<[AppearanceBaseTokenName, string]>) {
    lines.push(`  ${token}: ${value};`);
    lines.push(`  ${token.replace("--multi-base-", "--multi-cursor-")}: ${value};`);
    lines.push(`  ${token.replace("--multi-base-", "--cursor-")}: ${value};`);
  }

  removeStaleInlineTintTokens(root);
  getAppearanceTintStyleElement(root).textContent =
    `body[data-multi-glass-mode="true"] {\n${lines.join("\n")}\n}`;
}
