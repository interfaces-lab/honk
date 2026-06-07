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

type TextElement = "span" | "p" | "div" | "label" | "h1" | "h2" | "h3";

type TextProps<Element extends TextElement = "span"> = useRender.ComponentProps<Element> & {
  as?: Element;
  size?: VariantProps<typeof textVariants>["size"];
  tone?: VariantProps<typeof textVariants>["tone"];
  weight?: VariantProps<typeof textVariants>["weight"];
  truncate?: VariantProps<typeof textVariants>["truncate"];
};

function Text<Element extends TextElement = "span">(props: TextProps<Element>) {
  const { as, className, render, size, tone, truncate, weight, ...textProps } = props;
  const defaultTagName = (as ?? "span") as Element;
  const defaultProps = {
    className: cn(textVariants({ className, size, tone, truncate, weight })),
    "data-slot": "text",
  };

  return useRender({
    defaultTagName,
    props: mergeProps(defaultProps, textProps),
    render,
  });
}

export { Text, textVariants };
