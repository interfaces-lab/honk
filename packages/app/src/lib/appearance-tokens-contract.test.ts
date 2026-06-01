import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const tokensCss = readFileSync(resolve(__dirname, "../styles/tokens.css"), "utf8");
const conversationCss = readFileSync(resolve(__dirname, "../styles/conversation.css"), "utf8");
const shellCss = readFileSync(resolve(__dirname, "../styles/shell.css"), "utf8");
const appearanceSettingsSource = readFileSync(resolve(__dirname, "appearance-settings.ts"), "utf8");
const appearanceColorsSource = readFileSync(resolve(__dirname, "appearance-colors.ts"), "utf8");

const TINT_BASE_TOKEN_NAMES = [
  "--multi-base-sidebar",
  "--multi-base-chrome",
  "--multi-base-editor",
  "--multi-base-accent",
  "--multi-base-focus",
] as const;

describe("appearance tint base tokens", () => {
  it("defines five base token fallbacks for the semantic graph", () => {
    for (const name of TINT_BASE_TOKEN_NAMES) {
      expect(tokensCss).toContain(`${name}:`);
    }
  });

  it("uses Cursor foreground and transparent overlay semantics", () => {
    expect(tokensCss).toContain("--multi-base-foreground: #141414;");
    expect(tokensCss).toContain("--multi-base-foreground: #e4e4e4;");
    expect(tokensCss).toContain("--foreground: var(--multi-base-foreground);");
    expect(tokensCss).toContain(
      "--muted-foreground: color-mix(in srgb, var(--foreground) 74%, transparent);",
    );
    expect(tokensCss).toContain("--multi-color-sidebar: var(--multi-color-sidebar-opaque);");
    expect(tokensCss).toContain(
      "--multi-bg-secondary: color-mix(in srgb, var(--foreground) 14%, transparent);",
    );
    expect(tokensCss).toContain(
      "--multi-bg-quaternary: color-mix(in srgb, var(--foreground) 6%, transparent);",
    );
    expect(tokensCss).toContain(
      "--multi-bg-active: color-mix(in srgb, var(--foreground) 16%, transparent);",
    );
    expect(tokensCss).toContain("--multi-color-hover: var(--multi-bg-secondary);");
    expect(tokensCss).toContain("--multi-color-active: var(--multi-bg-active);");
    expect(tokensCss).not.toContain("--multi-sidebar-opacity");
    expect(tokensCss).not.toContain("--multi-chat-opacity");
    expect(tokensCss).not.toContain("--multi-editor-opacity");
  });

  it("keeps user hue and intensity out of the CSS semantic graph", () => {
    const intensityReferences = tokensCss
      .split("\n")
      .filter((line) => line.includes("var(--multi-intensity)"));
    const hueReferences = tokensCss
      .split("\n")
      .filter((line) => line.includes("var(--multi-user-hue)"));
    const dynamicTokenReferences = [...intensityReferences, ...hueReferences];

    expect(dynamicTokenReferences).toEqual([]);
    expect(appearanceSettingsSource).toContain("applyAppearanceBaseColors(");
    expect(appearanceColorsSource).toContain("DEFAULT_APPEARANCE_TINT_HUE = 261");
    expect(appearanceColorsSource).toContain("DEFAULT_APPEARANCE_TINT_INTENSITY = 20");
    expect(appearanceColorsSource).toContain("chromaScale: 0.5");
    expect(appearanceColorsSource).toContain("hueShift: true");
  });
});

