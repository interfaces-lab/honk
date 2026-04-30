import { Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  SettingsRestoreProvider,
  useSettingsRestoreState,
} from "~/components/settings/settings-restore-context";
import { ShellHost } from "~/components/shell-host";

function SettingsContentLayout() {
  const { restoreSignal } = useSettingsRestoreState();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        window.history.back();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

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
      <ShellHost mode="settings">
        <SettingsContentLayout />
      </ShellHost>
    </SettingsRestoreProvider>
  );
}
