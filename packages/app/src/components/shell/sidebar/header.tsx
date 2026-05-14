import { IconCollaborationPointerRight, IconPlusLarge } from "central-icons";

import { RowButton } from "~/components/shell/shared/row-button";

export function ShellSidebarHeader(props: { onNewChat: () => void; onAddProject?: () => void }) {
  return (
    <div className="relative z-30 flex shrink-0 select-none flex-col gap-1 px-2 pt-2 pb-1.5">
      <div className="flex min-h-[22px] min-w-0 items-center gap-0.5">
        <RowButton
          variant="chrome"
          onClick={props.onNewChat}
          className="flex-1 bg-multi-bg-quinary pl-2 pr-1.5 text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary"
        >
          <IconCollaborationPointerRight className="size-3.5 shrink-0 opacity-65" />
          <span className="min-w-0 flex-1 truncate">New Agent</span>
          <span className="shrink-0 text-caption text-multi-fg-quaternary">⌘N</span>
        </RowButton>
      </div>
      {props.onAddProject ? (
        <RowButton
          variant="chrome"
          onClick={props.onAddProject}
          className="flex-1 text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary"
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
