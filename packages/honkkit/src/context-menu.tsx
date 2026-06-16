"use client";

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { cva } from "class-variance-authority";
import { forwardRef, type ReactNode } from "react";

import { cn, controlTransitionVariants, honkMenuSeparatorClasses, interactiveControlCursorVariants } from "./utils";

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

const workbenchContextMenuItemVariants = cva(
  cn(
    "flex w-full items-center gap-1.5 rounded-sm px-1 py-1 text-left text-foreground/82 outline-none transition-colors hover:bg-honk-hover/40 data-highlighted:bg-honk-active data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-45 focus-visible:outline-none",
    interactiveControlCursorVariants(),
    controlTransitionVariants(),
  ),
);

function WorkbenchContextMenuPopup({
  children,
  className,
  align = "start",
  positionerClassName,
  sideOffset = 8,
  ...props
}: ContextMenuPrimitive.Popup.Props & {
  align?: ContextMenuPrimitive.Positioner.Props["align"];
  positionerClassName?: string | undefined;
  sideOffset?: ContextMenuPrimitive.Positioner.Props["sideOffset"];
}) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        className={cn("z-(--z-index-workbench-context-menu) outline-none", positionerClassName)}
        sideOffset={sideOffset}
        align={align}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-popup"
          className={cn(
            "honk-slash-menu-popup w-72 max-w-screen origin-(--transform-origin) select-none overflow-hidden rounded-honk-lg border border-honk-stroke bg-honk-bubble text-honk-chrome shadow-honk-sm outline-hidden",
            className,
          )}
          {...props}
        >
          <div className="flex max-h-72 min-h-0 flex-col gap-px overflow-y-auto overscroll-contain p-1">
            {children}
          </div>
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
      className={cn(workbenchContextMenuItemVariants(), className)}
      {...props}
    >
      {icon ? (
        <span className="inline-flex h-4 w-3 shrink-0 items-center justify-center text-muted-foreground/60 [&>svg]:size-3 [&>svg]:shrink-0">
          {icon}
        </span>
      ) : null}
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
      className={cn(honkMenuSeparatorClasses, className)}
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
  workbenchContextMenuItemVariants,
};
