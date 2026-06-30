import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import * as stylex from "@stylexjs/stylex";

import { honkMenuStyles } from "./menu-styles";
import { cn, honkMenuPickerShellClasses } from "./utils";

const TooltipCreateHandle = TooltipPrimitive.createHandle;

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return (
    <TooltipPrimitive.Trigger data-slot="tooltip-trigger" data-tooltip-trigger="" {...props} />
  );
}

function TooltipPopup({
  className,
  align = "center",
  sideOffset = 4,
  side = "top",
  anchor,
  children,
  variant = "default",
  ...props
}: TooltipPrimitive.Popup.Props & {
  align?: TooltipPrimitive.Positioner.Props["align"];
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: TooltipPrimitive.Positioner.Props["sideOffset"];
  anchor?: TooltipPrimitive.Positioner.Props["anchor"];
  /** `workbench` = honk-token shell aligned with elevated menus (see Popover `variant="workbench"`). */
  variant?: "default" | "workbench";
}) {
  const workbench = variant === "workbench";
  const workbenchSurfaceProps = stylex.props(
    honkMenuStyles.surface,
    honkMenuStyles.surfaceStarting,
  );
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        anchor={anchor}
        className={cn(
          "h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none",
          workbench ? "z-(--z-index-workbench-tooltip)" : "z-(--z-index-tooltip)",
        )}
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          className={cn(
            workbench
              ? cn(
                  workbenchSurfaceProps.className,
                  "honk-workbench-menu-popup t-tt relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) outline-none transition-[width,height,scale,opacity] [transition-duration:var(--tt-out-dur)] [transition-timing-function:var(--tt-out-ease)] data-ending-style:scale-(--tt-scale) data-starting-style:scale-(--tt-scale) data-ending-style:opacity-0 data-starting-style:opacity-0 data-starting-style:[transition-delay:var(--tt-delay)] data-starting-style:[transition-duration:var(--tt-in-dur)] data-starting-style:[transition-timing-function:var(--tt-in-ease)] data-instant:!transition-none data-instant:data-starting-style:opacity-100 data-instant:data-starting-style:scale-100 motion-reduce:transition-none",
                  honkMenuPickerShellClasses,
                )
              : "t-tt relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) text-balance rounded-md border bg-popover not-dark:bg-clip-padding text-popover-foreground text-detail shadow-md/5 transition-[width,height,scale,opacity] [transition-duration:var(--tt-out-dur)] [transition-timing-function:var(--tt-out-ease)] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-md)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-(--tt-scale) data-starting-style:scale-(--tt-scale) data-ending-style:opacity-0 data-starting-style:opacity-0 data-starting-style:[transition-delay:var(--tt-delay)] data-starting-style:[transition-duration:var(--tt-in-dur)] data-starting-style:[transition-timing-function:var(--tt-in-ease)] data-instant:duration-0 motion-reduce:transition-none dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            className,
          )}
          style={workbench ? workbenchSurfaceProps.style : undefined}
          data-slot="tooltip-popup"
          {...props}
        >
          <TooltipPrimitive.Viewport
            className={cn(
              "relative size-full overflow-clip px-(--viewport-inline-padding) py-1 [--viewport-inline-padding:--spacing(2)] data-instant:transition-none **:data-current:data-ending-style:opacity-0 **:data-current:data-starting-style:opacity-0 **:data-previous:data-ending-style:opacity-0 **:data-previous:data-starting-style:opacity-0 **:data-current:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:truncate **:data-current:opacity-100 **:data-previous:opacity-100 **:data-current:transition-opacity **:data-previous:transition-opacity",
              workbench && "font-honk",
            )}
            data-slot="tooltip-viewport"
          >
            {children}
          </TooltipPrimitive.Viewport>
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { TooltipCreateHandle, TooltipProvider, Tooltip, TooltipTrigger, TooltipPopup };
