import { Button } from "@honk/honkkit/button";
import { SidebarButton } from "@honk/honkkit/sidebar";
import {
  WorkbenchChromeDivider,
  workbenchChromeTextControlVariants,
} from "@honk/honkkit/workbench-chrome-row";
import { cn } from "@honk/honkkit/utils";
import { IconCollaborationPointerRight } from "central-icons";

import { MARKETING_SIDEBAR_WIDTH_CLASS } from "./layout";

export function MarketingWorkspaceHeader(props: { threadTitle: string }) {
  return (
    <header
      className="agent-window-chat-header content-pane-top-bar box-border flex h-(--honk-workbench-chrome-row-height) shrink-0 items-stretch select-none"
      data-shell-no-drag=""
    >
      <div
        className={cn(
          MARKETING_SIDEBAR_WIDTH_CLASS,
          "honk-shell-sidebar hidden shrink-0 items-center border-r border-honk-stroke-tertiary bg-honk-sidebar px-2 lg:flex",
        )}
      >
        <SidebarButton
          variant="chrome"
          className="flex-1 text-honk-fg-secondary hover:bg-honk-bg-quaternary hover:text-honk-fg-primary"
        >
          <IconCollaborationPointerRight className="size-4 shrink-0 opacity-65" />
          <span className="min-w-0 flex-1 truncate">New Agent</span>
          <span className="shrink-0 text-right text-caption text-honk-fg-quaternary">⌘N</span>
        </SidebarButton>
      </div>

      <div className="@container/header-actions flex min-w-0 flex-1 items-center bg-honk-chat px-(--honk-workbench-chrome-padding-inline) text-body">
        <div className="no-drag flex min-w-0 flex-1 items-center overflow-hidden" data-shell-no-drag="">
          <WorkbenchChromeDivider className="hidden lg:block" />
          <div className="no-drag flex min-w-0 shrink items-center overflow-hidden" data-shell-no-drag="">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Chat title. ${props.threadTitle}`}
              className={cn(
                workbenchChromeTextControlVariants({ tone: "primary" }),
                "min-w-0 max-w-full shrink justify-start rounded-sm py-0 text-left shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent",
              )}
              data-shell-no-drag=""
              title={props.threadTitle}
            >
              <span className="min-w-0 truncate">{props.threadTitle}</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
