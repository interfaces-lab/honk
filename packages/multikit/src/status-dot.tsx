"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const statusDotVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center after:block after:size-(--multi-status-dot-size,5.5px) after:rounded-full after:content-['']",
  {
    defaultVariants: {
      state: "draft",
    },
    variants: {
      state: {
        draft: "after:border after:border-multi-icon-quaternary after:bg-transparent",
        running: "after:bg-multi-icon-tertiary",
        needsAttention: "after:bg-warning",
        doneUnseen: "after:bg-multi-icon-accent-primary",
        doneSeen: "after:bg-multi-icon-quaternary",
        /** Positive health / authenticated / ready indicators (e.g. provider status). */
        success: "after:bg-success",
        /** Hard failure (e.g. provider error). */
        critical: "after:bg-destructive",
        /** Disabled or blocked without being an error (e.g. provider off). */
        inactive: "after:bg-amber-400",
      },
    },
  },
);

interface StatusDotProps extends useRender.ComponentProps<"span"> {
  state?: VariantProps<typeof statusDotVariants>["state"];
}

function StatusDot({ className, state, render, ...props }: StatusDotProps) {
  const defaultProps = {
    className: cn(statusDotVariants({ className, state })),
    "data-slot": "status-dot",
    "data-state": state ?? "draft",
    role: "status",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}

export { StatusDot, statusDotVariants };
