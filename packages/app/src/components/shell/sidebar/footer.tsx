"use client";

import { Link } from "@tanstack/react-router";
import { IconSettingsGear2 } from "central-icons";

import { DEFAULT_SETTINGS_ROUTE } from "~/components/settings/settings-sections";
import { UpdatePill } from "~/components/shell/shared/update-pill";
import { cn } from "~/lib/utils";

type ShellSidebarFooterProps =
  | { settings?: false }
  | { settings: true; onToggleSettings: () => void };

export function ShellSidebarFooter(props: ShellSidebarFooterProps) {
  const inSettings = props.settings === true;

  return (
    <div className="mt-auto flex shrink-0 select-none flex-col px-2.5 py-1.5">
      <UpdatePill />
      <div className="flex min-h-7 items-center justify-end gap-2 px-1.5 py-1">
        {inSettings ? (
          <button
            type="button"
            onClick={props.onToggleSettings}
            className={cn(
              "flex size-6 select-none items-center justify-center rounded-multi-control border border-transparent bg-multi-bg-tertiary text-foreground transition-colors hover:bg-multi-bg-tertiary hover:text-foreground",
            )}
            aria-label="Settings"
            aria-pressed
            draggable={false}
            title="Settings"
          >
            <IconSettingsGear2 className="size-4 shrink-0" />
          </button>
        ) : (
          <Link
            to={DEFAULT_SETTINGS_ROUTE}
            className={cn(
              "flex size-6 select-none items-center justify-center rounded-multi-control border border-transparent text-muted-foreground/60 transition-colors hover:bg-multi-hover hover:text-foreground",
            )}
            aria-label="Open settings"
            draggable={false}
          >
            <IconSettingsGear2 className="size-4 shrink-0" />
          </Link>
        )}
      </div>
    </div>
  );
}
