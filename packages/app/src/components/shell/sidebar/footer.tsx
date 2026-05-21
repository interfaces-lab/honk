"use client";

import { Link } from "@tanstack/react-router";
import { IconSettingsGear2 } from "central-icons";

import { cn } from "~/lib/utils";
import { UpdatePill } from "~/components/shell/shared/update-pill";

export function ShellSidebarFooter(props: { settings?: boolean }) {
  const inSettings = Boolean(props.settings);

  return (
    <div className="mt-auto flex shrink-0 select-none flex-col px-2.5 py-1.5">
      <UpdatePill />
      {inSettings ? null : (
        <div className="flex min-h-7 items-center justify-end gap-2 px-1.5 py-1">
          <Link
            to="/settings/general"
            className={cn(
              "flex size-6 select-none items-center justify-center rounded-multi-control border border-transparent text-muted-foreground/60 transition-colors hover:bg-multi-hover hover:text-foreground",
            )}
            aria-label="Open settings"
          >
            <IconSettingsGear2 className="size-4 shrink-0" />
          </Link>
        </div>
      )}
    </div>
  );
}
