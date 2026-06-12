import { IconCollaborationPointerRight, IconFolderAddRight } from "central-icons";

import { SidebarButton } from "@honk/multikit/sidebar";

export function ShellSidebarHeader(props: { onNewChat: () => void; onAddProject?: () => void }) {
  return (
    <div className="relative z-30 flex shrink-0 select-none flex-col gap-1 px-2 pt-2 pb-1.5">
      <div className="flex min-h-[22px] min-w-0 items-center gap-0.5">
        <SidebarButton
          variant="chrome"
          onClick={props.onNewChat}
          className="flex-1 text-honk-fg-secondary hover:bg-honk-bg-quaternary hover:text-honk-fg-primary"
          data-testid="new-thread-button"
        >
          <IconCollaborationPointerRight className="size-4 shrink-0 opacity-65" />
          <span className="min-w-0 flex-1 truncate">New Agent</span>
          <span className="shrink-0 text-right text-caption text-honk-fg-quaternary">⌘N</span>
        </SidebarButton>
      </div>
      {props.onAddProject ? (
        <div className="flex min-h-[22px] min-w-0 w-full items-center gap-0.5">
          <SidebarButton
            variant="chrome"
            onClick={props.onAddProject}
            className="w-full flex-1 text-honk-fg-secondary hover:bg-honk-bg-quaternary hover:text-honk-fg-primary"
            aria-label="Open workspace"
            data-testid="sidebar-add-project-trigger"
          >
            <IconFolderAddRight className="size-4 shrink-0 opacity-65" />
            <span className="min-w-0 flex-1 truncate">Open Workspace</span>
          </SidebarButton>
        </div>
      ) : null}
    </div>
  );
}
