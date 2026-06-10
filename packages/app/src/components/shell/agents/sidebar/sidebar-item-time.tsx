import { cn } from "~/lib/utils";

export function SidebarItemTime(props: { ago: string; selected: boolean; compact?: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 truncate text-right text-sidebar-subtitle tabular-nums",
        props.compact ? "max-w-14" : "min-w-8 max-w-14",
        props.selected ? "text-multi-fg-secondary" : "text-multi-fg-tertiary",
      )}
      data-agent-sidebar-subtitle=""
    >
      {props.ago}
    </span>
  );
}
