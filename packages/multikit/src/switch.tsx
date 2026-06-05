"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn, controlTransitionClassName } from "./utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 cursor-pointer items-center rounded-full p-px outline-none transition-[background-color,box-shadow] [--thumb-size:--spacing(5)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input data-disabled:cursor-not-allowed data-disabled:opacity-64 sm:[--thumb-size:--spacing(4)]",
        controlTransitionClassName,
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block aspect-square h-full origin-left in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:not-data-disabled:scale-x-110 in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.1)] rounded-(--thumb-size) bg-background shadow-sm/5 will-change-transform [transition:translate_150ms_ease-out,border-radius_150ms_ease-out,scale_150ms_ease-out,transform-origin_150ms_ease-out] data-checked:origin-(--thumb-size_50%) data-checked:translate-x-[calc(var(--thumb-size)-4px)] motion-reduce:transition-none",
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
