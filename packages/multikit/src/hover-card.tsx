"use client";

import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";

import { cn } from "./utils";

const HoverCardCreateHandle = PreviewCardPrimitive.createHandle;
const HoverCard = PreviewCardPrimitive.Root;

function HoverCardTrigger({ className, ...props }: PreviewCardPrimitive.Trigger.Props) {
  return (
    <PreviewCardPrimitive.Trigger
      className={className}
      data-slot="hover-card-trigger"
      {...props}
    />
  );
}

function HoverCardPopup({
  align = "center",
  alignOffset,
  anchor,
  children,
  className,
  collisionAvoidance,
  collisionBoundary,
  collisionPadding,
  positionMethod,
  side = "bottom",
  sideOffset = 6,
  sticky,
  ...props
}: PreviewCardPrimitive.Popup.Props & {
  align?: PreviewCardPrimitive.Positioner.Props["align"];
  alignOffset?: PreviewCardPrimitive.Positioner.Props["alignOffset"];
  anchor?: PreviewCardPrimitive.Positioner.Props["anchor"];
  collisionAvoidance?: PreviewCardPrimitive.Positioner.Props["collisionAvoidance"];
  collisionBoundary?: PreviewCardPrimitive.Positioner.Props["collisionBoundary"];
  collisionPadding?: PreviewCardPrimitive.Positioner.Props["collisionPadding"];
  positionMethod?: PreviewCardPrimitive.Positioner.Props["positionMethod"];
  side?: PreviewCardPrimitive.Positioner.Props["side"];
  sideOffset?: PreviewCardPrimitive.Positioner.Props["sideOffset"];
  sticky?: PreviewCardPrimitive.Positioner.Props["sticky"];
}) {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        collisionAvoidance={collisionAvoidance}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        positionMethod={positionMethod}
        sticky={sticky}
        className="z-50 max-w-(--available-width)"
        data-slot="hover-card-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <PreviewCardPrimitive.Popup
          className={cn(
            "relative min-w-56 max-w-80 origin-(--transform-origin) overflow-hidden rounded-[8px] border border-multi-stroke-tertiary bg-multi-bg-elevated font-multi text-body text-multi-fg-primary shadow-multi-popup outline-none backdrop-blur-xl transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none",
            className,
          )}
          data-slot="hover-card-popup"
          {...props}
        >
          <PreviewCardPrimitive.Viewport
            className="relative size-full max-h-(--available-height) overflow-y-auto p-3"
            data-slot="hover-card-viewport"
          >
            {children}
          </PreviewCardPrimitive.Viewport>
        </PreviewCardPrimitive.Popup>
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}

export { HoverCardCreateHandle, HoverCard, HoverCardTrigger, HoverCardPopup };
