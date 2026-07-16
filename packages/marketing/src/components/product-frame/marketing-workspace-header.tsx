import { IconCollaborationPointerRight } from "central-icons";

import { cn } from "../../lib/classes";
import { MARKETING_SIDEBAR_WIDTH_CLASS } from "./layout";

export function MarketingWorkspaceHeader(props: { threadTitle: string }) {
  return (
    <header
      className="box-border flex h-titlebar shrink-0 items-stretch select-none"
      data-shell-no-drag=""
    >
      <div
        className={cn(
          MARKETING_SIDEBAR_WIDTH_CLASS,
          "hidden shrink-0 items-center border-r border-edge-muted bg-layer-01 px-2 lg:flex",
        )}
      >
        <button
          type="button"
          className="flex min-h-8 w-full flex-1 items-center justify-start gap-2 rounded-control border border-transparent bg-transparent px-1.5 py-1 text-left text-body text-muted transition-colors hover:bg-layer-02 hover:text-primary focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
        >
          <IconCollaborationPointerRight className="size-4 shrink-0 opacity-65" />
          <span className="min-w-0 flex-1 truncate">New Agent</span>
          <span className="shrink-0 text-right text-caption text-faint">⌘N</span>
        </button>
      </div>

      <div className="@container/header-actions flex min-w-0 flex-1 items-center bg-base px-panel-pad text-body">
        <div
          className="no-drag flex min-w-0 flex-1 items-center overflow-hidden"
          data-shell-no-drag=""
        >
          <hr
            aria-hidden
            className="hidden h-7 w-px shrink-0 self-center border-0 bg-edge-muted lg:block"
          />
          <div
            className="no-drag flex min-w-0 shrink items-center overflow-hidden"
            data-shell-no-drag=""
          >
            <button
              type="button"
              aria-label={`Chat title. ${props.threadTitle}`}
              className="inline-flex h-7 max-w-full min-w-0 shrink items-center justify-start gap-1.5 overflow-hidden rounded-control border-0 bg-transparent px-2 py-0 text-left text-detail font-normal text-primary shadow-none outline-hidden focus-visible:ring-1 focus-visible:ring-accent"
              data-shell-no-drag=""
              title={props.threadTitle}
            >
              <span className="min-w-0 truncate">{props.threadTitle}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
