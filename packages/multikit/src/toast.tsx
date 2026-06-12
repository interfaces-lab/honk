"use client";

import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { Button } from "./button";
import { cn } from "./utils";

const Toast = ToastPrimitive;

const toastRootVariants = cva(
  "border border-honk-stroke-tertiary bg-honk-bg-elevated font-honk text-honk-fg-primary shadow-honk-popup backdrop-blur-xl",
  {
    defaultVariants: {
      chrome: "default",
    },
    variants: {
      chrome: {
        default: "rounded-[8px]",
        anchored:
          "relative rounded-[8px] text-balance text-xs transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none",
        tooltip:
          "relative rounded-[6px] text-balance text-xs transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none",
      },
    },
  },
);

const toastContentVariants = cva(
  "pointer-events-auto overflow-hidden text-honk-fg-primary transition-opacity duration-150 ease-out data-expanded:opacity-100 motion-reduce:transition-none",
  {
    defaultVariants: {
      layout: "default",
    },
    variants: {
      layout: {
        default: "flex items-center justify-between gap-1.5 px-3 py-2.5 text-body",
        tooltip: "px-2 py-1 text-detail",
      },
    },
  },
);

type ToastRootProps = ToastPrimitive.Root.Props & VariantProps<typeof toastRootVariants>;

function ToastRoot({ chrome, className, ...props }: ToastRootProps) {
  return (
    <ToastPrimitive.Root
      className={cn(toastRootVariants({ chrome }), className)}
      data-slot="toast-popup"
      {...props}
    />
  );
}

function ToastContent({
  className,
  layout,
  ...props
}: ToastPrimitive.Content.Props & VariantProps<typeof toastContentVariants>) {
  return (
    <ToastPrimitive.Content
      className={cn(toastContentVariants({ layout }), className)}
      data-slot="toast-content"
      {...props}
    />
  );
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      className={cn("min-w-0 wrap-break-word font-medium text-honk-fg-primary", className)}
      data-slot="toast-title"
      {...props}
    />
  );
}

function ToastDescription({ className, ...props }: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      className={cn("min-w-0 select-text wrap-break-word text-honk-fg-secondary", className)}
      data-slot="toast-description"
      {...props}
    />
  );
}

function ToastAction({
  className,
  render,
  ...props
}: ToastPrimitive.Action.Props & { className?: string | undefined }) {
  return (
    <ToastPrimitive.Action
      className={render ? className : undefined}
      data-slot="toast-action"
      render={
        render ?? <Button className={cn("shrink-0", className)} size="xs" variant="outline" />
      }
      {...props}
    />
  );
}

function ToastIconButton(props: ComponentProps<typeof Button>) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      {...props}
      className={cn(
        "shrink-0 rounded-sm text-honk-fg-tertiary opacity-70 hover:bg-honk-bg-quaternary hover:text-honk-fg-primary hover:opacity-100",
        props.className,
      )}
    />
  );
}

export {
  Toast,
  ToastRoot,
  ToastContent,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastIconButton,
  toastRootVariants,
  toastContentVariants,
};
