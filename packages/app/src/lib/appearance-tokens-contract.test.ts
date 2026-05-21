import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const tokensCss = readFileSync(resolve(__dirname, "../styles/tokens.css"), "utf8");
const conversationCss = readFileSync(resolve(__dirname, "../styles/conversation.css"), "utf8");
const appearanceSettingsSource = readFileSync(
  resolve(__dirname, "appearance-settings.ts"),
  "utf8",
);

describe("appearance reduce-transparency tokens", () => {
  it("defines opaque surface aliases for sidebar and chat", () => {
    expect(tokensCss).toContain("--multi-color-sidebar-opaque:");
    expect(tokensCss).toContain("--multi-color-chat-opaque:");
    expect(tokensCss).toContain("--multi-color-surface-opaque:");
  });

  it("authors Multi surface variables on body[data-cursor-glass-mode] [data-component=root]", () => {
    expect(tokensCss).toContain('body[data-cursor-glass-mode="true"] [data-component="root"]');
    expect(tokensCss).toContain("--multi-vibrancy-on-sidebar-surface-background:");
    expect(tokensCss).toContain("--multi-vibrancy-off-sidebar-surface-background:");
    expect(tokensCss).toMatch(
      /body\.multi-os-vibrancy-on\[data-cursor-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-sidebar-surface-background:/,
    );
    expect(tokensCss).toMatch(
      /body\[data-cursor-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-sidebar-surface-background:\s*var\(\s*--multi-vibrancy-off-sidebar-surface-background\s*\)/,
    );
  });

  it("remaps Multi surfaces to opaque aliases when reduce transparency is enabled", () => {
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-cursor-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-color-sidebar:\s*var\(--multi-color-sidebar-opaque\)/,
    );
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-cursor-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-shell-sidebar-bg:\s*var\(--multi-color-sidebar-opaque\)/,
    );
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-cursor-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-chat-bubble-background:\s*var\(--multi-chat-bubble-opaque-background\)/,
    );
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-cursor-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-color-chat:\s*var\(--multi-color-chat-opaque\)/,
    );
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-cursor-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-workbench-editor-surface-background:\s*var\(--multi-color-editor-opaque\)/,
    );
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-cursor-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-workbench-surface-background:\s*var\(--multi-color-surface-opaque\)/,
    );
    expect(tokensCss).toMatch(
      /body\.multi-reduce-transparency\[data-cursor-glass-mode="true"\] \[data-component="root"\][\s\S]*--multi-bg-quaternary:/,
    );
  });

  it("keeps html.multi-reduce-transparency as migration alias", () => {
    expect(tokensCss).toContain("html.multi-reduce-transparency");
  });

  it("toggles reduce transparency on body and html from appearance-settings", () => {
    expect(appearanceSettingsSource).toContain('body.classList.toggle("multi-reduce-transparency", reduce)');
    expect(appearanceSettingsSource).toContain('root.classList.toggle("multi-reduce-transparency", reduce)');
    expect(appearanceSettingsSource).toContain('body.classList.toggle("multi-os-vibrancy-on"');
    expect(appearanceSettingsSource).toContain('body.classList.toggle("multi-os-vibrancy-off"');
    expect(appearanceSettingsSource).toContain(
      'document.body.getAttribute("data-cursor-glass-mode") !== "true"',
    );
    expect(appearanceSettingsSource).toContain("bridge.setVibrancy(wantsVibrancy)");
    expect(appearanceSettingsSource).toContain("syncVibrancy()");
  });

  it("disables shell, composer, and popup blur under reduce transparency", () => {
    expect(conversationCss).toContain(
      'body.multi-reduce-transparency[data-cursor-glass-mode="true"] .multi-shell-sidebar',
    );
    expect(conversationCss).toContain(
      'body.multi-reduce-transparency[data-cursor-glass-mode="true"] [data-multi-composer-surface]',
    );
    expect(conversationCss).toContain(
      'body.multi-reduce-transparency[data-cursor-glass-mode="true"] .multi-slash-menu-popup',
    );
  });

  it("applies composer blur in glass mode", () => {
    expect(conversationCss).toContain("--multi-composer-blur: 10px");
    expect(conversationCss).toContain(
      'body[data-cursor-glass-mode="true"] [data-multi-composer-surface]',
    );
    expect(conversationCss).toMatch(/blur\(var\(--multi-composer-blur/);
  });
});
