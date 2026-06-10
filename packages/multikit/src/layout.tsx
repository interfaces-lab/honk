"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const gapVariants = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-1.5",
  md: "gap-2",
  lg: "gap-3",
  xl: "gap-4",
} as const;

const stackVariants = cva("flex min-w-0 flex-col", {
  defaultVariants: {
    align: "stretch",
    gap: "md",
    justify: "start",
  },
  variants: {
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
    },
    gap: gapVariants,
    justify: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
    },
  },
});

const rowVariants = cva("flex min-w-0 flex-row", {
  defaultVariants: {
    align: "center",
    gap: "md",
    justify: "start",
    wrap: false,
  },
  variants: {
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
    },
    gap: gapVariants,
    justify: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
    },
    wrap: {
      false: "flex-nowrap",
      true: "flex-wrap",
    },
  },
});

const gridVariants = cva("grid min-w-0", {
  defaultVariants: {
    columns: "auto",
    gap: "md",
  },
  variants: {
    columns: {
      "1": "grid-cols-1",
      "2": "grid-cols-2",
      "3": "grid-cols-3",
      "4": "grid-cols-4",
      auto: "grid-cols-[repeat(auto-fit,minmax(min(12rem,100%),1fr))]",
    },
    gap: gapVariants,
  },
});

const spacerVariants = cva("shrink-0", {
  defaultVariants: {
    orientation: "vertical",
    size: "md",
  },
  variants: {
    orientation: {
      horizontal: "",
      vertical: "",
    },
    size: {
      none: "",
      xs: "",
      sm: "",
      md: "",
      lg: "",
      xl: "",
    },
  },
  compoundVariants: [
    { orientation: "vertical", size: "none", className: "h-0" },
    { orientation: "vertical", size: "xs", className: "h-1" },
    { orientation: "vertical", size: "sm", className: "h-2" },
    { orientation: "vertical", size: "md", className: "h-3" },
    { orientation: "vertical", size: "lg", className: "h-4" },
    { orientation: "vertical", size: "xl", className: "h-6" },
    { orientation: "horizontal", size: "none", className: "w-0" },
    { orientation: "horizontal", size: "xs", className: "w-1" },
    { orientation: "horizontal", size: "sm", className: "w-2" },
    { orientation: "horizontal", size: "md", className: "w-3" },
    { orientation: "horizontal", size: "lg", className: "w-4" },
    { orientation: "horizontal", size: "xl", className: "w-6" },
  ],
});

interface StackProps extends useRender.ComponentProps<"div">, VariantProps<typeof stackVariants> {}

function Stack({ align, className, gap, justify, render, ...props }: StackProps) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps(
      {
        className: cn(stackVariants({ align, gap, justify }), className),
        "data-align": align ?? "stretch",
        "data-gap": gap ?? "md",
        "data-justify": justify ?? "start",
        "data-slot": "stack",
      },
      props,
    ),
    render,
  });
}

interface RowProps extends useRender.ComponentProps<"div">, VariantProps<typeof rowVariants> {}

function Row({ align, className, gap, justify, render, wrap, ...props }: RowProps) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps(
      {
        className: cn(rowVariants({ align, gap, justify, wrap }), className),
        "data-align": align ?? "center",
        "data-gap": gap ?? "md",
        "data-justify": justify ?? "start",
        "data-slot": "row",
        "data-wrap": wrap ? "true" : "false",
      },
      props,
    ),
    render,
  });
}

interface GridProps extends useRender.ComponentProps<"div">, VariantProps<typeof gridVariants> {}

function Grid({ className, columns, gap, render, ...props }: GridProps) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps(
      {
        className: cn(gridVariants({ columns, gap }), className),
        "data-columns": columns ?? "auto",
        "data-gap": gap ?? "md",
        "data-slot": "grid",
      },
      props,
    ),
    render,
  });
}

interface SpacerProps
  extends useRender.ComponentProps<"div">, VariantProps<typeof spacerVariants> {}

function Spacer({ className, orientation, render, size, ...props }: SpacerProps) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps(
      {
        "aria-hidden": true,
        className: cn(spacerVariants({ orientation, size }), className),
        "data-orientation": orientation ?? "vertical",
        "data-size": size ?? "md",
        "data-slot": "spacer",
      },
      props,
    ),
    render,
  });
}

export { Grid, Row, Spacer, Stack, gridVariants, rowVariants, spacerVariants, stackVariants };
