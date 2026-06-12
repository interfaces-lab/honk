import { cn } from "~/lib/utils";

export function SidebarItemTitle(props: { title: string; selected: boolean; muted?: boolean }) {
  return (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-honk-fg-secondary",
        props.selected && "text-honk-fg-primary",
        props.muted && "text-honk-fg-tertiary",
      )}
      data-agent-sidebar-title=""
      title={props.title}
    >
      {props.title}
    </span>
  );
}
