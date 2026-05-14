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
          ? "font-multi flex min-h-6.5 w-full select-none items-center justify-start gap-1.5 rounded-multi-control border border-transparent px-2 py-1 text-left text-body font-normal text-muted-foreground transition-colors"
          : "group/agent-row font-multi relative flex h-auto min-h-0 w-full cursor-(--multi-button-cursor) select-none items-center justify-start gap-3 rounded-multi-control border border-transparent bg-transparent px-1.5 py-[5px] text-left text-body font-normal shadow-none outline-none ring-offset-0 transition-[background-color,color] duration-100 ease-out before:hidden hover:bg-multi-bg-quaternary data-[highlighted=true]:bg-[color-mix(in_srgb,var(--foreground)_14%,transparent)] data-[highlighted=true]:outline data-[highlighted=true]:outline-1 data-[highlighted=true]:-outline-offset-1 data-[highlighted=true]:outline-multi-stroke-focused data-[selected=true]:bg-multi-bg-tertiary focus-visible:ring-offset-0 motion-reduce:transition-none",
        className,
      )}
      {...rest}
    />
  );
}
