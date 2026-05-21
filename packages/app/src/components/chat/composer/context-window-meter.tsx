import { cn } from "~/lib/utils";
import {
  type ContextWindowSnapshot,
  formatContextUsagePercentage,
  formatContextWindowTokens,
} from "~/lib/context-window";
import { Popover, PopoverPopup, PopoverTrigger } from "@multi/ui/popover";

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
  size?: "sm" | "md";
  className?: string;
}) {
  const { usage, size = "md", className } = props;
  const usedPercentage = formatContextUsagePercentage(usage.usedPercentage);
  const { normalizedPercentage, circumference, dashOffset } = getContextWindowRingMetrics(usage);
  const dimension = size === "sm" ? "size-5" : "size-6";
  const innerLabel = size === "sm" ? "size-2.5 text-[7px]" : "size-3.5 text-[8px]";

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
          className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
        />
      </svg>
      {size === "md" ? (
        <span
          className={cn(
            "relative flex items-center justify-center rounded-full bg-background font-medium tabular-nums",
            innerLabel,
            "text-muted-foreground",
          )}
        >
          {usage.usedPercentage !== null
            ? Math.round(normalizedPercentage)
            : formatContextWindowTokens(usage.usedTokens)}
        </span>
      ) : null}
      {size === "sm" ? (
        <span className="sr-only">
          {usedPercentage ?? `${formatContextWindowTokens(usage.usedTokens)} tokens used`}
        </span>
      ) : null}
    </span>
  );
}

export function ContextWindowUsageDetails(props: { usage: ContextWindowSnapshot }) {
  const { usage } = props;
  const usedPercentage = formatContextUsagePercentage(usage.usedPercentage);

  return (
    <div className="space-y-1.5 leading-tight">
      <div className="text-detail font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Context window
      </div>
      {usage.maxTokens !== null && usedPercentage ? (
        <div className="whitespace-nowrap tabular-nums text-xs font-medium text-foreground">
          <span>{usedPercentage}</span>
          <span className="mx-1">·</span>
          <span>{formatContextWindowTokens(usage.usedTokens)}</span>
          <span>/</span>
          <span>{formatContextWindowTokens(usage.maxTokens ?? null)} context used</span>
        </div>
      ) : (
        <div className="text-sm text-foreground">
          {formatContextWindowTokens(usage.usedTokens)} tokens used so far
        </div>
      )}
      {(usage.totalProcessedTokens ?? null) !== null &&
      (usage.totalProcessedTokens ?? 0) > usage.usedTokens ? (
        <div className="text-xs text-muted-foreground">
          Total processed: {formatContextWindowTokens(usage.totalProcessedTokens ?? null)} tokens
        </div>
      ) : null}
      {usage.compactsAutomatically ? (
        <div className="text-xs text-muted-foreground">
          Automatically compacts its context when needed.
        </div>
      ) : null}
    </div>
  );
}

export function ContextWindowMeter(props: { usage: ContextWindowSnapshot }) {
  const { usage } = props;
  const usedPercentage = formatContextUsagePercentage(usage.usedPercentage);

  return (
    <Popover data-composer-context-meter="">
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className="group inline-flex select-none items-center justify-center rounded-full transition-opacity hover:opacity-85"
            aria-label={
              usage.maxTokens !== null && usedPercentage
                ? `Context window ${usedPercentage} used`
                : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
            }
          >
            <ContextWindowRing usage={usage} size="md" />
          </button>
        }
      />
      <PopoverPopup tooltipStyle side="top" align="end" className="w-max max-w-none px-3 py-2">
        <ContextWindowUsageDetails usage={usage} />
      </PopoverPopup>
    </Popover>
  );
}
