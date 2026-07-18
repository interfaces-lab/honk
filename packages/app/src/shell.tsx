// Shell mounts the one hotkey registry. Leaf routes do not bind shell chords.

import { Shell, TabStrip, TooltipProvider } from "@honk/ui";
import { Outlet } from "@tanstack/react-router";
import * as React from "react";

import { useAppearanceTheme } from "./appearance-store";
import { CommandMenuOverlay } from "./command-menu";
import { shouldUseDesktopGlass } from "./desktop-bridge";
import { HonkDesktopExtensionLayout } from "./desktop-extensions/layout";
import { useIsHonkDesktopTabStripHidden } from "./desktop-extensions/runtime";
import { HonkDesktopTitlebarControls } from "./desktop-extensions/titlebar-controls";
import { DevChannelChip } from "./dev-channel-chip";
import { useShellHotkeys } from "./hotkeys";
import { DevelopmentPerformanceMonitor } from "./performance-monitor";
import { SettingsOverlay } from "./settings";
import { OpenTabContextMenu } from "./tab-context-menu";
import { actions, useTabsSelector } from "./tab-store";
import { ToastViewport } from "./toast";
import { TitleBarTrailing } from "./update-pill";

// Shell colorScheme beats html. Plain-object style hatch matches packages/ui/dev Theme dial.
const schemeStyles: Record<string, React.CSSProperties> = {
  system: { colorScheme: "light dark" },
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
};

function AppShell({
  isInteractive = true,
}: {
  readonly isInteractive?: boolean;
}): React.ReactElement {
  const trailing = (
    <TitleBarTrailing>
      <HonkDesktopTitlebarControls />
      {import.meta.env.DEV ? <DevChannelChip /> : null}
    </TitleBarTrailing>
  );

  // Selectors limit strip re-renders to tab list and active key.
  const tabs = useTabsSelector((s) => s.tabs);
  const activeKey = useTabsSelector((s) => s.activeKey);
  const isTabStripHidden = useIsHonkDesktopTabStripHidden();
  const theme = useAppearanceTheme();

  useShellHotkeys(undefined, isInteractive);

  return (
    <TooltipProvider>
      <Shell material={shouldUseDesktopGlass() ? "glass" : "solid"} style={schemeStyles[theme]}>
        <HonkDesktopExtensionLayout>
          {isTabStripHidden ? null : (
            <Shell.TitleBar trailing={trailing}>
              {/* Home is tab-store slot 0. A separate Home button would duplicate chrome. */}
              <TabStrip
                tabs={tabs}
                activeKey={activeKey}
                onActivate={(key) => {
                  actions.activate(key);
                }}
                onClose={(key) => {
                  actions.close(key);
                }}
                onReorder={(from, to) => {
                  actions.reorder(from, to);
                }}
                onNew={() => {
                  actions.openNew();
                }}
                onRename={(key, title) => {
                  actions.rename(key, title);
                }}
                renderContextMenu={(tab, children) => (
                  <OpenTabContextMenu tab={tab}>{children}</OpenTabContextMenu>
                )}
              />
            </Shell.TitleBar>
          )}
          <Shell.Stage>
            <Shell.Sheet>
              <Outlet />
            </Shell.Sheet>
          </Shell.Stage>
        </HonkDesktopExtensionLayout>
        {import.meta.env.DEV ? <DevelopmentPerformanceMonitor /> : null}
        {/* Shell overlays leave the Home/thread route mounted. */}
        <SettingsOverlay />
        <CommandMenuOverlay />
        <ToastViewport />
      </Shell>
    </TooltipProvider>
  );
}

export { AppShell };
