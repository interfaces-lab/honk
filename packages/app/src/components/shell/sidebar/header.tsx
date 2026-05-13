import { IconCollaborationPointerRight, IconPlusLarge } from "central-icons";

import { RowButton } from "~/components/shell/shared/row-button";

export function ShellSidebarHeader(props: { onNewChat: () => void; onAddProject?: () => void }) {
  return (
    <div className="agent-window-sidebar-header relative z-30 flex shrink-0 select-none flex-col gap-1 px-2 pb-1.5 pt-2">
      <div className="agent-window-sidebar-header-top flex min-w-0 items-center gap-1">
        <RowButton
          variant="chrome"
          onClick={props.onNewChat}
          className="agent-window-new-agent flex-1 pl-2 pr-1.5"
        >
          <IconCollaborationPointerRight className="size-3.5 shrink-0 opacity-65" />
          <span className="min-w-0 flex-1 truncate">New Agent</span>
          <span className="agent-window-shortcut shrink-0">⌘N</span>
        </RowButton>
      </div>
      {props.onAddProject ? (
        <RowButton
          variant="chrome"
          onClick={props.onAddProject}
          className="agent-window-open-project flex-1"
          aria-label="Open project"
          data-testid="sidebar-add-project-trigger"
        >
          <IconPlusLarge className="size-3.5 shrink-0 opacity-65" />
          <span className="min-w-0 flex-1 truncate">Open Project</span>
        </RowButton>
      ) : null}
    </div>
  );
}
