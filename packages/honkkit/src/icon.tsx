"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const iconVariants = cva(
  "inline-flex shrink-0 items-center justify-center text-current [&_svg]:block [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      tone: "current",
    },
    variants: {
      size: {
        default: "size-4 [&_svg:not([class*='size-'])]:size-4",
        lg: "size-4.5 [&_svg:not([class*='size-'])]:size-4.5",
        sm: "size-3.5 [&_svg:not([class*='size-'])]:size-3.5",
        xl: "size-5 [&_svg:not([class*='size-'])]:size-5",
        xs: "size-3 [&_svg:not([class*='size-'])]:size-3",
      },
      tone: {
        accent: "text-honk-icon-accent-primary",
        current: "text-current",
        primary: "text-honk-icon-primary",
        quaternary: "text-honk-icon-quaternary",
        secondary: "text-honk-icon-secondary",
        tertiary: "text-honk-icon-tertiary",
        warning: "text-honk-icon-warning",
      },
    },
  },
);

interface IconProps extends useRender.ComponentProps<"span"> {
  size?: VariantProps<typeof iconVariants>["size"];
  tone?: VariantProps<typeof iconVariants>["tone"];
}

function Icon({ className, render, size, tone, ...props }: IconProps) {
  const defaultProps = {
    className: cn(iconVariants({ className, size, tone })),
    "data-size": size ?? "default",
    "data-slot": "icon",
    "data-tone": tone ?? "current",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}

export { Icon, iconVariants };
