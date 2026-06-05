"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const textVariants = cva("font-multi", {
  defaultVariants: {
    size: "base",
    tone: "primary",
    weight: "regular",
  },
  variants: {
    size: {
      xs: "text-multi-xs",
      sm: "text-multi-sm",
      base: "text-multi-base",
      lg: "text-multi-lg",
      xl: "text-multi-xl",
    },
    tone: {
      primary: "text-multi-fg-primary",
      secondary: "text-multi-fg-secondary",
      tertiary: "text-multi-fg-tertiary",
      quaternary: "text-multi-fg-quaternary",
      inherit: "",
    },
    weight: {
      regular: "font-normal",
      medium: "font-medium",
      semibold: "font-semibold",
    },
    truncate: {
      true: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
    },
  },
});

interface TextProps extends useRender.ComponentProps<"span"> {
  size?: VariantProps<typeof textVariants>["size"];
  tone?: VariantProps<typeof textVariants>["tone"];
  weight?: VariantProps<typeof textVariants>["weight"];
  truncate?: VariantProps<typeof textVariants>["truncate"];
}

function Text({ className, size, tone, weight, truncate, render, ...props }: TextProps) {
  const defaultProps = {
    className: cn(textVariants({ className, size, tone, truncate, weight })),
    "data-slot": "text",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}

export { Text, textVariants };
