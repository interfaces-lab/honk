// The root shell frame — the opencode v2 INSET FLOATING SHEET anatomy (2026-07-12 rework):
// deep root → 36px titlebar (tab strip · trailing) → Stage carrying the 8px sheet gutter →
// ONE floating Sheet hosting the route outlet. No rail/sidebar column in this anatomy —
// opencode v2 keeps the project nav inside the home sheet, and honk follows (home.tsx's
// 280px grid column, settings in its footer). Hotkeys mount here so no leaf component binds
// ⌘W / ⌘N / ⌘⇧T / ⌘1–9 / ⌘K / ⌘O itself.

import * as stylex from "@stylexjs/stylex";
import { Badge, Shell, TabStrip, TooltipProvider } from "@honk/ui";
import { Outlet } from "@tanstack/react-router";
import * as React from "react";

import { useAppearanceTheme } from "./appearance-store";
import { CommandMenuOverlay } from "./command-menu";
import { useShellHotkeys } from "./hotkeys";
import { actions, useTabsSelector } from "./tab-store";
import { ToastViewport } from "./toast";
import { TitleBarTrailing } from "./update-pill";

// Shell declares its own color-scheme (beats <html>). Pin via xstyle the same way
// packages/ui/dev does for the Theme dial — never a duplicate token set.
const schemeStyles = stylex.create({
  system: { colorScheme: "light dark" },
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
});

function DevChannelChip(): React.ReactElement {
  // The DEV channel chip is the only mode trace in the titlebar; data-shell-no-drag so
  // it never steals the titlebar drag region.
  return (
    <span data-shell-no-drag="">
      <Badge tone="warn" size="sm">
        DEV
      </Badge>
    </span>
  );
}

function AppShell(): React.ReactElement {
  // Titlebar trailing: update pill (desktop, actionable only) + DEV chip in dev builds.
  const trailing = (
    <TitleBarTrailing>{import.meta.env.DEV ? <DevChannelChip /> : null}</TitleBarTrailing>
  );

  // Selectors keep strip re-renders to tab-list / active-key changes only.
  const tabs = useTabsSelector((s) => s.tabs);
  const activeKey = useTabsSelector((s) => s.activeKey);
  const theme = useAppearanceTheme();

  // ONE registry for the shell route — command-menu WP extends the same defaults map.
  useShellHotkeys();

  return (
    <TooltipProvider>
      <Shell xstyle={schemeStyles[theme]}>
        <Shell.TitleBar trailing={trailing}>
          {/* No separate Home button: honk pins Home as the tab strip's slot-0 tab (tab-store
              law) — opencode's home button + tabless-home arrangement would double the chrome. */}
          <TabStrip
            tabs={tabs}
            activeKey={activeKey}
            // TabStrip fires onActivate on mousedown (browser-grade); the store navigates.
            onActivate={actions.activate}
            // Hover-reveal × and middle-click both land here — TabStrip already emits both.
            onClose={actions.close}
            onReorder={actions.reorder}
            onNew={actions.openNew}
          />
        </Shell.TitleBar>
        <Shell.Stage>
          {/* Every route paints inside the same floating sheet (opencode v2: home sheet m-2,
              session frame p-2 — identical geometry, hoisted here so no route re-declares it). */}
          <Shell.Sheet>
            <Outlet />
          </Shell.Sheet>
        </Shell.Stage>
        {/* Single overlay mount — ⌘K / ⌘O doors; Home embeds the same menu inline. */}
        <CommandMenuOverlay />
        {/* Status chrome — bottom-right toast stack (WP7). */}
        <ToastViewport />
      </Shell>
    </TooltipProvider>
  );
}

export { AppShell };
