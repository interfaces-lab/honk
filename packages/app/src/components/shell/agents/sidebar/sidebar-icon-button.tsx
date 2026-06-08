import type { ComponentProps, MouseEvent } from "react";

import { cn } from "~/lib/utils";

function stopActionPointerDown(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();
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
        "flex size-5 shrink-0 cursor-(--multi-button-cursor) items-center justify-center rounded-multi-control border border-transparent bg-transparent p-0 text-multi-fg-tertiary outline-hidden hover:bg-multi-bg-quaternary hover:text-multi-fg-primary focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
