import type { ITheme } from "@xterm/xterm";

function normalizePaint(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "transparent" ||
    normalized === "rgba(0, 0, 0, 0)" ||
    normalized === "rgba(0 0 0 / 0)"
  ) {
    return null;
  }
  return value ?? null;
}

function readVarPaint(doc: Document, kind: "fg" | "bg", expr: string, fallback: string): string {
  const mount = doc.documentElement;
  const node = doc.createElement("span");
  node.style.position = "absolute";
  node.style.opacity = "0";
  node.style.pointerEvents = "none";
  if (kind === "fg") node.style.color = expr;
  else node.style.backgroundColor = expr;
  mount.append(node);
  const s = getComputedStyle(node);
  const out = kind === "fg" ? s.color : s.backgroundColor;
  node.remove();
  return normalizePaint(out) ?? fallback;
}

const dark: ITheme = {
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
};

const light: ITheme = {
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#bf8803",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14ce14",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

function readTextColor(el: HTMLElement, value: string) {
  const node = el.ownerDocument.createElement("span");
  node.style.position = "absolute";
  node.style.opacity = "0";
  node.style.pointerEvents = "none";
  node.style.color = value;
  el.append(node);
  const color = normalizePaint(getComputedStyle(node).color) ?? value;
  node.remove();
  return color;
}

function readBackgroundColor(el: HTMLElement, value: string) {
  const node = el.ownerDocument.createElement("span");
  node.style.position = "absolute";
  node.style.opacity = "0";
  node.style.pointerEvents = "none";
  node.style.backgroundColor = value;
  el.append(node);
  const color = normalizePaint(getComputedStyle(node).backgroundColor) ?? value;
  node.remove();
  return color;
}

function readNearestComputedPaint(
  el: HTMLElement,
  property: "color" | "backgroundColor",
): string | null {
  let node: HTMLElement | null = el;
  while (node) {
    const value = getComputedStyle(node)[property];
    const normalized = normalizePaint(value);
    if (normalized) return normalized;
    node = node.parentElement;
  }
  return null;
}

export function readTerminalHostThemeMode(el: HTMLElement): "light" | "dark" {
  return el.ownerDocument.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function readTerminalHostFontFamily(el: HTMLElement): string {
  const node = el.ownerDocument.createElement("span");
  node.style.position = "absolute";
  node.style.opacity = "0";
  node.style.pointerEvents = "none";
  node.style.fontFamily = "var(--multi-font-mono), ui-monospace, monospace";
  el.append(node);
  const value = getComputedStyle(node).fontFamily || "ui-monospace, monospace";
  node.remove();
  return value;
}

export function readTerminalHostFontSize(el: HTMLElement): number {
  const node = el.ownerDocument.createElement("span");
  node.style.position = "absolute";
  node.style.opacity = "0";
  node.style.pointerEvents = "none";
  node.style.fontSize = "var(--multi-code-font-size-user, 12px)";
  el.append(node);
  const value = Number.parseFloat(getComputedStyle(node).fontSize);
  node.remove();
  return Number.isFinite(value) && value > 0 ? value : 12;
}

export function readWorkbenchFallbackTheme(el: HTMLElement, mode: "light" | "dark"): ITheme {
  const base = mode === "dark" ? dark : light;
  const host = el.parentElement ?? el;
  const fg = readNearestComputedPaint(host, "color") ?? readTextColor(host, "var(--foreground)");
  const bg =
    readNearestComputedPaint(host, "backgroundColor") ??
    readBackgroundColor(host, "var(--background)");

  return {
    ...base,
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: mode === "dark" ? "rgba(96, 165, 250, 0.35)" : "rgba(59, 130, 246, 0.35)",
    selectionForeground: mode === "dark" ? "rgb(249, 250, 251)" : "rgb(15, 23, 42)",
  } satisfies ITheme;
}

export function readTerminalHostTheme(el: HTMLElement, mode: "light" | "dark"): ITheme {
  const base = readWorkbenchFallbackTheme(el, mode);
  const doc = el.ownerDocument;
  const v = (kind: "fg" | "bg", expr: string, fb: string) => readVarPaint(doc, kind, expr, fb);

  return {
    ...base,
    black: v("fg", "color-mix(in srgb, var(--foreground) 20%, var(--background))", base.black!),
    red: v("fg", "var(--destructive)", base.red!),
    green: v("fg", "var(--success)", base.green!),
    yellow: v("fg", "var(--warning)", base.yellow!),
    blue: v("fg", "var(--info)", base.blue!),
    magenta: v("fg", "color-mix(in srgb, var(--destructive) 50%, var(--info))", base.magenta!),
    cyan: v("fg", "color-mix(in srgb, var(--info) 55%, var(--success))", base.cyan!),
    white: v("fg", "color-mix(in srgb, var(--foreground) 75%, var(--background))", base.white!),
    brightBlack: v("fg", "var(--muted-foreground)", base.brightBlack!),
    brightRed: v("fg", "color-mix(in srgb, var(--destructive) 65%, white)", base.brightRed!),
    brightGreen: v("fg", "color-mix(in srgb, var(--success) 62%, white)", base.brightGreen!),
    brightYellow: v("fg", "color-mix(in srgb, var(--warning) 58%, white)", base.brightYellow!),
    brightBlue: v("fg", "color-mix(in srgb, var(--info) 58%, white)", base.brightBlue!),
    brightMagenta: v(
      "fg",
      "color-mix(in srgb, var(--destructive) 45%, var(--info))",
      base.brightMagenta!,
    ),
    brightCyan: v("fg", "color-mix(in srgb, var(--info) 45%, var(--success))", base.brightCyan!),
    brightWhite: v("fg", "color-mix(in srgb, var(--foreground) 12%, white)", base.brightWhite!),
    selectionBackground: v(
      "bg",
      "color-mix(in srgb, var(--primary) 28%, transparent)",
      base.selectionBackground!,
    ),
  } satisfies ITheme;
}
