import { cn } from "../../lib/classes";

import { audienceWords } from "./audience-copy";

const railTextClassName =
  "font-sans text-[clamp(1.25rem,2vw,1.75rem)] uppercase leading-none tracking-[-0.03em]";

const railItems = ["FOR", ...audienceWords, "YOU"] as const;

export function AudienceRail({ className }: { className?: string }) {
  return (
    <aside
      aria-label="For designers, developers, builders, teams, and everyone shipping with AI"
      className={cn("flex flex-col justify-between", className)}
    >
      {railItems.map((word) => (
        <span
          key={word}
          className={cn(
            railTextClassName,
            word === "FOR" || word === "YOU"
              ? "font-semibold text-primary"
              : word === "..."
                ? "font-normal text-faint"
                : "font-normal text-muted",
          )}
        >
          {word}
        </span>
      ))}
    </aside>
  );
}
