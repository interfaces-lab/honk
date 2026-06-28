"use client";

import type * as React from "react";

import { cn } from "./utils";

type ChartDatum = {
  label: string;
  value: number;
  color?: string | undefined;
};

type ChartSvgProps = Omit<React.ComponentProps<"svg">, "children" | "viewBox"> & {
  data: readonly ChartDatum[];
  maxValue?: number | undefined;
  showLabels?: boolean | undefined;
};

const chartColors = [
  "var(--honk-icon-accent-primary)",
  "var(--honk-icon-secondary)",
  "var(--honk-icon-tertiary)",
  "var(--honk-icon-warning)",
  "var(--honk-icon-quaternary)",
] as const;

function getChartMax(data: readonly ChartDatum[], maxValue: number | undefined): number {
  return maxValue ?? Math.max(1, ...data.map((datum) => datum.value));
}

function getDatumColor(datum: ChartDatum, index: number): string {
  return datum.color ?? chartColors[index % chartColors.length] ?? chartColors[0];
}

function BarChart({ className, data, maxValue, showLabels = true, ...props }: ChartSvgProps) {
  const chartMax = getChartMax(data, maxValue);
  const width = 240;
  const height = 128;
  const top = 10;
  const bottom = showLabels ? 28 : 10;
  const chartHeight = height - top - bottom;
  const gap = 8;
  const barCount = Math.max(data.length, 1);
  const barWidth = Math.max(4, (width - gap * (barCount - 1)) / barCount);

  return (
    <svg
      aria-hidden={props["aria-label"] ? undefined : true}
      className={cn(
        "block h-32 w-full max-w-full overflow-visible font-honk text-detail text-honk-fg-tertiary",
        className,
      )}
      data-slot="bar-chart"
      preserveAspectRatio="none"
      role={props["aria-label"] ? "img" : undefined}
      viewBox={`0 0 ${width} ${height}`}
      {...props}
    >
      <line
        stroke="currentColor"
        strokeOpacity="0.18"
        vectorEffect="non-scaling-stroke"
        x1="0"
        x2={width}
        y1={height - bottom}
        y2={height - bottom}
      />
      {data.map((datum, index) => {
        const barHeight = Math.max(1, (datum.value / chartMax) * chartHeight);
        const x = index * (barWidth + gap);
        const y = height - bottom - barHeight;

        return (
          <g key={`${datum.label}:${index}`}>
            <rect
              fill={getDatumColor(datum, index)}
              height={barHeight}
              rx="3"
              width={barWidth}
              x={x}
              y={y}
            />
            {showLabels ? (
              <text fill="currentColor" textAnchor="middle" x={x + barWidth / 2} y={height - 8}>
                {datum.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ className, data, maxValue, showLabels = false, ...props }: ChartSvgProps) {
  const chartMax = getChartMax(data, maxValue);
  const width = 240;
  const height = 128;
  const top = 10;
  const bottom = showLabels ? 28 : 12;
  const chartHeight = height - top - bottom;
  const lastIndex = Math.max(data.length - 1, 1);
  const points = data.map((datum, index) => {
    const x = (index / lastIndex) * width;
    const y = height - bottom - (datum.value / chartMax) * chartHeight;
    return { datum, index, x, y };
  });
  const pointString = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <svg
      aria-hidden={props["aria-label"] ? undefined : true}
      className={cn(
        "block h-32 w-full max-w-full overflow-visible font-honk text-detail text-honk-fg-tertiary",
        className,
      )}
      data-slot="line-chart"
      preserveAspectRatio="none"
      role={props["aria-label"] ? "img" : undefined}
      viewBox={`0 0 ${width} ${height}`}
      {...props}
    >
      <line
        stroke="currentColor"
        strokeOpacity="0.18"
        vectorEffect="non-scaling-stroke"
        x1="0"
        x2={width}
        y1={height - bottom}
        y2={height - bottom}
      />
      <polyline
        fill="none"
        points={pointString}
        stroke="var(--honk-icon-accent-primary)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      {points.map((point) => (
        <g key={`${point.datum.label}:${point.index}`}>
          <circle
            cx={point.x}
            cy={point.y}
            fill="var(--honk-bg-elevated)"
            r="3"
            stroke={getDatumColor(point.datum, point.index)}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          {showLabels ? (
            <text fill="currentColor" textAnchor="middle" x={point.x} y={height - 8}>
              {point.datum.label}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

function describeArc(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polarToCartesian(centerX, centerY, radius, endAngle);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    `M ${centerX} ${centerY}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number,
): { x: number; y: number } {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

type PieChartProps = Omit<ChartSvgProps, "maxValue" | "showLabels"> & {
  showLabels?: boolean | undefined;
};

function PieChart({ className, data, showLabels = false, ...props }: PieChartProps) {
  const width = 160;
  const height = 128;
  const centerX = 64;
  const centerY = 64;
  const radius = 48;
  const values = data.map((datum) => datum.value);
  const total = values.reduce((sum, value) => sum + value, 0);
  let cursor = 0;

  return (
    <svg
      aria-hidden={props["aria-label"] ? undefined : true}
      className={cn(
        "block h-32 w-full max-w-full overflow-visible font-honk text-detail text-honk-fg-tertiary",
        className,
      )}
      data-slot="pie-chart"
      preserveAspectRatio="xMidYMid meet"
      role={props["aria-label"] ? "img" : undefined}
      viewBox={`0 0 ${width} ${height}`}
      {...props}
    >
      {total > 0 ? (
        data.map((datum, index) => {
          const value = values[index] ?? 0;
          if (value <= 0) {
            return null;
          }
          const startAngle = cursor;
          const endAngle = cursor + (value / total) * 360;
          cursor = endAngle;

          if (endAngle - startAngle >= 359.999) {
            return (
              <circle
                cx={centerX}
                cy={centerY}
                fill={getDatumColor(datum, index)}
                key={`${datum.label}:${index}`}
                r={radius}
              />
            );
          }

          return (
            <path
              d={describeArc(centerX, centerY, radius, startAngle, endAngle)}
              fill={getDatumColor(datum, index)}
              key={`${datum.label}:${index}`}
              stroke="var(--honk-bg-elevated)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          );
        })
      ) : (
        <circle
          cx={centerX}
          cy={centerY}
          fill="transparent"
          r={radius}
          stroke="currentColor"
          strokeOpacity="0.18"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {showLabels ? (
        <g>
          {data.map((datum, index) => (
            <text
              fill="currentColor"
              key={`${datum.label}:label:${index}`}
              x="120"
              y={20 + index * 16}
            >
              {datum.label}
            </text>
          ))}
        </g>
      ) : null}
    </svg>
  );
}

export { BarChart, LineChart, PieChart, type ChartDatum };
