"use client";

import { Link } from "@tanstack/react-router";
import { IconSettingsGear2 } from "central-icons";

import { cn } from "~/lib/utils";
import { UpdatePill } from "~/components/shell/shared/update-pill";

export function ShellSidebarFooter(props: { settings?: boolean }) {
  const active = Boolean(props.settings);

  return (
    <div className="agent-window-sidebar-footer mt-auto flex shrink-0 flex-col px-2.5 py-1.5">
      <UpdatePill />
      <div className="agent-window-account-row flex min-h-7 items-center justify-between gap-2 px-1.5 py-1">
        <span className="agent-window-account-label flex min-w-0 items-center gap-1.5 text-detail text-muted-foreground/55">
          <span className="agent-window-account-avatar flex size-4 shrink-0 items-center justify-center rounded-full text-[9px]/[10px] font-medium">
            M
          </span>
          <span className="min-w-0 truncate">Multi</span>
        </span>
        <Link
          to={active ? "/" : "/settings/general"}
          className={cn(
            "agent-window-footer-icon flex size-6 items-center justify-center rounded-multi-control border border-transparent transition-colors",
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
  );
}
