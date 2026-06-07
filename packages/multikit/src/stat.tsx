"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "./utils";

function Stat({ className, render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps(
      {
        className: cn("flex min-w-0 flex-col gap-1", className),
        "data-slot": "stat",
      },
      props,
    ),
    render,
  });
}

function StatLabel({ className, render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps(
      {
        className: cn("text-detail text-multi-fg-tertiary", className),
        "data-slot": "stat-label",
      },
      props,
    ),
    render,
  });
}

function StatValue({ className, render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps(
      {
        className: cn("text-title font-medium text-multi-fg-primary", className),
        "data-slot": "stat-value",
      },
      props,
    ),
    render,
  });
}

export { Stat, StatLabel, StatValue };
