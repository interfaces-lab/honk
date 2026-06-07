"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const cardVariants = cva(
  "relative min-w-0 overflow-hidden rounded-multi-card border font-multi text-body text-multi-fg-primary",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "border-multi-stroke-tertiary bg-multi-bg-elevated shadow-multi-card",
        flat: "border-multi-stroke-tertiary bg-transparent shadow-none",
        panel: "border-multi-workbench-panel-border-soft bg-multi-workbench-panel-background shadow-none",
      },
    },
  },
);

interface CardProps extends useRender.ComponentProps<"section"> {
  variant?: VariantProps<typeof cardVariants>["variant"];
}

function Card({ className, render, variant, ...props }: CardProps) {
  return useRender({
    defaultTagName: "section",
    props: mergeProps(
      {
        className: cn(cardVariants({ className, variant })),
        "data-slot": "card",
        "data-variant": variant ?? "default",
      },
      props,
    ),
    render,
  });
}

function CardHeader({ className, render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps(
      {
        className: cn("flex min-w-0 flex-col gap-1 px-4 pt-4", className),
        "data-slot": "card-header",
      },
      props,
    ),
    render,
  });
}

function CardBody({ className, render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps(
      {
        className: cn("min-w-0 px-4 py-4", className),
        "data-slot": "card-body",
      },
      props,
    ),
    render,
  });
}

function CardFooter({ className, render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps(
      {
        className: cn("flex min-w-0 items-center gap-2 px-4 pb-4", className),
        "data-slot": "card-footer",
      },
      props,
    ),
    render,
  });
}

export { Card, CardHeader, CardBody, CardFooter, cardVariants };
