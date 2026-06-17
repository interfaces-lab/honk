"use client";

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { forwardRef, type ReactNode } from "react";

import { cn, honkMenuPickerShellClasses, honkMenuSeparatorClasses } from "./utils";
import { workbenchMenuItemVariants } from "./menu";

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
            "honk-workbench-menu-popup w-60 max-w-[calc(100vw-16px)] origin-(--transform-origin) select-none",
            honkMenuPickerShellClasses,
            className,
          )}
          {...props}
        >
          <div className="max-h-72 w-full overflow-y-auto overscroll-contain p-1">{children}</div>
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
    <ContextMenuPrimitive.Item className={cn(workbenchMenuItemVariants(), className)} {...props}>
      {icon ? (
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-honk-fg-tertiary [&>svg]:size-3 [&>svg]:shrink-0">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-body">{children}</span>
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
  workbenchMenuItemVariants as workbenchContextMenuItemVariants,
};
