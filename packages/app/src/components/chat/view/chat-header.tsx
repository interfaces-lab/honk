import { IconSidebar } from "central-icons";
import { Button } from "@honk/multikit/button";
import { shellPanelsActions } from "~/stores/shell-panels-store";
import type { ReactNode } from "react";

interface ChatHeaderProps {
  activeThreadTitle: string;
  actions?: ReactNode | undefined;
}

export function ChatHeader({ activeThreadTitle, actions }: ChatHeaderProps) {
  return (
    <div className="@container/header-actions pointer-events-auto flex min-w-0 flex-1 select-none items-center gap-(--honk-workbench-chrome-action-gap) text-body">
      <div className="flex min-w-0 flex-1 items-center gap-(--honk-workbench-chrome-action-gap) overflow-hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="hidden size-(--honk-titlebar-control-height) min-w-(--honk-titlebar-control-height) shrink-0 rounded-honk-control p-0 shadow-none before:hidden in-data-[shell-left-mode=overlay]:flex"
          aria-label="Toggle sidebar"
          onClick={() => shellPanelsActions.toggleLeft()}
        >
          <IconSidebar className="size-4 shrink-0" />
        </Button>
        <div className="no-drag flex min-w-0 shrink items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Chat title. Right-click for more actions. ${activeThreadTitle}`}
            className="h-auto min-w-0 shrink justify-start rounded-sm px-1 py-0.5 text-left text-body font-medium text-honk-fg-primary shadow-none before:hidden"
            title={activeThreadTitle}
          >
            <span className="min-w-0 truncate">{activeThreadTitle}</span>
          </Button>
        </div>
        {actions ? (
          <div className="no-drag flex min-w-0 shrink items-center gap-(--honk-workbench-chrome-action-gap) overflow-hidden">
            {actions}
          </div>
        ) : null}
      </div>
      <div
        className="drag-region pointer-events-auto min-h-(--honk-titlebar-control-height) min-w-8 flex-1 self-center"
        aria-hidden
      />
    </div>
  );
}
