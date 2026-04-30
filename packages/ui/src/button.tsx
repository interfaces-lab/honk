"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "./utils";

const buttonVariants = cva(
  "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-multi-control border font-multi text-[12px]/[16px] font-medium outline-none transition-colors before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--multi-radius-control)-1px)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-7 px-[calc(--spacing(2.5)-1px)]",
        icon: "size-7",
        "icon-lg": "size-8",
        "icon-sm": "size-6",
        "icon-xl": "size-9 [&_svg:not([class*='size-'])]:size-4.5",
        "icon-xs":
          "size-5.5 rounded-sm before:rounded-[calc(var(--radius-sm)-1px)] not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-8 px-[calc(--spacing(3)-1px)]",
        sm: "h-6 gap-1 px-[calc(--spacing(2)-1px)]",
        xl: "h-9 px-[calc(--spacing(3.5)-1px)] text-[13px]/[18px] [&_svg:not([class*='size-'])]:size-4.5",
        xs: "h-5.5 gap-1 rounded-sm px-[calc(--spacing(1.5)-1px)] text-[11px]/[14px] before:rounded-[calc(var(--radius-sm)-1px)] [&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground shadow-primary/16 shadow-xs [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-primary/90",
        destructive:
          "border-destructive bg-destructive text-white shadow-destructive/16 shadow-xs [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-destructive/90",
        "destructive-outline":
          "border-input bg-popover text-destructive-foreground shadow-xs/5 dark:bg-input/32 [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:border-destructive/32 [:hover,[data-pressed]]:bg-destructive/4",
        ghost:
          "border-transparent bg-transparent text-foreground data-pressed:bg-multi-hover [:hover,[data-pressed]]:bg-multi-hover",
        link: "border-transparent underline-offset-4 [:hover,[data-pressed]]:underline",
        outline:
          "border-input bg-popover text-foreground shadow-xs/5 dark:bg-input/32 [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-multi-hover",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [:active,[data-pressed]]:bg-secondary/80 [:hover,[data-pressed]]:bg-multi-hover",
      },
    },
  },
);

interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
}

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    "data-slot": "button",
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

export { Button, buttonVariants };
