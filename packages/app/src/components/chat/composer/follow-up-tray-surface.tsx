import { type HTMLAttributes } from "react";

import { cn } from "~/lib/utils";

export function ComposerFollowUpTraySurface({
  children,
  className,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "pointer-events-auto min-w-0 overflow-hidden rounded-(--honk-composer-plan-tray-radius) bg-honk-bg-elevated font-honk text-honk-chrome text-honk-fg-primary shadow-honk-soft honk-glass-inset-ring",
        className,
      )}
      style={{ transformOrigin: "bottom left", ...style }}
    >
      {children}
    </div>
  );
}
