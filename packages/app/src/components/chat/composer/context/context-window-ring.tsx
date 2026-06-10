import type { CSSProperties } from "react";

import { cn } from "~/lib/utils";
import {
  type ContextWindowSnapshot,
  formatContextUsagePercentage,
  formatContextWindowTokens,
} from "~/lib/context-window";

const VIEWBOX_SIZE = 24;
const RING_CENTER = VIEWBOX_SIZE / 2;
const RING_STROKE_WIDTH = 2.25;
const RING_RADIUS = (VIEWBOX_SIZE - RING_STROKE_WIDTH) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const RING_SIZE_CLASS = {
  xs: "size-3.5",
  sm: "size-5",
  md: "size-6",
} as const;

const RING_STYLE = {
  "--multi-context-usage-ring-track": "var(--multi-stroke-tertiary)",
  "--multi-context-usage-ring-progress": "var(--multi-fg-secondary)",
  "--multi-context-usage-ring-progress-warning": "var(--warning)",
} as CSSProperties;

function normalizeUsagePercentage(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function ContextUsageRingGraphic(props: {
  percentage: number;
  empty?: boolean;
  highUsage?: boolean;
}) {
  const normalizedPercentage = normalizeUsagePercentage(props.percentage);
  const dashOffset = RING_CIRCUMFERENCE * (1 - normalizedPercentage / 100);
  const showProgress = !props.empty && normalizedPercentage > 0;

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
      className="block h-full w-full -rotate-90 transform-gpu"
      aria-hidden="true"
      style={RING_STYLE}
    >
      <circle
        cx={RING_CENTER}
        cy={RING_CENTER}
        r={RING_RADIUS}
        fill="none"
        stroke="var(--multi-context-usage-ring-track)"
        strokeWidth={RING_STROKE_WIDTH}
        opacity={props.empty ? 0.5 : 1}
      />
      {showProgress ? (
        <circle
          cx={RING_CENTER}
          cy={RING_CENTER}
          r={RING_RADIUS}
          fill="none"
          stroke={
            props.highUsage
              ? "var(--multi-context-usage-ring-progress-warning)"
              : "var(--multi-context-usage-ring-progress)"
          }
          strokeWidth={RING_STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          className="transition-[stroke-dashoffset] duration-150 ease-out motion-reduce:transition-none"
        />
      ) : null}
    </svg>
  );
}

export function ContextUsageEmptyRing(props: { size?: "xs" | "sm" | "md"; className?: string }) {
  const size = props.size ?? "xs";

  return (
    <span
      data-context-usage-ring=""
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        RING_SIZE_CLASS[size],
        props.className,
      )}
      aria-hidden
    >
      <ContextUsageRingGraphic percentage={0} empty />
    </span>
  );
}

export function ContextWindowRing(props: {
  usage: ContextWindowSnapshot;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const { usage, size = "md", className } = props;
  const usedPercentage = formatContextUsagePercentage(usage.usedPercentage);
  const normalizedPercentage = normalizeUsagePercentage(usage.usedPercentage);
  const highUsage = usage.usedPercentage !== null && normalizedPercentage >= 85;

  return (
    <span
      data-context-usage-ring=""
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        RING_SIZE_CLASS[size],
        className,
      )}
    >
      <ContextUsageRingGraphic percentage={normalizedPercentage} highUsage={highUsage} />
      {size === "md" ? (
        <span
          className={cn(
            "relative size-2 rounded-full bg-multi-fg-secondary/70",
            highUsage && "bg-warning",
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
