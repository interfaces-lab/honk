"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { type ComponentProps } from "react";

import { cn } from "./utils";

const inlineChipVariants = cva(
  "inline-flex max-w-full select-none items-center gap-1 rounded-sm border px-1.5 py-px font-honk text-body font-medium align-middle [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:shrink-0",
  {
    defaultVariants: {
      tone: "default",
    },
    variants: {
      tone: {
        default: "border-honk-stroke-tertiary bg-honk-bg-quaternary text-honk-fg-primary",
        destructive: "border-destructive/35 bg-destructive/8 text-destructive",
        link: "border-honk-stroke-tertiary bg-honk-bg-quaternary text-honk-fg-accent-primary",
      },
    },
  },
);

interface InlineChipProps extends ComponentProps<"span">, VariantProps<typeof inlineChipVariants> {}

function InlineChip({ className, tone, ...props }: InlineChipProps) {
  return (
    <span
      className={cn(inlineChipVariants({ className, tone }))}
      data-slot="inline-chip"
      {...props}
    />
  );
}

function InlineChipIcon({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center opacity-85",
        className,
      )}
      data-slot="inline-chip-icon"
      {...props}
    />
  );
}

function InlineChipLabel({ className, ...props }: ComponentProps<"span">) {
  return (
    <span className={cn("min-w-0 truncate", className)} data-slot="inline-chip-label" {...props} />
  );
}

function InlineChipDetail({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("min-w-0 truncate text-honk-fg-tertiary", className)}
      data-slot="inline-chip-detail"
      {...props}
    />
  );
}

export { InlineChip, InlineChipDetail, InlineChipIcon, InlineChipLabel, inlineChipVariants };
