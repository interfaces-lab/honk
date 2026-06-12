"use client";

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";

import { cn } from "./utils";

function ScrollArea({
  className,
  children,
  scrollFade = false,
  scrollbarGutter = false,
  hideScrollbars = false,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  scrollFade?: boolean;
  scrollbarGutter?: boolean;
  hideScrollbars?: boolean;
}) {
  return (
    <ScrollAreaPrimitive.Root
      className={cn("ui-scroll-area size-full min-h-0 min-w-0", className)}
      data-slot="scroll-area"
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        className={cn(
          "h-full rounded-[inherit] outline-none overscroll-contain transition-[box-shadow,mask-image] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-has-overflow-x:overscroll-x-contain",
          scrollFade &&
            "mask-t-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-start)))] mask-b-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-end)))] mask-l-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-start)))] mask-r-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-end)))] [--fade-size:1.5rem]",
          scrollbarGutter && "data-has-overflow-y:pe-3 data-has-overflow-x:pb-3",
          hideScrollbars &&
            "[-ms-overflow-style:none] scrollbar-none [&::-webkit-scrollbar]:hidden",
        )}
        data-slot="scroll-area-viewport"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {!hideScrollbars && (
        <>
          <ScrollBar orientation="vertical" />
          <ScrollBar orientation="horizontal" />
          <ScrollAreaPrimitive.Corner data-slot="scroll-area-corner" />
        </>
      )}
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      className={cn(
        "m-1 flex touch-none opacity-0 transition-opacity delay-300 data-[orientation=horizontal]:h-2 data-[orientation=vertical]:w-2 data-[orientation=horizontal]:flex-col data-hovering:opacity-100 data-scrolling:opacity-100 data-hovering:delay-0 data-scrolling:delay-0 data-hovering:duration-100 data-scrolling:duration-100",
        className,
      )}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        className="relative m-0.5 flex-1 rounded-full bg-foreground/20 transition-colors data-hovering:bg-foreground/30 data-scrolling:bg-foreground/35"
        data-slot="scroll-area-thumb"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
