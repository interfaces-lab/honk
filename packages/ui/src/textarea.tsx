"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { mergeProps } from "@base-ui/react/merge-props";
import type * as React from "react";

import { cn } from "./utils";

type TextareaProps = React.ComponentProps<"textarea"> & {
  size?: "sm" | "default" | "lg" | number;
  unstyled?: boolean;
};

function Textarea({ className, size = "default", unstyled = false, ...props }: TextareaProps) {
  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-flex w-full rounded-multi-control border border-multi-stroke-tertiary bg-multi-bg-quinary text-multi-fg-primary shadow-none transition-colors has-focus-visible:border-multi-stroke-focused has-focus-visible:ring-1 has-focus-visible:ring-multi-stroke-focused/30 has-focus-visible:has-aria-invalid:border-multi-stroke-red-primary has-focus-visible:has-aria-invalid:ring-multi-stroke-red-primary/20 has-aria-invalid:border-multi-stroke-red-primary has-disabled:opacity-64",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="textarea-control"
    >
      <FieldPrimitive.Control
        render={(defaultProps) => (
          <textarea
            className={cn(
              "field-sizing-content min-h-17.5 w-full rounded-[inherit] px-1.5 py-1 font-multi text-body outline-none max-sm:min-h-20.5",
              size === "sm" && "min-h-16.5 px-1.5 py-1 max-sm:min-h-19.5",
              size === "lg" && "min-h-18.5 py-1.5 max-sm:min-h-21.5",
            )}
            data-slot="textarea"
            {...mergeProps(defaultProps, props)}
          />
        )}
      />
    </span>
  );
}

export { Textarea, type TextareaProps };
