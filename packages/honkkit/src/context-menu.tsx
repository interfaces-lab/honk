"use client";

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import * as stylex from "@stylexjs/stylex";
import { forwardRef, type ReactNode } from "react";

import { honkMenuStyles } from "./menu-styles";
import { cn, honkMenuPickerShellClasses, honkMenuSeparatorClasses } from "./utils";
import { workbenchMenuItemClasses } from "./menu";

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
  const surfaceProps = stylex.props(honkMenuStyles.surface, honkMenuStyles.surfaceStarting);
  const viewportProps = stylex.props(honkMenuStyles.viewport);

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
            surfaceProps.className,
            "honk-workbench-menu-popup max-w-[calc(100vw-16px)] origin-(--transform-origin) select-none",
            honkMenuPickerShellClasses,
            className,
          )}
          style={surfaceProps.style}
          {...props}
        >
          <div
            className={cn(viewportProps.className, "honk-menu__viewport overscroll-contain")}
            style={viewportProps.style}
          >
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
    <ContextMenuPrimitive.Item className={cn(workbenchMenuItemClasses, className)} {...props}>
      {icon ? (
        <span className="honk-menu__slot-leading [&>svg]:size-3 [&>svg]:shrink-0">
          {icon}
        </span>
      ) : null}
      <span className="honk-menu__slot-label flex-1">{children}</span>
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
  workbenchMenuItemClasses as workbenchContextMenuItemClasses,
};