describe("appearance reduce-transparency tokens", () => {
  it("defines opaque surface aliases for sidebar and chat", () => {
    expect(tokensCss).toContain("--multi-color-sidebar-opaque:");
    expect(tokensCss).toContain("--multi-color-chat-opaque:");
    expect(tokensCss).toContain("--multi-color-surface-opaque:");
  });

  it("authors Multi surface variables on body[data-multi-glass-mode] [data-component=root]", () => {
    expect(tokensCss).toContain('body[data-multi-glass-mode="true"] [data-component="root"]');
    expect(tokensCss).toContain("--multi-vibrancy-on-sidebar-surface-background:");
    expect(tokensCss).toContain("--multi-vibrancy-off-sidebar-surface-background:");
    expect(tokensCss).toContain("--multi-vibrancy-on-editor-surface-background:");
    expect(tokensCss).toContain("--multi-vibrancy-off-editor-surface-background:");
    expect(tokensCss).toContain("--multi-glass-surface-background: hsl(0 0% 100% / 0.16);");
    expect(tokensCss).toContain("--multi-glass-surface-background: rgb(0 0 0 / 0.42);");
    expect(tokensCss).toContain("--multi-glass-surface-background: var(--multi-color-editor-opaque);");
    expect(tokensCss).toMatch(
      /body\.multi-os-vibrancy-on\[data-multi-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-sidebar-surface-background:/,
    );
    expect(tokensCss).toMatch(
      /body\.multi-os-vibrancy-on\[data-multi-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-workbench-editor-surface-background:\s*var\(--multi-vibrancy-on-editor-surface-background\)/,
    );
    expect(tokensCss).toMatch(
      /body\[data-multi-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-sidebar-surface-background:\s*var\(\s*--multi-vibrancy-off-sidebar-surface-background\s*\)/,
    );
  });

  it("keeps glass bands fixed instead of exposing a window opacity slider", () => {
    expect(tokensCss).toContain("--multi-vibrancy-sidebar-mix: 42%;");
    expect(tokensCss).toContain("--multi-vibrancy-chat-mix: 84%;");
    expect(tokensCss).toContain("--multi-vibrancy-sidebar-mix: 36%;");
    expect(tokensCss).toContain("--multi-vibrancy-chat-mix: 72%;");
    expect(tokensCss).toContain(
      "--multi-vibrancy-off-editor-surface-background: var(--multi-color-chat-opaque);",
    );
    expect(tokensCss).toContain("var(--multi-color-chat-opaque) var(--multi-vibrancy-editor-mix)");
    expect(tokensCss).not.toContain("--multi-transparency");
    expect(appearanceSettingsSource).not.toContain("STORAGE_WINDOW_TRANSPARENCY");
    expect(appearanceSettingsSource).not.toContain("setWindowTransparency");
  });

  it("remaps Multi surfaces to opaque aliases when reduce transparency is enabled", () => {
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-multi-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-color-sidebar:\s*var\(--multi-color-sidebar-opaque\)/,
    );
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-multi-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-shell-sidebar-bg:\s*var\(--multi-color-sidebar-opaque\)/,
    );
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-multi-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-composer-surface-background:\s*var\(--multi-composer-surface-opaque-background\)/,
    );
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-multi-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-color-chat:\s*var\(--multi-color-chat-opaque\)/,
    );
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-multi-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-chat-surface-background:\s*var\(--multi-color-chat-opaque\)/,
    );
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-multi-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-workbench-editor-surface-background:\s*var\(--multi-color-editor-opaque\)/,
    );
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-multi-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-workbench-surface-background:\s*var\(--multi-color-surface-opaque\)/,
    );
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-multi-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-bg-quaternary:/,
    );
  });

  it("uses body as the canonical reduce-transparency state root", () => {
    expect(appearanceSettingsSource).toContain(
      'body.classList.toggle("multi-reduce-transparency", reduce)',
    );
    expect(appearanceSettingsSource).not.toContain(
      'root.classList.toggle("multi-reduce-transparency"',
    );
    expect(tokensCss).not.toContain("html.multi-reduce-transparency");
    expect(appearanceSettingsSource).toContain('body.classList.toggle("multi-os-vibrancy-on"');
    expect(appearanceSettingsSource).toContain('body.classList.toggle("multi-os-vibrancy-off"');
    expect(appearanceSettingsSource).toContain(
      'document.body.getAttribute("data-multi-glass-mode") !== "true"',
    );
    expect(appearanceSettingsSource).toContain("bridge.setVibrancy(wantsVibrancy)");
    expect(appearanceSettingsSource).toContain("syncVibrancy()");
  });

  it("disables shell, composer, and popup blur under reduce transparency", () => {
    expect(conversationCss).toContain(
      'body.multi-reduce-transparency[data-multi-glass-mode="true"] .multi-shell-sidebar',
    );
    expect(conversationCss).toContain(
      'body.multi-reduce-transparency[data-multi-glass-mode="true"] [data-multi-composer-header]',
    );
    expect(conversationCss).toMatch(
      /body\.multi-reduce-transparency\[data-multi-glass-mode="true"\][\s\S]*\[data-multi-composer-surface\]:not\(\[data-multi-composer-header\]\)[\s\S]*background-color:\s*var\(--multi-composer-surface-opaque-background\)/,
    );
    expect(conversationCss).toContain(
      'body.multi-reduce-transparency[data-multi-glass-mode="true"] .multi-slash-menu-popup',
    );
  });

  it("applies composer blur in glass mode", () => {
    expect(conversationCss).toContain("--multi-composer-blur: 10px");
    expect(conversationCss.replace(/\s+/g, " ")).toContain(
      'body[data-multi-glass-mode="true"] :is( [data-message-bubble-surface], [data-multi-composer-surface]:not([data-layout="inline-edit"]) )',
    );
    expect(conversationCss).toMatch(/blur\(var\(--multi-composer-blur/);
  });
});

describe("bubble/composer tint chain", () => {
  it("separates composer chrome from input-backed message bubbles", () => {
    expect(tokensCss).toContain("--multi-input-surface-opaque: var(--input);");
    expect(tokensCss).toContain("--multi-pane-surface-background:");
    expect(tokensCss).toContain(
      "--multi-composer-surface-background: var(--multi-pane-surface-background);",
    );
    expect(tokensCss).toContain("--multi-message-bubble-background: var(--multi-input-surface);");
    expect(tokensCss).not.toContain("--multi-chat-bubble-glass-opaque-background:");
    expect(tokensCss).not.toContain("--multi-color-bubble-opaque:");
    expect(tokensCss).not.toContain("--multi-color-bubble:");
    expect(tokensCss).not.toContain("--multi-bubble-opacity:");
  });
});

describe("context-aware interactive surfaces", () => {
  it("scopes --multi-interactive-surface to sidebar base on sidebar selectors", () => {
    expect(shellCss).toMatch(
      /\.multi-shell-sidebar[\s\S]*?--multi-interactive-surface:\s*var\(--multi-base-sidebar\)/,
    );
    expect(shellCss).toMatch(
      /\.agent-window__sidebar[\s\S]*?--multi-interactive-surface:\s*var\(--multi-base-sidebar\)/,
    );
  });

  it("scopes --multi-interactive-surface to editor base on workbench", () => {
    expect(shellCss).toMatch(
      /\.agent-window__workbench[\s\S]*?--multi-interactive-surface:\s*var\(--multi-base-editor\)/,
    );
  });
});
