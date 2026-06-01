import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const shellDir = resolve(__dirname);
const appShellSource = readFileSync(resolve(shellDir, "app.tsx"), "utf8");
const appShellHostSource = readFileSync(resolve(shellDir, "../../shell-host.tsx"), "utf8");
const chatHeaderSource = readFileSync(resolve(shellDir, "../../chat/view/chat-header.tsx"), "utf8");
const gitPanelSource = readFileSync(resolve(shellDir, "../git/panel.tsx"), "utf8");
const rightWorkbenchHeaderSource = readFileSync(
  resolve(shellDir, "right-workbench-header.tsx"),
  "utf8",
);
const rightWorkbenchLayoutSource = readFileSync(
  resolve(shellDir, "right-workbench-layout.tsx"),
  "utf8",
);
const workbenchChromeRowSource = readFileSync(
  resolve(shellDir, "workbench-chrome-row.tsx"),
  "utf8",
);
const indexCssSource = readFileSync(resolve(shellDir, "../../../index.css"), "utf8");
const shellCssSource = readFileSync(resolve(shellDir, "../../../styles/shell.css"), "utf8");
const desktopChromeSource = readFileSync(
  resolve(shellDir, "../../../lib/desktop-chrome.ts"),
  "utf8",
);
const useThemeSource = readFileSync(resolve(shellDir, "../../../hooks/use-theme.ts"), "utf8");
const desktopWindowSource = readFileSync(
  resolve(__dirname, "../../../../../desktop/src/window/DesktopWindow.ts"),
  "utf8",
);
const desktopIpcWindowSource = readFileSync(
  resolve(__dirname, "../../../../../desktop/src/ipc/methods/window.ts"),
  "utf8",
);
const chatViewSource = readFileSync(resolve(shellDir, "../../chat/view/chat-view.tsx"), "utf8");

