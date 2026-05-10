"use client";

import type { ComponentPropsWithoutRef } from "react";

import { usePretextOneLine } from "~/hooks/use-composer-pretext-one-line";
import { cn } from "~/lib/utils";

type PretextOneLineProps = Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  text: string;
  fontPx?: number;
  lineHeightPx?: number;
  truncate?: "end" | "middle";
};

export function PretextOneLine({
  text,
  className,
  title,
  fontPx,
  lineHeightPx,
  truncate,
  ...spanProps
}: PretextOneLineProps) {
  const { ref, shown, fallback } = usePretextOneLine({
    text,
    ...(fontPx !== undefined ? { fontPx } : {}),
    ...(lineHeightPx !== undefined ? { lineHeightPx } : {}),
    ...(truncate !== undefined ? { truncate } : {}),
  });

  return (
    <span
      {...spanProps}
      ref={ref}
      title={title ?? text}
      className={cn(
        "block min-w-0 overflow-hidden whitespace-nowrap",
        className,
        fallback && "truncate",
      )}
    >
      {shown}
    </span>
  );
}
