"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn, controlTransitionVariants, interactiveControlCursorVariants } from "./utils";

const buttonVariants = cva(
  cn(
    "relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-honk-control border font-honk outline-none transition-colors before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--honk-radius-control)-1px)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    interactiveControlCursorVariants(),
    controlTransitionVariants(),
  ),
  {
    defaultVariants: {
      size: "default",
      typography: "body",
      variant: "default",
    },
    variants: {
      typography: {
        body: "text-body font-medium",
        caption: "text-caption font-normal",
        detail: "text-detail font-normal",
        inherit: "font-normal",
        sidebar: "text-sidebar-label font-normal",
        title: "text-title font-medium",
      },
      size: {
        default: "h-6 px-2.5",
        icon: "size-5 [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "size-6",
        "icon-sm": "size-4",
        "icon-xl": "size-7 [&_svg:not([class*='size-'])]:size-4",
        "icon-xs":
          "size-3.5 rounded-sm before:rounded-[calc(var(--radius-sm)-1px)] not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-7 px-3",
        sm: "h-5 gap-1 px-2",
        xl: "h-8 px-3.5 text-title [&_svg:not([class*='size-'])]:size-4",
        xs: "h-4 gap-1 rounded-sm px-1.5 text-detail before:rounded-[calc(var(--radius-sm)-1px)] [&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        /** Filled accent (workbench primary control). */
        default:
          "border-transparent bg-primary text-primary-foreground shadow-none hover:bg-primary/90 data-pressed:bg-primary/90",
        destructive:
          "border-destructive bg-destructive text-white shadow-destructive/16 shadow-xs [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-destructive/90",
        "destructive-outline":
          "border-input bg-popover text-destructive-foreground shadow-xs/5 dark:bg-input/32 [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:border-destructive/32 [:hover,[data-pressed]]:bg-destructive/4",
        /** Transparent hit target (workbench tertiary / ghost control). */
        ghost:
          "border-transparent bg-transparent text-honk-fg-secondary shadow-none hover:bg-honk-bg-quaternary hover:text-honk-fg-primary data-pressed:bg-honk-bg-tertiary",
        link: "border-transparent underline-offset-4 [:hover,[data-pressed]]:underline",
        /** Secondary bordered surface (workbench outline control). */
        outline:
          "border-honk-stroke-tertiary bg-honk-bg-quinary text-honk-fg-secondary shadow-none hover:border-honk-stroke-secondary hover:bg-honk-bg-quaternary hover:text-honk-fg-primary data-pressed:bg-honk-bg-tertiary",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [:active,[data-pressed]]:bg-secondary/80 [:hover,[data-pressed]]:bg-honk-hover",
      },
    },
  },
);

interface ButtonProps extends ButtonPrimitive.Props {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  typography?: VariantProps<typeof buttonVariants>["typography"];
}

const iconButtonSizes = new Set<ButtonProps["size"]>([
  "icon",
  "icon-lg",
  "icon-sm",
  "icon-xl",
  "icon-xs",
]);

const warnedIconButtons = new Set<string>();

function warnIfMissingIconButtonName({
  ariaLabel,
  ariaLabelledBy,
  className,
  size,
  title,
}: {
  ariaLabel?: ButtonProps["aria-label"];
  ariaLabelledBy?: ButtonProps["aria-labelledby"];
  className?: ButtonProps["className"];
  size?: ButtonProps["size"];
  title?: ButtonProps["title"];
}) {
  if (!iconButtonSizes.has(size)) return;
  if (ariaLabel || ariaLabelledBy || title) return;

  const warningKey = `${size}:${typeof className === "function" ? "classNameFn" : (className ?? "")}`;
  if (warnedIconButtons.has(warningKey)) return;
  warnedIconButtons.add(warningKey);

  console.warn(
    "HonkKit Button with an icon-only size needs aria-label, aria-labelledby, or title.",
  );
}

function Button({ className, variant, size, typography, render, type, ...props }: ButtonProps) {
  warnIfMissingIconButtonName({
    ariaLabel: props["aria-label"],
    ariaLabelledBy: props["aria-labelledby"],
    className,
    size,
    title: props.title,
  });

  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] =
    type ?? (render ? undefined : "button");
  const baseClassName = buttonVariants({ size, typography, variant });
  const resolvedClassName: ButtonPrimitive.Props["className"] =
    typeof className === "function"
      ? (state) => cn(baseClassName, className(state))
      : cn(baseClassName, className);

  return (
    <ButtonPrimitive
      className={resolvedClassName}
      data-size={size ?? "default"}
      data-slot="button"
      data-variant={variant ?? "default"}
      render={render}
      type={typeValue}
      {...props}
    />
  );
}

export { Button, buttonVariants };
