import { useSearch } from "@tanstack/react-router";
import { useRef } from "react";

import { AppearanceSettingsPanel } from "~/components/settings/appearance/appearance-settings-panel";
import {
  SettingsRestoreProvider,
  useSettingsRestoreState,
} from "~/components/settings/settings-restore-context";
import { SettingsSearchProvider } from "~/components/settings/settings-search-context";
import {
  AgentsSettingsPanel,
  ArchivedThreadsPanel,
  GeneralSettingsPanel,
  SkillsSettingsPanel,
} from "~/components/settings/settings-panels";
import { ShellHost } from "~/components/shell-host";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { resolveShortcutCommand } from "~/keybindings";
import { useServerKeybindings } from "~/rpc/server-state";

function SettingsSectionPanel() {
  const { section } = useSearch({ from: "/settings" });

  switch (section) {
    case "appearance":
      return <AppearanceSettingsPanel />;
    case "agents":
      return <AgentsSettingsPanel />;
    case "skills":
      return <SkillsSettingsPanel />;
    case "archived":
      return <ArchivedThreadsPanel />;
    case "general":
      return <GeneralSettingsPanel />;
  }
}

function SettingsContentLayout() {
  const { restoreSignal } = useSettingsRestoreState();
  const keybindings = useServerKeybindings();
  const keybindingsRef = useRef(keybindings);
  keybindingsRef.current = keybindings;

  useMountEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const command = resolveShortcutCommand(event, keybindingsRef.current, {
        context: {
          terminalFocus: false,
          terminalOpen: false,
        },
      });
      if (command !== "route.back") {
        return;
      }

      event.preventDefault();
      window.history.back();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  return (
    <div className="settings-form-page flex min-h-0 min-w-0 flex-1 flex-col bg-(--honk-workbench-editor-surface-background) text-foreground">
      <div key={restoreSignal} className="min-h-0 flex flex-1 flex-col overflow-y-auto">
        <SettingsSectionPanel />
      </div>
    </div>
  );
}

export function SettingsRouteLayout() {
  return (
    <SettingsRestoreProvider>
      <SettingsSearchProvider>
        <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
          <ShellHost mode="settings">
            <SettingsContentLayout />
          </ShellHost>
        </div>
      </SettingsSearchProvider>
    </SettingsRestoreProvider>
  );
}
