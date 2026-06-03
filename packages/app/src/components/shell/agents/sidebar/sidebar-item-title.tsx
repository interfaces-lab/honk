import { cn } from "~/lib/utils";

export function SidebarItemTitle(props: { title: string; selected: boolean }) {
  return (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-multi-fg-secondary",
        props.selected && "text-multi-fg-primary",
      )}
      data-agent-sidebar-title=""
      title={props.title}
    >
      {props.title}
    </span>
  );
}
