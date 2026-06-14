import { IconSidebar } from "central-icons";
import { Button } from "@honk/honkkit/button";
import { WorkbenchChromeDivider } from "@honk/honkkit/workbench-chrome-row";
import { shellPanelsActions } from "~/stores/shell-panels-store";
import type { ReactNode } from "react";

interface ChatHeaderProps {
  activeThreadTitle: string;
  actions?: ReactNode | undefined;
}

export function ChatHeader({ activeThreadTitle, actions }: ChatHeaderProps) {
  const title = activeThreadTitle.trim();
  return (
    <div className="@container/header-actions pointer-events-auto flex min-w-0 flex-1 select-none items-center gap-2 text-body">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
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
        {title ? (
          <div className="no-drag flex min-w-0 shrink items-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Chat title. Right-click for more actions. ${title}`}
              className="h-(--honk-workbench-tab-height) min-w-0 shrink justify-start rounded-sm px-0 py-0 text-left text-body font-medium text-honk-icon-primary shadow-none before:hidden hover:bg-transparent hover:text-honk-icon-primary data-pressed:bg-transparent"
              title={title}
            >
              <span className="min-w-0 truncate">{title}</span>
            </Button>
          </div>
        ) : null}
        {title && actions ? <WorkbenchChromeDivider /> : null}
        {actions ? (
          <div className="no-drag flex min-w-0 shrink items-center gap-2 overflow-hidden [&>div]:gap-2 [&_[data-slot=workbench-chrome-action-group]]:gap-2">
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
