"use client";

import { Link, useNavigate } from "@tanstack/react-router";
import { IconSettingsGear2 } from "central-icons";

import { cn } from "~/lib/utils";
import { readLastChatRouteTarget } from "~/app/routes/chat-route-persistence";
import { UpdatePill } from "~/components/shell/shared/update-pill";

export function ShellSidebarFooter(props: { settings?: boolean }) {
  const active = Boolean(props.settings);
  const navigate = useNavigate();

  const settingsBackButton = active ? (
    <button
      type="button"
      className={cn(
        "flex size-6 select-none items-center justify-center rounded-multi-control border border-transparent transition-colors",
        "border-multi-border/90 bg-multi-active text-foreground hover:bg-multi-active",
      )}
      onClick={() => {
        const lastChatRouteTarget = readLastChatRouteTarget();
        if (lastChatRouteTarget?.kind === "draft") {
          void navigate({
            to: "/draft/$draftId",
            params: { draftId: lastChatRouteTarget.draftId },
          });
          return;
        }
        if (lastChatRouteTarget?.kind === "server") {
          void navigate({
            to: "/$environmentId/$threadId",
            params: {
              environmentId: lastChatRouteTarget.threadRef.environmentId,
              threadId: lastChatRouteTarget.threadRef.threadId,
            },
          });
          return;
        }
        void navigate({ to: "/" });
      }}
      aria-current="page"
      aria-label="Back to chat"
    >
      <IconSettingsGear2 className="size-4 shrink-0" />
    </button>
  ) : null;

  return (
    <div className="mt-auto flex shrink-0 select-none flex-col px-2.5 py-1.5">
      <UpdatePill />
      <div className=" flex min-h-7 items-center justify-end gap-2 px-1.5 py-1">
        {settingsBackButton ?? (
          <Link
            to="/settings/general"
            className={cn(
              "flex size-6 select-none items-center justify-center rounded-multi-control border border-transparent text-muted-foreground/60 transition-colors hover:bg-multi-hover hover:text-foreground",
            )}
            aria-label="Open settings"
          >
            <IconSettingsGear2 className="size-4 shrink-0" />
          </Link>
        )}
      </div>
    </div>
  );
}
