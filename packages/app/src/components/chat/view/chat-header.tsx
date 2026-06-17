import { IconSidebar } from "central-icons";
import { Button } from "@honk/honkkit/button";
import {
  WorkbenchChromeDivider,
  workbenchChromeTextControlVariants,
} from "@honk/honkkit/workbench-chrome-row";
import { shellPanelsActions } from "~/stores/shell-panels-store";
import { cn } from "~/lib/utils";
import type { ReactNode } from "react";

interface ChatHeaderProps {
  activeThreadTitle: string;
  actions?: ReactNode | undefined;
}

export function ChatHeader({ activeThreadTitle, actions }: ChatHeaderProps) {
  const title = activeThreadTitle.trim();
  const hasActions = actions !== undefined && actions !== null;

  return (
    <div className="@container/header-actions content-pane-top-bar__scroll-area flex min-w-0 flex-1 select-none items-center text-body">
      <div
        className="no-drag flex min-w-0 flex-1 items-center overflow-hidden"
        data-shell-no-drag=""
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="no-drag mr-1 hidden size-(--honk-titlebar-control-height) min-w-(--honk-titlebar-control-height) shrink-0 rounded-honk-control p-0 shadow-none before:hidden in-data-[shell-left-mode=overlay]:flex"
          data-no-drag=""
          data-shell-no-drag=""
          aria-label="Toggle sidebar"
          onClick={() => shellPanelsActions.toggleLeft()}
        >
          <IconSidebar className="size-4 shrink-0" />
        </Button>
        {title ? (
          <div
            className="no-drag flex min-w-0 shrink items-center overflow-hidden"
            data-shell-no-drag=""
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Chat title. Right-click for more actions. ${title}`}
              className={cn(
                workbenchChromeTextControlVariants({ tone: "primary" }),
                "min-w-0 max-w-full shrink justify-start rounded-sm py-0 text-left shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent",
              )}
              data-shell-no-drag=""
              title={title}
            >
              <span className="min-w-0 truncate">{title}</span>
            </Button>
          </div>
        ) : null}
        <div
          className={cn(
            "content-pane-top-bar__trailing-wrap no-drag flex shrink-0 items-center overflow-hidden transition-[max-width,opacity] duration-150 ease-out motion-reduce:transition-none",
            hasActions ? "max-w-[520px] opacity-100" : "pointer-events-none max-w-0 opacity-0",
          )}
          data-no-drag=""
          data-shell-no-drag=""
          aria-hidden={hasActions ? undefined : true}
        >
          <div className="flex w-max items-center gap-2 pl-2">
            {title ? <WorkbenchChromeDivider /> : null}
            <div className="content-pane-top-bar__action-group no-drag flex min-w-0 shrink items-center gap-2 overflow-hidden [&>div]:gap-2 [&_[data-slot=workbench-chrome-action-group]]:gap-2">
              {actions}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
