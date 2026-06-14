"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn, controlTransitionVariants } from "./utils";

const linkVariants = cva(
  cn(
    "font-medium outline-none underline-offset-4 transition-colors focus-visible:ring-1 focus-visible:ring-honk-stroke-focused",
    controlTransitionVariants(),
  ),
  {
    defaultVariants: {
      tone: "primary",
    },
    variants: {
      tone: {
        primary: "text-primary hover:text-primary/86",
        muted: "text-honk-fg-secondary hover:text-honk-fg-primary",
        inherit: "text-inherit hover:underline",
      },
    },
  },
);

interface LinkProps extends useRender.ComponentProps<"a"> {
  tone?: VariantProps<typeof linkVariants>["tone"];
}

function Link({ className, render, tone, ...props }: LinkProps) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps(
      {
        className: cn(linkVariants({ className, tone })),
        "data-slot": "link",
      },
      props,
    ),
    render,
  });
}

export { Link, linkVariants };
