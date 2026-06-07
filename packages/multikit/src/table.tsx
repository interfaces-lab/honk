"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "./utils";

function Table({ className, render, ...props }: useRender.ComponentProps<"table">) {
  return useRender({
    defaultTagName: "table",
    props: mergeProps(
      {
        className: cn("w-full caption-bottom border-collapse text-body", className),
        "data-slot": "table",
      },
      props,
    ),
    render,
  });
}

function TableHeader({ className, render, ...props }: useRender.ComponentProps<"thead">) {
  return useRender({
    defaultTagName: "thead",
    props: mergeProps(
      {
        className: cn("border-b border-multi-stroke-tertiary", className),
        "data-slot": "table-header",
      },
      props,
    ),
    render,
  });
}

function TableBody({ className, render, ...props }: useRender.ComponentProps<"tbody">) {
  return useRender({
    defaultTagName: "tbody",
    props: mergeProps(
      {
        className: cn("[&_tr:last-child]:border-0", className),
        "data-slot": "table-body",
      },
      props,
    ),
    render,
  });
}

function TableRow({ className, render, ...props }: useRender.ComponentProps<"tr">) {
  return useRender({
    defaultTagName: "tr",
    props: mergeProps(
      {
        className: cn("border-b border-multi-stroke-quaternary", className),
        "data-slot": "table-row",
      },
      props,
    ),
    render,
  });
}

function TableHead({ className, render, ...props }: useRender.ComponentProps<"th">) {
  return useRender({
    defaultTagName: "th",
    props: mergeProps(
      {
        className: cn("px-2 py-1.5 text-left font-medium text-multi-fg-tertiary", className),
        "data-slot": "table-head",
      },
      props,
    ),
    render,
  });
}

function TableCell({ className, render, ...props }: useRender.ComponentProps<"td">) {
  return useRender({
    defaultTagName: "td",
    props: mergeProps(
      {
        className: cn("px-2 py-1.5 text-multi-fg-primary", className),
        "data-slot": "table-cell",
      },
      props,
    ),
    render,
  });
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
