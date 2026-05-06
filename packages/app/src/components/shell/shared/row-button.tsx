import type { ComponentProps } from "react";

import { Button } from "@multi/ui/button";
import { cn } from "~/lib/utils";

type RowProps = Omit<ComponentProps<typeof Button>, "type" | "variant">;

/** Sidebar rows: `chrome` matches the New Chat label style; `agent` uses the list type scale. */
export function RowButton(
  props: RowProps & {
    variant: "chrome" | "agent";
  },
) {
  const { variant, className, ...rest } = props;
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        variant === "chrome"
          ? "font-multi flex min-h-6.5 w-full select-none items-center justify-start gap-1.5 rounded-multi-control border border-transparent px-2 py-1 text-left text-[12px]/[16px] font-normal text-muted-foreground transition-colors"
          : "multi-agent-sidebar-cell agent-sidebar-cell font-multi flex h-auto min-h-0 w-full select-none gap-3 items-center justify-start rounded-[6px] border border-transparent bg-transparent px-0 py-0 text-left text-[12px]/[16px] font-normal shadow-none outline-none ring-offset-0 transition-[color] duration-100 ease-out before:hidden focus-visible:ring-offset-0 motion-reduce:transition-none",
        className,
      )}
      {...rest}
    />
  );
}
