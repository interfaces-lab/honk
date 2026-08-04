// Shell mounts the one hotkey registry. Leaf routes do not bind shell chords.

import * as stylex from "@stylexjs/stylex";
import {
  FileTypeIconSprite,
  Icon,
  IconButton,
  Menu,
  Shell,
  StatusDot,
  TabStrip,
  Text,
  Tooltip,
  TooltipProvider,
} from "@honk/ui";
import { IconSettingsGear2 } from "@honk/ui/icons";
import { Outlet } from "@tanstack/react-router";
import * as React from "react";

import { useAppearanceTheme } from "./appearance-store";
import { connectDeviceRequest } from "./connect-device-request-store";
import { canManageDesktopRemoteHost, shouldUseDesktopGlass } from "./desktop-bridge";
import { HonkDesktopExtensionLayout } from "./desktop-extensions/layout";
import { useIsHonkDesktopTabStripHidden } from "./desktop-extensions/runtime";
import { HonkDesktopTitlebarControls } from "./desktop-extensions/titlebar-controls";
import { DevChannelChip } from "./dev-channel-chip";
import { useShellHotkeys } from "./hotkeys";
import { DevelopmentPerformanceMonitor } from "./performance-monitor";
import { actions as settingsActions } from "./settings-store";
import {
  CommandMenuOverlayHost,
  ConnectDeviceDialogHost,
  SettingsOverlayHost,
} from "./shell-overlays";
import { serverStatus } from "./server-status";
import { actions as serverActions, useOpenCodeServerConnections } from "./server-store";
import { OpenTabContextMenu } from "./tab-context-menu";
import { actions, useTabsSelector } from "./tab-store";
import { ToastViewportHost } from "./toast-host";
import { TitleBarTrailing } from "./update-pill";

// Shell colorScheme beats html. Plain-object style hatch matches packages/ui/dev Theme dial.
const schemeStyles: Record<string, React.CSSProperties> = {
  system: { colorScheme: "light dark" },
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
};

const styles = stylex.create({
  menuServerName: {
    minWidth: 0,
    flexGrow: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

function SettingsTriggerButton(): React.ReactElement {
  return (
    <Tooltip label="Settings">
      <IconButton
        data-shell-no-drag=""
        size="sm"
        variant="quiet"
        aria-label="Open settings"
        onClick={() => {
          settingsActions.open();
        }}
      >
        <Icon icon={IconSettingsGear2} size="sm" />
      </IconButton>
    </Tooltip>
  );
}

function ServerControl(): React.ReactElement {
  const { servers } = useOpenCodeServerConnections();
  const selected = servers.find((connection) => connection.selected) ?? servers[0];
  const selectedStatus = selected === undefined ? null : serverStatus(selected.status);

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <IconButton
            data-shell-no-drag=""
            size="sm"
            variant="quiet"
            aria-label={`Current server: ${selected?.server.label ?? "No server"}. Status: ${selectedStatus?.detail ?? "Not connected"}.`}
          >
            <StatusDot
              tone={selectedStatus?.tone ?? "neutral"}
              pulse={selectedStatus?.pulse ?? false}
            />
          </IconButton>
        }
      />
      <Menu.Popup side="bottom" align="end">
        <Menu.Group>
          <Menu.GroupLabel>Servers</Menu.GroupLabel>
          {servers.map((connection) => {
            const status = connection.removing
              ? {
                  tone: "neutral" as const,
                  pulse: true,
                  label: "Working" as const,
                  detail: "Removing access",
                }
              : serverStatus(connection.status);
            return (
              <Menu.CheckboxItem
                key={connection.server.key}
                checked={connection.selected}
                disabled={
                  connection.status === "failed" ||
                  connection.status === "credential-missing" ||
                  connection.removing
                }
                aria-label={`${connection.server.label}, ${status.label}, ${status.detail}`}
                onClick={() => serverActions.select(connection.server.key)}
              >
                <StatusDot tone={status.tone} pulse={status.pulse} />
                <span {...stylex.props(styles.menuServerName)}>{connection.server.label}</span>
                <Text as="span" size="xs" tone="muted">
                  {status.detail}
                </Text>
              </Menu.CheckboxItem>
            );
          })}
          {servers.length === 0 ? <Menu.Item disabled>No servers added</Menu.Item> : null}
        </Menu.Group>
        <Menu.Separator />
        {canManageDesktopRemoteHost() ? (
          <Menu.Item onClick={() => connectDeviceRequest.actions.open()}>Connect device…</Menu.Item>
        ) : null}
        <Menu.Item onClick={() => settingsActions.open("servers")}>Manage servers…</Menu.Item>
        {canManageDesktopRemoteHost() ? (
          <Menu.Item onClick={() => settingsActions.open("connections")}>
            Manage connections…
          </Menu.Item>
        ) : null}
      </Menu.Popup>
    </Menu.Root>
  );
}

function AppShell({
  isInteractive = true,
}: {
  readonly isInteractive?: boolean;
}): React.ReactElement {
  const trailing = (
    <TitleBarTrailing>
      <HonkDesktopTitlebarControls />
      <ServerControl />
      <SettingsTriggerButton />
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
      <FileTypeIconSprite />
      <Shell material={shouldUseDesktopGlass() ? "glass" : "solid"} style={schemeStyles[theme]}>
        <HonkDesktopExtensionLayout>
          <Shell.TitleBar trailing={trailing}>
            {isTabStripHidden ? null : (
              // Home is tab-store slot 0. A separate Home button would duplicate chrome.
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
            )}
          </Shell.TitleBar>
          <Shell.Stage>
            <Shell.Sheet>
              <Outlet />
            </Shell.Sheet>
          </Shell.Stage>
        </HonkDesktopExtensionLayout>
        {import.meta.env.DEV ? <DevelopmentPerformanceMonitor /> : null}
        {/* Shell overlays leave the Home/thread route mounted. */}
        <SettingsOverlayHost />
        <ConnectDeviceDialogHost />
        <CommandMenuOverlayHost />
        <ToastViewportHost />
      </Shell>
    </TooltipProvider>
  );
}

export { AppShell };
