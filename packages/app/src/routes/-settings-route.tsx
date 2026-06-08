import { Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  SettingsRestoreProvider,
  useSettingsRestoreState,
} from "~/components/settings/settings-restore-context";
import { ShellHost } from "~/components/shell-host";
import { resolveShortcutCommand } from "~/keybindings";
import { useServerKeybindings } from "~/rpc/server-state";

function SettingsContentLayout() {
  const { restoreSignal } = useSettingsRestoreState();
  const keybindings = useServerKeybindings();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const command = resolveShortcutCommand(event, keybindings, {
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
  }, [keybindings]);

  return (
    <div className="settings-form-page flex min-h-0 min-w-0 flex-1 flex-col bg-transparent text-foreground">
      <div key={restoreSignal} className="min-h-0 flex flex-1 flex-col overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

export function SettingsRouteLayout() {
  return (
    <SettingsRestoreProvider>
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
        <ShellHost mode="settings">
          <SettingsContentLayout />
        </ShellHost>
      </div>
    </SettingsRestoreProvider>
  );
}
