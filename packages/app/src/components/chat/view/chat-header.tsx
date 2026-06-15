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
    <div className="@container/header-actions flex min-w-0 flex-1 select-none items-center gap-2 text-body">
      <div
        className="no-drag flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
        data-shell-no-drag=""
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="no-drag hidden size-(--honk-titlebar-control-height) min-w-(--honk-titlebar-control-height) shrink-0 rounded-honk-control p-0 shadow-none before:hidden in-data-[shell-left-mode=overlay]:flex"
          data-shell-no-drag=""
          aria-label="Toggle sidebar"
          onClick={() => shellPanelsActions.toggleLeft()}
        >
          <IconSidebar className="size-4 shrink-0" />
        </Button>
        {title ? (
          <div className="no-drag flex min-w-0 shrink items-center" data-shell-no-drag="">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Chat title. Right-click for more actions. ${title}`}
              className="no-drag h-(--honk-workbench-tab-height) min-w-0 shrink justify-start rounded-sm px-0 py-0 text-left text-body font-medium text-honk-icon-primary shadow-none before:hidden hover:bg-transparent hover:text-honk-icon-primary data-pressed:bg-transparent"
              data-shell-no-drag=""
              title={title}
            >
              <span className="min-w-0 truncate">{title}</span>
            </Button>
          </div>
        ) : null}
        {title && actions ? <WorkbenchChromeDivider /> : null}
        {actions ? (
          <div
            className="no-drag flex min-w-0 shrink items-center gap-2 overflow-hidden [&>div]:gap-2 [&_[data-slot=workbench-chrome-action-group]]:gap-2"
            data-shell-no-drag=""
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
