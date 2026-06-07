"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "./utils";

function Code({ className, render, ...props }: useRender.ComponentProps<"code">) {
  return useRender({
    defaultTagName: "code",
    props: mergeProps(
      {
        className: cn(
          "rounded-sm bg-multi-bg-tertiary px-1 py-0.5 font-multi-mono text-multi-code text-multi-fg-primary",
          className,
        ),
        "data-slot": "code",
      },
      props,
    ),
    render,
  });
}

function Pre({ className, render, ...props }: useRender.ComponentProps<"pre">) {
  return useRender({
    defaultTagName: "pre",
    props: mergeProps(
      {
        className: cn(
          "max-h-64 overflow-auto rounded-multi-control border border-multi-stroke-tertiary bg-multi-bg-quinary p-3 font-multi-mono text-multi-code text-multi-fg-primary",
          className,
        ),
        "data-slot": "pre",
      },
      props,
    ),
    render,
  });
}

export { Code, Pre };
