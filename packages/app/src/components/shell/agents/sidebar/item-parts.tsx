import type { ComponentProps, MouseEvent } from "react";

import { cn } from "~/lib/utils";

export function stopActionPointerDown(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();
}

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

export function SidebarItemTime(props: { ago: string; selected: boolean; compact?: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 truncate text-right text-(length:--multi-text-detail) leading-(--multi-leading-detail) tabular-nums",
        props.compact ? "max-w-14" : "min-w-8 max-w-14",
        props.selected ? "text-multi-fg-secondary" : "text-multi-fg-tertiary",
      )}
      data-agent-sidebar-subtitle=""
    >
      {props.ago}
    </span>
  );
}

export function SidebarIconButton(
  props: ComponentProps<"button"> & {
    label: string;
  },
) {
  const { label, className, children, ...rest } = props;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={stopActionPointerDown}
      className={cn(
        "flex size-5 shrink-0 cursor-(--multi-button-cursor) items-center justify-center rounded-multi-control border border-transparent bg-transparent p-0 text-multi-fg-tertiary outline-none hover:bg-multi-bg-quaternary hover:text-multi-fg-primary focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

