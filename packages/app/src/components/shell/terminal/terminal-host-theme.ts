import type { ITheme, Terminal } from "@xterm/xterm";

type PaintKind = "fg" | "bg";

interface PaintResolver {
  read(kind: PaintKind, expr: string, fallback: string): string;
  readOptional(kind: PaintKind, expr: string): string | null;
  dispose(): void;
}

const paintContexts = new WeakMap<Document, CanvasRenderingContext2D>();

function readPaintContext(doc: Document): CanvasRenderingContext2D | null {
  const cached = paintContexts.get(doc);
  if (cached) return cached;

  const canvas = doc.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context) {
    paintContexts.set(doc, context);
  }
  return context;
}

function formatAlpha(alpha: number): string {
  return (alpha / 255).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function normalizePaint(value: string | null | undefined, doc?: Document): string | null {
  const normalized = value?.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "transparent" ||
    normalized === "rgba(0, 0, 0, 0)" ||
    normalized === "rgba(0 0 0 / 0)"
  ) {
    return null;
  }

  if (!doc || /^#[\da-f]{3,8}$/i.test(normalized) || /^rgba?\(/.test(normalized)) {
    return value ?? null;
  }

  const context = readPaintContext(doc);
  if (!context) return value ?? null;

  const litmusColor = "rgb(1, 2, 3)";
  context.fillStyle = litmusColor;
  context.fillStyle = value ?? "";
  if (context.fillStyle === litmusColor && normalized !== litmusColor) {
    return null;
  }

  context.clearRect(0, 0, 1, 1);
  context.fillRect(0, 0, 1, 1);
  const data = context.getImageData(0, 0, 1, 1).data;
  const r = data[0] ?? 0;
  const g = data[1] ?? 0;
  const b = data[2] ?? 0;
  const a = data[3] ?? 255;
  if (a === 0) return null;
  if (a === 255) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${formatAlpha(a)})`;
}

function createPaintResolver(host: HTMLElement): PaintResolver {
  const node = host.ownerDocument.createElement("span");
  node.style.position = "absolute";
  node.style.width = "0";
  node.style.height = "0";
  node.style.overflow = "hidden";
  node.style.opacity = "0";
  node.style.pointerEvents = "none";
  node.style.whiteSpace = "pre";
  node.setAttribute("aria-hidden", "true");
  host.append(node);

  const computed = getComputedStyle(node);
  const readOptional = (kind: PaintKind, expr: string): string | null => {
    if (kind === "fg") {
      node.style.color = expr;
      const out = normalizePaint(computed.color, host.ownerDocument);
      node.style.color = "";
      return out;
    }

    node.style.backgroundColor = expr;
    const out = normalizePaint(computed.backgroundColor, host.ownerDocument);
    node.style.backgroundColor = "";
    return out;
  };

  return {
    read(kind, expr, fallback) {
      return readOptional(kind, expr) ?? fallback;
    },
    readOptional,
    dispose() {
      node.remove();
    },
  };
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
  brightWhite: "#e5e5e5",
};

const light: ITheme = {
  black: "#000000",
  red: "#cd3131",
  green: "#107c10",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14ce14",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

function readNearestComputedPaint(
  el: HTMLElement,
  property: "color" | "backgroundColor",
): string | null {
  let node: HTMLElement | null = el;
  while (node) {
    const value = getComputedStyle(node)[property];
    const normalized = normalizePaint(value, el.ownerDocument);
    if (normalized) return normalized;
    node = node.parentElement;
  }
  return null;
}

function readThemeVar(
  resolver: PaintResolver,
  kind: PaintKind,
  name: string,
  fallback: string,
): string {
  return resolver.read(kind, `var(${name})`, fallback);
}

export function readTerminalHostThemeMode(el: HTMLElement): "light" | "dark" {
  return el.ownerDocument.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function readTerminalHostFontFamily(el: HTMLElement): string {
  const node = el.ownerDocument.createElement("span");
  node.style.position = "absolute";
  node.style.opacity = "0";
  node.style.pointerEvents = "none";
  node.style.fontFamily = "var(--honk-font-mono), ui-monospace, monospace";
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
  node.style.fontSize = "var(--honk-code-font-size-user, 12px)";
  el.append(node);
  const value = Number.parseFloat(getComputedStyle(node).fontSize);
  node.remove();
  return Number.isFinite(value) && value > 0 ? value : 12;
}

function readWorkbenchFallbackThemeWithResolver(
  el: HTMLElement,
  mode: "light" | "dark",
  resolver: PaintResolver,
): ITheme {
  const base = mode === "dark" ? dark : light;
  const host = el.parentElement ?? el;
  const fallbackForeground = mode === "dark" ? "#cccccc" : "#333333";
  const fallbackBackground = mode === "dark" ? "#1e1e1e" : "#ffffff";
  const fg =
    readNearestComputedPaint(host, "color") ??
    resolver.readOptional("fg", "var(--honk-terminal-foreground)") ??
    resolver.readOptional("fg", "var(--honk-workbench-terminal-foreground)") ??
    resolver.read("fg", "var(--foreground)", fallbackForeground);
  const bg =
    readNearestComputedPaint(host, "backgroundColor") ??
    resolver.readOptional("bg", "var(--honk-terminal-background)") ??
    resolver.readOptional("bg", "var(--honk-workbench-terminal-background)") ??
    resolver.read("bg", "var(--background)", fallbackBackground);

  return {
    black: readThemeVar(resolver, "fg", "--honk-terminal-ansi-black", base.black ?? "#000000"),
    red: readThemeVar(resolver, "fg", "--honk-terminal-ansi-red", base.red ?? "#cd3131"),
    green: readThemeVar(resolver, "fg", "--honk-terminal-ansi-green", base.green ?? "#0dbc79"),
    yellow: readThemeVar(resolver, "fg", "--honk-terminal-ansi-yellow", base.yellow ?? "#e5e510"),
    blue: readThemeVar(resolver, "fg", "--honk-terminal-ansi-blue", base.blue ?? "#2472c8"),
    magenta: readThemeVar(
      resolver,
      "fg",
      "--honk-terminal-ansi-magenta",
      base.magenta ?? "#bc3fbc",
    ),
    cyan: readThemeVar(resolver, "fg", "--honk-terminal-ansi-cyan", base.cyan ?? "#11a8cd"),
    white: readThemeVar(resolver, "fg", "--honk-terminal-ansi-white", base.white ?? "#e5e5e5"),
    brightBlack: readThemeVar(
      resolver,
      "fg",
      "--honk-terminal-ansi-bright-black",
      base.brightBlack ?? "#666666",
    ),
    brightRed: readThemeVar(
      resolver,
      "fg",
      "--honk-terminal-ansi-bright-red",
      base.brightRed ?? "#f14c4c",
    ),
    brightGreen: readThemeVar(
      resolver,
      "fg",
      "--honk-terminal-ansi-bright-green",
      base.brightGreen ?? "#23d18b",
    ),
    brightYellow: readThemeVar(
      resolver,
      "fg",
      "--honk-terminal-ansi-bright-yellow",
      base.brightYellow ?? "#f5f543",
    ),
    brightBlue: readThemeVar(
      resolver,
      "fg",
      "--honk-terminal-ansi-bright-blue",
      base.brightBlue ?? "#3b8eea",
    ),
    brightMagenta: readThemeVar(
      resolver,
      "fg",
      "--honk-terminal-ansi-bright-magenta",
      base.brightMagenta ?? "#d670d6",
    ),
    brightCyan: readThemeVar(
      resolver,
      "fg",
      "--honk-terminal-ansi-bright-cyan",
      base.brightCyan ?? "#29b8db",
    ),
    brightWhite: readThemeVar(
      resolver,
      "fg",
      "--honk-terminal-ansi-bright-white",
      base.brightWhite ?? "#e5e5e5",
    ),
    background: bg,
    foreground: fg,
    cursor: resolver.readOptional("fg", "var(--honk-terminal-cursor)") ?? fg,
    cursorAccent: resolver.readOptional("bg", "var(--honk-terminal-cursor-accent)") ?? bg,
    selectionBackground:
      resolver.readOptional("bg", "var(--honk-terminal-selection-background)") ??
      (mode === "dark" ? "rgba(96, 165, 250, 0.35)" : "rgba(59, 130, 246, 0.35)"),
    selectionForeground:
      resolver.readOptional("fg", "var(--honk-terminal-selection-foreground)") ??
      (mode === "dark" ? "rgb(249, 250, 251)" : "rgb(15, 23, 42)"),
  } satisfies ITheme;
}

export function readWorkbenchFallbackTheme(el: HTMLElement, mode: "light" | "dark"): ITheme {
  const resolver = createPaintResolver(el.parentElement ?? el);
  try {
    return readWorkbenchFallbackThemeWithResolver(el, mode, resolver);
  } finally {
    resolver.dispose();
  }
}

export function readTerminalHostTheme(el: HTMLElement, mode: "light" | "dark"): ITheme {
  const resolver = createPaintResolver(el);
  try {
    return readWorkbenchFallbackThemeWithResolver(el, mode, resolver);
  } finally {
    resolver.dispose();
  }
}

/** xterm `theme` object for the host document's current light/dark mode (constructor and live sync). */
export function readTerminalHostThemeForMount(el: HTMLElement): ITheme {
  return readTerminalHostTheme(el, readTerminalHostThemeMode(el));
}

/** Push host document theme, monospace settings, and a full refresh into an open xterm instance. */
export function applyTerminalHostToXterm(terminal: Terminal, mount: HTMLElement): void {
  terminal.options.theme = readTerminalHostThemeForMount(mount);
  terminal.options.fontFamily = readTerminalHostFontFamily(mount);
  terminal.options.fontSize = readTerminalHostFontSize(mount);
  if (terminal.rows > 0) {
    terminal.refresh(0, terminal.rows - 1);
  }
}
