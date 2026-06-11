"use client";

import type { ComponentProps } from "react";

import { Button } from "./button";
import { cn, controlTransitionClassName, interactiveControlCursorClassName } from "./utils";

type SidebarButtonProps = Omit<ComponentProps<typeof Button>, "type" | "variant">;

type SidebarItemProps = Omit<ComponentProps<typeof Button>, "variant"> & {
  interactive?: boolean;
  selected?: boolean;
};

function SidebarTray({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("ui-tray font-multi text-detail text-multi-fg-primary", className)}
      data-slot="sidebar-tray"
      {...props}
    />
  );
}

function SidebarTrayHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "ui-tray-header flex min-h-9 min-w-0 items-center justify-between gap-2 px-2.5 py-1.5",
        className,
      )}
      data-slot="sidebar-tray-header"
      {...props}
    />
  );
}

function SidebarTrayHeaderButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant">) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 rounded-multi-control px-1.5 py-1 text-left text-multi-fg-secondary transition-colors hover:bg-multi-bg-quaternary hover:text-multi-fg-primary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none",
        "bg-transparent shadow-none before:hidden",
        controlTransitionClassName,
        className,
      )}
      data-slot="sidebar-tray-header-button"
      {...props}
    />
  );
}

function SidebarItem({
  className,
  draggable = false,
  interactive = true,
  nativeButton,
  render,
  selected,
  ...rest
}: SidebarItemProps) {
  return (
    <Button
      variant="ghost"
      typography="sidebar"
      data-selected={selected}
      data-slot="sidebar-item"
      draggable={draggable}
      nativeButton={nativeButton ?? (render ? false : undefined)}
      render={render}
      className={cn(
        "flex min-h-sidebar-item w-full min-w-0 select-none items-center justify-start gap-sidebar-item-gap rounded-multi-control border border-transparent px-1.5 py-1 text-left transition-none [-webkit-user-drag:none]",
        interactive &&
          cn(
            "outline-none ring-offset-0 hover:bg-multi-bg-quaternary data-[highlighted=true]:bg-multi-bg-secondary data-[highlighted=true]:outline data-[highlighted=true]:outline-1 data-[highlighted=true]:-outline-offset-1 data-[highlighted=true]:outline-multi-stroke-focused focus-visible:ring-offset-0",
            interactiveControlCursorClassName,
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
      typography={variant === "chrome" ? "sidebar" : "inherit"}
      data-slot={`sidebar-button-${variant}`}
      className={cn(
        variant === "chrome"
          ? cn(
              "flex min-h-sidebar-item w-full select-none items-center justify-start gap-sidebar-item-gap rounded-multi-control border border-transparent px-1.5 py-1 text-left text-muted-foreground transition-colors [-webkit-user-drag:none]",
              interactiveControlCursorClassName,
              controlTransitionClassName,
            )
          : cn(
              "min-h-0 min-w-0 flex-1 select-none justify-start border-0 bg-transparent p-0 text-left shadow-none outline-none ring-offset-0 before:hidden transition-none hover:!bg-transparent data-pressed:!bg-transparent data-[highlighted=true]:!bg-transparent data-[selected=true]:!bg-transparent [-webkit-user-drag:none]",
              interactiveControlCursorClassName,
            ),
        className,
      )}
      {...rest}
    />
  );
}

function SidebarTrayRow({ className, ...props }: SidebarItemProps) {
  return (
    <SidebarItem
      className={cn(
        "ui-tray-row group/sidebar-item h-auto data-[selected=true]:focus-within:bg-multi-bg-tertiary",
        className,
      )}
      data-slot="sidebar-tray-row"
      {...props}
    />
  );
}

function SidebarTrayRowContent({ className, ...props }: SidebarButtonProps) {
  return (
    <SidebarButton
      className={cn("ui-tray-row__content overflow-hidden disabled:opacity-100", className)}
      data-slot="sidebar-tray-row-content"
      variant="inset"
      {...props}
    />
  );
}

function SidebarTrayRowLabel({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "ui-tray-row__label min-w-0 flex-1 truncate text-multi-fg-secondary",
        className,
      )}
      data-slot="sidebar-tray-row-label"
      {...props}
    />
  );
}

function SidebarTrayRowStatus({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "ui-tray-row__status min-w-8 max-w-14 shrink-0 truncate text-right text-sidebar-subtitle text-multi-fg-secondary",
        className,
      )}
      data-slot="sidebar-tray-row-status"
      {...props}
    />
  );
}

export {
  SidebarButton,
  SidebarItem,
  SidebarTray,
  SidebarTrayHeader,
  SidebarTrayHeaderButton,
  SidebarTrayRow,
  SidebarTrayRowContent,
  SidebarTrayRowLabel,
  SidebarTrayRowStatus,
};
