"use client";

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { forwardRef, type ReactNode } from "react";

import { cn, controlTransitionClassName, interactiveControlCursorClassName } from "./utils";

const ContextMenu = ContextMenuPrimitive.Root;

const ContextMenuTrigger = forwardRef<HTMLDivElement, ContextMenuPrimitive.Trigger.Props>(
  function ContextMenuTrigger({ children, ...props }, ref) {
    return (
      <ContextMenuPrimitive.Trigger ref={ref} data-slot="context-menu-trigger" {...props}>
        {children}
      </ContextMenuPrimitive.Trigger>
    );
  },
);

const workbenchContextMenuPopupClassName =
  "multi-slash-menu-popup origin-(--transform-origin) overflow-hidden rounded-multi-card border border-multi-stroke bg-multi-bubble shadow-multi-popup w-72 max-w-screen text-body select-none outline-hidden";

const workbenchContextMenuViewportClassName =
  "flex max-h-72 min-h-0 flex-col gap-px overflow-y-auto overscroll-contain p-1";

const workbenchContextMenuItemClassName =
  cn(
    "flex w-full items-center gap-1.5 rounded-sm px-1 py-1 text-left text-foreground/82 outline-none transition-colors hover:bg-multi-hover/40 data-highlighted:bg-multi-active data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-45 focus-visible:outline-none",
    interactiveControlCursorClassName,
    controlTransitionClassName,
  );

const workbenchContextMenuIconSlotClassName =
  "inline-flex h-4 w-3 shrink-0 items-center justify-center text-muted-foreground/60 [&>svg]:size-3 [&>svg]:shrink-0";

const workbenchContextMenuSeparatorClassName = "my-0.5 h-px shrink-0 bg-multi-stroke/60";

function WorkbenchContextMenuPopup({
  children,
  className,
  align = "start",
  sideOffset = 8,
  ...props
}: ContextMenuPrimitive.Popup.Props & {
  align?: ContextMenuPrimitive.Positioner.Props["align"];
  sideOffset?: ContextMenuPrimitive.Positioner.Props["sideOffset"];
}) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="z-50 outline-none" sideOffset={sideOffset} align={align}>
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-popup"
          className={cn(workbenchContextMenuPopupClassName, "z-50", className)}
          {...props}
        >
          <div className={workbenchContextMenuViewportClassName}>{children}</div>
        </ContextMenuPrimitive.Popup>
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function WorkbenchContextMenuItem({
  children,
  className,
  icon,
  ...props
}: ContextMenuPrimitive.Item.Props & {
  icon?: ReactNode;
}) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(workbenchContextMenuItemClassName, className)}
      {...props}
    >
      {icon ? <span className={workbenchContextMenuIconSlotClassName}>{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </ContextMenuPrimitive.Item>
  );
}

function WorkbenchContextMenuSeparator({
  className,
  ...props
}: ContextMenuPrimitive.Separator.Props) {
  return (
    <ContextMenuPrimitive.Separator
      className={cn(workbenchContextMenuSeparatorClassName, className)}
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuTrigger,
  WorkbenchContextMenuItem,
  WorkbenchContextMenuPopup,
  WorkbenchContextMenuSeparator,
  workbenchContextMenuIconSlotClassName,
  workbenchContextMenuItemClassName,
  workbenchContextMenuPopupClassName,
  workbenchContextMenuSeparatorClassName,
  workbenchContextMenuViewportClassName,
};
