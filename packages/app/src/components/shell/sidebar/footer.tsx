"use client";

import { Link } from "@tanstack/react-router";
import { IconSettingsGear2 } from "central-icons";

import { cn } from "~/lib/utils";
import { UpdatePill } from "~/components/shell/shared/update-pill";

export function ShellSidebarFooter(props: { settings?: boolean }) {
  const active = Boolean(props.settings);

  return (
    <div className="agent-window-sidebar-footer mt-auto flex shrink-0 flex-col px-3 py-1.5">
      <UpdatePill />
      <div className="flex items-center justify-between py-1">
        <span className="agent-window-account-label text-detail text-muted-foreground/50">
          Multi
        </span>
        <div className="flex items-center gap-0.5">
          <Link
            to={active ? "/" : "/settings/general"}
            className={cn(
              "flex size-7 items-center justify-center rounded-multi-control border border-transparent transition-colors",
              active
                ? "border-multi-border/90 bg-multi-active text-foreground hover:bg-multi-active"
                : "text-muted-foreground/60 hover:bg-multi-hover hover:text-foreground",
            )}
            aria-current={active ? "page" : undefined}
            aria-label={active ? "Back to chat" : "Open settings"}
          >
            <IconSettingsGear2 className="size-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
