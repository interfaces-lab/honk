"use client";

import type { ComponentProps } from "react";

import { Button } from "./button";
import { cn, controlTransitionClassName } from "./utils";

type SidebarButtonProps = Omit<ComponentProps<typeof Button>, "type" | "variant">;

type SidebarItemProps = Omit<ComponentProps<typeof Button>, "variant"> & {
  interactive?: boolean;
  selected?: boolean;
};

function SidebarItem({
  className,
  draggable = false,
  interactive = true,
  selected,
  ...rest
}: SidebarItemProps) {
  return (
    <Button
      variant="ghost"
      data-selected={selected}
      draggable={draggable}
      className={cn(
        "font-multi flex min-h-6 w-full min-w-0 select-none items-center justify-start gap-1.5 rounded-multi-control border border-transparent px-1.5 py-0.5 text-left text-(length:--multi-sidebar-label-size) font-normal leading-(--multi-sidebar-label-leading) [-webkit-user-drag:none]",
        interactive &&
          cn(
            "cursor-(--multi-button-cursor) outline-none ring-offset-0 transition-[background-color,color] hover:bg-multi-bg-quaternary data-[highlighted=true]:bg-multi-bg-secondary data-[highlighted=true]:outline data-[highlighted=true]:outline-1 data-[highlighted=true]:-outline-offset-1 data-[highlighted=true]:outline-multi-stroke-focused focus-visible:ring-offset-0",
            controlTransitionClassName,
          ),
        "data-[selected=true]:bg-multi-bg-quaternary data-[selected=true]:hover:bg-multi-bg-quaternary",
        "bg-transparent shadow-none before:hidden",
        className,
      )}
      {...rest}
    />
  );
}

function SidebarButton(
  props: SidebarButtonProps & {
    variant: "chrome" | "item" | "inset";
  },
) {
  const { variant, className, ...rest } = props;
  if (variant === "item") {
    return (
      <SidebarItem className={cn("group/sidebar-item relative h-auto", className)} {...rest} />
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        variant === "chrome"
          ? cn(
              "font-multi flex min-h-6.5 w-full cursor-(--multi-button-cursor) select-none items-center justify-start gap-1.5 rounded-multi-control border border-transparent px-2 py-1 text-left text-(length:--multi-sidebar-label-size) font-normal leading-(--multi-sidebar-label-leading) text-muted-foreground transition-colors [-webkit-user-drag:none]",
              controlTransitionClassName,
            )
          : "min-h-0 min-w-0 flex-1 cursor-(--multi-button-cursor) select-none justify-start border-0 bg-transparent p-0 text-left font-normal shadow-none outline-none ring-offset-0 before:hidden transition-none hover:!bg-transparent data-pressed:!bg-transparent data-[highlighted=true]:!bg-transparent data-[selected=true]:!bg-transparent [-webkit-user-drag:none]",
        className,
      )}
      {...rest}
    />
  );
}

export { SidebarButton, SidebarItem };
