"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "./utils";

const PopoverCreateHandle = PopoverPrimitive.createHandle;

const Popover = PopoverPrimitive.Root;

/**
 * For custom triggers (e.g. `Button`), pass `render={<Button … />}` and put the
 * visible control in `children`. See https://base-ui.com/react/handbook/composition
 */
function PopoverTrigger({ className, children, ...props }: PopoverPrimitive.Trigger.Props) {
  return (
    <PopoverPrimitive.Trigger className={className} data-slot="popover-trigger" {...props}>
      {children}
    </PopoverPrimitive.Trigger>
  );
}

function PopoverPopup({
  children,
  className,
  variant = "default",
  instant = false,
  side = "bottom",
  align = "center",
  sideOffset = 4,
  alignOffset = 0,
  tooltipStyle = false,
  anchor,
  collisionAvoidance,
  collisionBoundary,
  collisionPadding,
  positionerClassName,
  positionMethod,
  sticky,
  ...props
}: PopoverPrimitive.Popup.Props & {
  /** `workbench` = elevated honk-token shell (formerly Cursor slash-menu chrome). */
  variant?: "default" | "workbench";
  /** Skip position/size transition animations (reduces jitter for dynamic menus). */
  instant?: boolean;
  side?: PopoverPrimitive.Positioner.Props["side"];
  align?: PopoverPrimitive.Positioner.Props["align"];
  sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: PopoverPrimitive.Positioner.Props["alignOffset"];
  tooltipStyle?: boolean;
  anchor?: PopoverPrimitive.Positioner.Props["anchor"];
  collisionAvoidance?: PopoverPrimitive.Positioner.Props["collisionAvoidance"];
  collisionBoundary?: PopoverPrimitive.Positioner.Props["collisionBoundary"];
  collisionPadding?: PopoverPrimitive.Positioner.Props["collisionPadding"];
  positionerClassName?: string | undefined;
  positionMethod?: PopoverPrimitive.Positioner.Props["positionMethod"];
  sticky?: PopoverPrimitive.Positioner.Props["sticky"];
}) {
  const positionerLayerClassName =
    variant === "workbench" ? "z-(--z-index-workbench-popover)" : "z-(--z-index-popover)";

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        collisionAvoidance={collisionAvoidance}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        positionMethod={positionMethod}
        sticky={sticky}
        className={cn(
          positionerLayerClassName,
          "h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none",
          instant && "data-instant",
          positionerClassName,
        )}
        data-slot="popover-positioner"
        side={side}
        sideOffset={sideOffset}
        {...(instant ? ({ "data-instant": "" } as const) : {})}
      >
        <PopoverPrimitive.Popup
          className={cn(
            variant === "workbench"
              ? "honk-slash-menu-popup relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) overflow-hidden rounded-[12px] border border-honk-stroke-tertiary bg-honk-bg-elevated font-honk text-body text-honk-fg-primary shadow-honk-popup outline-none backdrop-blur-xl transition-[width,height,scale,opacity] data-starting-style:scale-98 data-starting-style:opacity-0 data-instant:!transition-none data-instant:data-starting-style:opacity-100 data-instant:data-starting-style:scale-100"
              : "relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) rounded-lg border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 outline-none transition-[width,height,scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] has-data-[slot=calendar]:rounded-xl has-data-[slot=calendar]:before:rounded-[calc(var(--radius-xl)-1px)] data-starting-style:scale-98 data-starting-style:opacity-0 data-instant:!transition-none data-instant:data-starting-style:opacity-100 data-instant:data-starting-style:scale-100 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            tooltipStyle &&
              "w-fit text-balance rounded-md text-xs shadow-md/5 before:rounded-[calc(var(--radius-md)-1px)]",
            className,
          )}
          data-slot="popover-popup"
          {...props}
          {...(instant ? ({ "data-instant": "" } as const) : {})}
        >
          <PopoverPrimitive.Viewport
            className={cn(
              variant === "workbench"
                ? "relative size-full max-h-(--available-height) overflow-y-auto p-1 data-instant:transition-none"
                : instant
                  ? "relative size-full max-h-(--available-height) overflow-y-auto py-0"
                  : "relative size-full max-h-(--available-height) overflow-clip px-(--viewport-inline-padding) py-4 [--viewport-inline-padding:--spacing(4)] has-data-[slot=calendar]:p-2 data-instant:transition-none **:data-current:data-ending-style:opacity-0 **:data-current:data-starting-style:opacity-0 **:data-previous:data-ending-style:opacity-0 **:data-previous:data-starting-style:opacity-0 **:data-current:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-current:opacity-100 **:data-previous:opacity-100 **:data-current:transition-opacity **:data-previous:transition-opacity",
              tooltipStyle
                ? "py-1 [--viewport-inline-padding:--spacing(2)]"
                : !instant && variant !== "workbench" && "not-data-transitioning:overflow-y-auto",
            )}
            data-slot="popover-viewport"
          >
            {children}
          </PopoverPrimitive.Viewport>
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      className={cn("font-semibold text-lg leading-none", className)}
      data-slot="popover-title"
      {...props}
    />
  );
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="popover-description"
      {...props}
    />
  );
}

export {
  PopoverCreateHandle,
  Popover,
  PopoverTrigger,
  PopoverPopup,
  PopoverPopup as PopoverContent,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
};