describe("AppShell CSS root contract", () => {
  it("sources shared UI package utilities for app Tailwind output", () => {
    expect(indexCssSource).toContain('@source "../../ui/src/**/*.{ts,tsx}";');
  });

  it("publishes durable shell intent and geometry from AppShell", () => {
    expect(appShellSource).toContain('"--multi-shell-left-width"');
    expect(appShellSource).toContain('"--multi-shell-left-collapsed-width"');
    expect(appShellSource).toContain('"--multi-shell-left-min-width"');
    expect(appShellSource).toContain('"--multi-shell-left-max-width"');
    expect(appShellSource).toContain('"--multi-shell-right-workbench-width"');
    expect(appShellSource).toContain('"--multi-shell-right-workbench-collapsed-width"');
    expect(appShellSource).toContain('"--multi-shell-right-workbench-min-width"');
    expect(appShellSource).toContain('"--multi-shell-right-workbench-max-width"');
    expect(appShellSource).toContain('"--multi-shell-titlebar-control-size"');
    expect(appShellSource).toContain('"--multi-shell-titlebar-control-y"');
    expect(appShellSource).toContain('"--multi-shell-titlebar-gutter"');
    expect(appShellSource).toContain("data-shell-left-intent");
    expect(appShellSource).toContain("data-shell-right-intent");
    expect(appShellSource).toContain("data-shell-right-panel");
    expect(appShellSource).toContain("data-shell-platform");
    expect(appShellSource).toContain('data-shell-chrome="surface"');
  });

  it("keeps responsive effective state out of React and Zustand", () => {
    expect(appShellSource).not.toMatch(/\buseWindowSize\b/);
    expect(appShellSource).not.toMatch(/\bResizeObserver\b/);
    expect(appShellSource).not.toMatch(/\beffectiveRightOpen\b/);
    expect(appShellSource).not.toMatch(/\beffectiveLeftOpen\b/);
    expect(appShellSource).not.toMatch(/\bcontainerWidth\b/);
    expect(appShellSource).not.toMatch(/\bshouldCollapseForViewport\b/);
  });

  it("uses CSS container queries for the chosen collapse order", () => {
    expect(shellCssSource).toContain("container-type: inline-size");
    expect(shellCssSource).toContain("@container (max-width: 980px)");
    expect(shellCssSource).toContain("--multi-shell-secondary-rail-effective-width");
    expect(shellCssSource).toContain("@container (max-width: 900px)");
    expect(shellCssSource).toContain(".agent-window__workbench");
    expect(shellCssSource).toContain("--multi-shell-right-workbench-collapsed-width");
    expect(shellCssSource).toContain("@container (max-width: 620px)");
    expect(shellCssSource).toContain(".agent-window__sidebar");
    expect(shellCssSource).toContain("--multi-shell-left-collapsed-width");
  });

  it("aligns titlebar chrome and workbench spacer from the root variables", () => {
    expect(appShellSource).toContain("multi-shell-titlebar-left-controls");
    expect(appShellSource).toContain("multi-shell-titlebar-right-toggle");
    expect(rightWorkbenchHeaderSource).toContain("multi-workbench-titlebar-end-space");
    expect(rightWorkbenchHeaderSource).toContain(
      'className="multi-workbench-titlebar-end-space shrink-0"',
    );
    expect(rightWorkbenchHeaderSource).not.toContain(
      'className="multi-workbench-titlebar-end-space no-drag',
    );
    expect(shellCssSource).toContain("left: var(--multi-electron-traffic-inset)");
    expect(shellCssSource).toContain("right: var(--multi-shell-titlebar-gutter)");
    expect(shellCssSource).toContain("top: var(--multi-shell-titlebar-control-y)");
    expect(appShellHostSource).toContain("thread-rail-pad relative");
    expect(appShellHostSource).toContain("h-(--multi-shell-sidebar-content-top-offset");
    expect(appShellHostSource).toContain("pointer-events-none");
    expect(appShellHostSource).not.toContain(
      "drag-region pointer-events-none absolute inset-x-0 top-0",
    );
    expect(indexCssSource).toContain("-webkit-app-region: drag");
    expect(shellCssSource).toContain("width: var(--multi-shell-right-workbench-header-end-space)");
    expect(shellCssSource).toContain("pointer-events: none");
    expect(shellCssSource).toContain("multi-shell-titlebar-controls");
    expect(workbenchChromeRowSource).toContain("pointer-events-none ui-tab-system");
    expect(workbenchChromeRowSource).toContain(
      "editor-panel-tab-bar-tab-cluster pointer-events-auto",
    );
    expect(appShellSource).toContain("multi-shell-titlebar-controls");
    expect(rightWorkbenchHeaderSource).toContain("editor-panel-tab-bar-spacer drag-region");
    expect(chatHeaderSource).toContain("drag-region pointer-events-auto");
    expect(indexCssSource).toContain('.drag-region [role="tab"]');
    expect(indexCssSource).toContain('.drag-region [data-slot="tabs-list"]');
    expect(rightWorkbenchHeaderSource).toContain('<TabsList className="no-drag');
    expect(rightWorkbenchHeaderSource).toContain('className="no-drag flex min-w-0 items-center');
    expect(gitPanelSource).toContain('className="no-drag shrink-0 text-detail');
    expect(gitPanelSource).toContain(
      'className="no-drag inline-flex h-(--multi-workbench-action-size)',
    );
    expect(appShellSource).not.toContain("wco:right");
    expect(appShellSource).not.toContain("LeftExpandButton");
    expect(appShellSource).not.toContain("RightPanelChromeToggle");
    expect(appShellSource).not.toContain("multi-shell-titlebar-drag-region");
    expect(shellCssSource).not.toContain("multi-shell-titlebar-drag-region");
    expect(chatHeaderSource).not.toContain("multi-agent-panel-header");
    expect(chatHeaderSource).not.toContain("multi-titlebar-content-nudge-y");
    expect(shellCssSource).not.toContain("--multi-titlebar-row-center-top");
    expect(shellCssSource).not.toContain("--multi-titlebar-content-nudge-y");
    expect(shellCssSource).not.toContain("multi-shell-titlebar-right-toggle--web");
  });

  it("lets Electron fullscreen chrome update traffic-light shell spacing", () => {
    expect(desktopChromeSource).toContain("--multi-shell-sidebar-content-top-offset");
    expect(desktopChromeSource).toContain("TITLEBAR_CONTENT_RESERVE_PX");
    expect(desktopChromeSource).not.toContain("--multi-titlebar-control-row-top");
    expect(desktopChromeSource).toContain("TRAFFIC_LIGHT_Y_PX");
    expect(shellCssSource).toContain("--multi-shell-sidebar-content-top-offset");
    expect(shellCssSource).toContain("var(--multi-electron-traffic-padding-top)");
  });

  it("centers titlebar sidebar toggles on the workbench chrome row band", () => {
    expect(shellCssSource).toContain(
      "--multi-header-height: var(--multi-header-height-user, 34px)",
    );
    expect(shellCssSource).toContain("--multi-workbench-chrome-row-height: 34px");
    expect(shellCssSource).toContain("--multi-titlebar-control-height: 22px");
    expect(shellCssSource).toContain("--multi-workbench-action-size: 22px");
    expect(shellCssSource).toContain(
      "--multi-titlebar-control-row-top: calc(\n    (var(--multi-header-height) - var(--multi-titlebar-control-height)) / 2\n  )",
    );
    expect(appShellSource).toContain(
      '"--multi-shell-titlebar-control-y": "var(--multi-titlebar-control-row-top)"',
    );
    expect(appShellSource).toContain(
      "multi-shell-titlebar-controls pointer-events-none absolute top-0 right-0 left-0 z-50 box-border flex h-(--multi-header-height) min-w-0 items-center",
    );
    expect(appShellSource).toContain("h-(--multi-titlebar-control-height)");
    expect(workbenchChromeRowSource).toContain("items-center");
    expect(workbenchChromeRowSource).toContain("h-(--multi-workbench-action-size) self-center");
    expect(chatViewSource).toContain(
      "agent-window-chat-header pointer-events-none box-border flex h-(--multi-workbench-chrome-row-height) select-none items-center",
    );
    expect(chatViewSource).toContain("px-(--multi-workbench-chrome-padding-inline)");
    expect(chatViewSource).toContain("before:bg-(--multi-shell-center-surface-background)");
    expect(chatViewSource).toContain(
      "linear-gradient(to_top,var(--multi-shell-center-surface-background),transparent)",
    );
    expect(shellCssSource).toMatch(
      /\.agent-window-chat-header \{[\s\S]*background:\s*transparent/,
    );
    expect(shellCssSource).not.toMatch(/\.agent-window-chat-header \{[\s\S]*border-bottom:/);
    expect(shellCssSource).toContain(
      "--multi-workbench-editor-panel-tab-background: var(--multi-workbench-tool-island-background)",
    );
    expect(chatViewSource).not.toContain("pr-(--multi-shell-right-workbench-header-end-space)");
    expect(shellCssSource).toContain(
      '[data-shell-right-panel="true"][data-shell-right-intent="collapsed"]',
    );
    expect(shellCssSource).toContain(
      "padding-right: calc(0.75rem + var(--multi-shell-right-workbench-header-end-space))",
    );
    expect(chatHeaderSource).not.toContain("translate-y-[var(--multi-titlebar-content-nudge-y)]");
    expect(shellCssSource).toContain("top: var(--multi-shell-titlebar-control-y)");
    expect(desktopWindowSource).toContain("MACOS_TRAFFIC_LIGHT_Y_PX");
    expect(desktopWindowSource).toContain("setWindowButtonPosition");
    expect(desktopWindowSource).toContain("getMacOSTrafficLightPosition");
  });

  it("projects secondary rail width through CSS variables", () => {
    expect(rightWorkbenchLayoutSource).toContain('"--multi-shell-secondary-rail-width"');
    expect(rightWorkbenchLayoutSource).toContain('"--multi-shell-secondary-rail-collapsed-width"');
    expect(rightWorkbenchLayoutSource).toContain('"--multi-shell-secondary-rail-min-width"');
    expect(rightWorkbenchLayoutSource).toContain('"--multi-shell-secondary-rail-max-width"');
    expect(rightWorkbenchLayoutSource).toContain('data-shell-panel="secondary"');
    expect(rightWorkbenchLayoutSource).toContain("data-resizing");
    expect(rightWorkbenchLayoutSource).toContain("bg-(--multi-workbench-panel-title-background)");
    expect(rightWorkbenchLayoutSource).not.toContain(
      "bg-[color-mix(in_srgb,var(--multi-bg-secondary)_82%,transparent)]",
    );
    expect(shellCssSource).toContain("width: var(--multi-shell-secondary-rail-effective-width)");
  });

  it("routes sidebar and chat surfaces through Multi surface variables", () => {
    expect(shellCssSource).toContain(
      "var(--multi-sidebar-surface-background, var(--multi-shell-sidebar-bg))",
    );
    expect(shellCssSource).toMatch(
      /body\.multi-reduce-transparency\[data-multi-glass-mode="true"\] \.multi-shell-sidebar[\s\S]*background:\s*var\(--multi-color-sidebar-opaque\)/,
    );
    expect(appShellSource).toContain('data-component="root"');
    expect(appShellSource).toContain('setAttribute("data-multi-glass-mode", "true")');
    expect(appShellSource).toContain("syncAppearanceVibrancy");
    expect(appShellSource).toContain('data-shell-center-surface={props.centerSurface ?? "chat"}');
    expect(appShellSource).toContain("bg-(--multi-shell-center-surface-background)");
    expect(shellCssSource).toContain("--multi-shell-center-surface-background");
    expect(shellCssSource).toContain('.agent-window[data-shell-center-surface="editor"]');
  });

  it("keeps transparent document backgrounds Electron-only", () => {
    expect(indexCssSource).toContain(
      'html[data-electron]:has(body[data-multi-glass-mode="true"]:not(.multi-reduce-transparency))',
    );
    expect(indexCssSource).toContain(
      'html[data-electron] body[data-multi-glass-mode="true"]:not(.multi-reduce-transparency)',
    );
    expect(useThemeSource).toContain('const ELECTRON_GLASS_BACKGROUND_COLOR_LIGHT = "#00FFFFFF";');
    expect(useThemeSource).toContain('const ELECTRON_GLASS_BACKGROUND_COLOR_DARK = "#40000000";');
    expect(useThemeSource).toContain("wantsElectronGlassBackground()");
    expect(useThemeSource).toContain("getElectronGlassBackgroundColor()");
    expect(useThemeSource).toContain('const rendererBackgroundColor = wantsGlassBackground');
    expect(useThemeSource).toContain('? "transparent"');
    expect(useThemeSource).toContain("const desktopBackgroundColor = wantsGlassBackground");
    expect(useThemeSource).toContain("syncDesktopBackgroundColor(desktopBackgroundColor)");
    expect(shellCssSource).toContain(
      'html[data-electron] body[data-multi-glass-mode="true"]:not(.multi-reduce-transparency)',
    );
    expect(shellCssSource).toContain(
      'body[data-multi-glass-mode="true"]:not(.multi-reduce-transparency) .agent-window',
    );
    expect(shellCssSource).toContain("background: var(--multi-glass-surface-background);");
    expect(shellCssSource).not.toContain(
      "body.multi-os-vibrancy-on[data-multi-glass-mode=\"true\"] .agent-window",
    );
    expect(appShellSource).toContain('centerSurface?: "chat" | "editor";');
    expect(appShellSource).toContain('data-shell-center-surface={props.centerSurface ?? "chat"}');
    expect(shellCssSource).toContain('.agent-window[data-shell-center-surface="editor"]');
    expect(shellCssSource).toContain(
      "--multi-shell-center-surface-background: var(--multi-workbench-editor-surface-background)",
    );
    expect(appShellHostSource).toContain('centerSurface="editor"');
    expect(appShellSource).toContain("border-r border-multi-stroke-tertiary");
    expect(desktopIpcWindowSource).toContain("getMacGlassWindowBackgroundColor");
    expect(desktopIpcWindowSource).toContain('return shouldUseDarkColors ? "#40000000" : "#00FFFFFF";');
    expect(desktopWindowSource).toContain("getInitialWindowGlassOptions");
    expect(desktopWindowSource).toContain('vibrancy: "sidebar"');
    expect(desktopWindowSource).toContain('visualEffectState: "active"');
    expect(desktopWindowSource).not.toContain(
      "window.setBackgroundColor(getInitialWindowBackgroundColor(shouldUseDarkColors));",
    );
  });
});
