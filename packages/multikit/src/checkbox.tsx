"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { IconCheckmark1, IconMinusSmall } from "central-icons";

import { cn, controlTransitionClassName, interactiveControlCursorClassName } from "./utils";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "relative inline-flex size-4.5 shrink-0 items-center justify-center rounded-multi-control border border-multi-stroke-tertiary bg-multi-bg-quinary text-primary-foreground outline-none transition-[background-color,border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:border-primary data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-64 data-indeterminate:border-primary data-indeterminate:bg-primary aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/24 sm:size-4",
        interactiveControlCursorClassName,
        controlTransitionClassName,
        className,
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="flex items-center justify-center data-unchecked:hidden [&_svg]:size-3"
        data-slot="checkbox-indicator"
        keepMounted
      >
        <IconCheckmark1 className="data-indeterminate:hidden" />
        <IconMinusSmall className="not-data-indeterminate:hidden" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
