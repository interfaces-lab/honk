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
          "rounded-sm bg-honk-bg-tertiary px-1 py-0.5 font-honk-mono text-honk-code text-honk-fg-primary",
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
          "max-h-64 overflow-auto rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary p-3 font-honk-mono text-honk-code text-honk-fg-primary",
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
