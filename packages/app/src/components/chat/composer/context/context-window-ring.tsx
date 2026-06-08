import { cn } from "~/lib/utils";
import {
  type ContextWindowSnapshot,
  formatContextUsagePercentage,
  formatContextWindowTokens,
} from "~/lib/context-window";

const CONTEXT_WINDOW_RING_RADIUS = 9.75;

function getContextWindowRingMetrics(usage: ContextWindowSnapshot) {
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const circumference = 2 * Math.PI * CONTEXT_WINDOW_RING_RADIUS;
  const dashOffset = circumference - (normalizedPercentage / 100) * circumference;

  return {
    normalizedPercentage,
    circumference,
    dashOffset,
  };
}

export function ContextWindowRing(props: {
  usage: ContextWindowSnapshot;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const { usage, size = "md", className } = props;
  const usedPercentage = formatContextUsagePercentage(usage.usedPercentage);
  const { normalizedPercentage, circumference, dashOffset } = getContextWindowRingMetrics(usage);
  const dimension = size === "xs" ? "size-4" : size === "sm" ? "size-5" : "size-6";

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        dimension,
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="-rotate-90 absolute inset-0 h-full w-full transform-gpu"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r={CONTEXT_WINDOW_RING_RADIUS}
          fill="none"
          stroke="color-mix(in oklab, var(--color-muted) 70%, transparent)"
          strokeWidth="3"
        />
        <circle
          cx="12"
          cy="12"
          r={CONTEXT_WINDOW_RING_RADIUS}
          fill="none"
          stroke="var(--color-muted-foreground)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-[stroke-dashoffset] duration-150 ease-out motion-reduce:transition-none"
        />
      </svg>
      {size === "md" ? (
        <span
          className={cn(
            "relative size-2 rounded-full bg-muted-foreground/70",
            usage.usedPercentage !== null && normalizedPercentage >= 85 && "bg-warning",
          )}
          aria-hidden
        />
      ) : null}
      {size !== "md" ? (
        <span className="sr-only">
          {usedPercentage ?? `${formatContextWindowTokens(usage.usedTokens)} tokens used`}
        </span>
      ) : null}
    </span>
  );
}
