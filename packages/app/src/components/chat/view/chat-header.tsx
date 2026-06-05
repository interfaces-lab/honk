import { IconSidebar } from "central-icons";
import { Button } from "@multi/multikit/button";
import { shellPanelsActions } from "~/stores/shell-panels-store";
import type { ReactNode } from "react";

interface ChatHeaderProps {
  activeThreadTitle: string;
  actions?: ReactNode | undefined;
}

export function ChatHeader({ activeThreadTitle, actions }: ChatHeaderProps) {
  return (
    <div className="@container/header-actions pointer-events-auto flex min-w-0 flex-1 select-none items-center gap-2 text-body">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-(--multi-titlebar-control-height) min-w-(--multi-titlebar-control-height) shrink-0 rounded-multi-control p-0 shadow-none before:hidden md:hidden"
          aria-label="Toggle sidebar"
          onClick={() => shellPanelsActions.toggleLeft()}
        >
          <IconSidebar className="size-4 shrink-0" />
        </Button>
        <div className="no-drag flex min-w-0 shrink items-center">
          <button
            type="button"
            aria-label={`Chat title. Right-click for more actions. ${activeThreadTitle}`}
            className="flex min-w-0 shrink items-center rounded-sm px-1 py-0.5 text-left text-body font-medium text-multi-fg-primary hover:bg-multi-bg-quaternary"
            title={activeThreadTitle}
          >
            <span className="min-w-0 truncate">{activeThreadTitle}</span>
          </button>
        </div>
        {actions ? (
          <div className="no-drag flex min-w-0 shrink items-center gap-1 overflow-hidden">
            {actions}
          </div>
        ) : null}
      </div>
      <div
        className="drag-region pointer-events-auto min-h-(--multi-titlebar-control-height) min-w-8 flex-1 self-center"
        aria-hidden
      />
    </div>
  );
}
