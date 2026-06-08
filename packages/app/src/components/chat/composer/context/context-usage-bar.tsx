import type { CSSProperties } from "react";
import { Button } from "@multi/multikit/button";
import {
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverTrigger,
} from "@multi/multikit/popover";
import { IconCrossSmall } from "central-icons";

import {
  formatContextUsagePercentage,
  type ContextWindowSnapshot,
} from "~/lib/context-window";
import { cn } from "~/lib/utils";
import { ContextWindowRing } from "./context-window-meter";

type ContextUsageColor =
  | "gray"
  | "purple"
  | "green"
  | "yellow"
  | "pink"
  | "blue"
  | "orange"
  | "red";

type ContextUsageCategoryView = {
  id: string;
  label: string;
  tokens: number;
};

const CONTEXT_USAGE_COLOR_SEQUENCE: ContextUsageColor[] = [
  "gray",
  "purple",
  "green",
  "yellow",
  "pink",
  "blue",
  "orange",
  "red",
];

const CONTEXT_USAGE_COLOR_BY_CATEGORY_ID: Record<string, ContextUsageColor> = {
  system_prompt: "gray",
  tools: "purple",
  tool_definitions: "purple",
  rules: "green",
  skills: "yellow",
  mcp: "pink",
  subagents: "blue",
  summarized_conversation: "red",
  conversation: "orange",
  uncategorized: "gray",
};

function contextUsageColorValue(color: ContextUsageColor): string {
  switch (color) {
    case "gray":
      return "var(--multi-fg-tertiary)";
    case "purple":
      return "color-mix(in oklch, var(--primary) 78%, var(--cursor-text-red-primary))";
    case "green":
      return "var(--cursor-text-green-primary)";
    case "yellow":
      return "var(--cursor-text-yellow-primary)";
    case "pink":
      return "color-mix(in oklch, var(--cursor-text-red-primary) 62%, var(--primary))";
    case "blue":
      return "var(--cursor-text-cyan-primary)";
    case "orange":
      return "var(--cursor-text-orange-primary)";
    case "red":
      return "var(--cursor-text-red-primary)";
  }
}

function contextUsageColorForCategory(id: string, index: number): ContextUsageColor {
  return (
    CONTEXT_USAGE_COLOR_BY_CATEGORY_ID[id] ??
    CONTEXT_USAGE_COLOR_SEQUENCE[index % CONTEXT_USAGE_COLOR_SEQUENCE.length] ??
    "gray"
  );
}

function contextUsageColorStyle(color: ContextUsageColor): CSSProperties {
  return { backgroundColor: contextUsageColorValue(color) };
}

function formatContextUsageTokensCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.max(0, Math.round(value));
  if (rounded >= 1_000_000) {
    return `${(rounded / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (rounded >= 1_000) {
    return `${(rounded / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return `${rounded}`;
}

function contextUsageCategories(usage: ContextWindowSnapshot): ContextUsageCategoryView[] {
  const explicitCategories =
    usage.categories
      ?.filter((category) => category.tokens > 0)
      .map((category) => ({
        id: category.id,
        label: category.label,
        tokens: Math.round(category.tokens),
      })) ?? [];

  if (explicitCategories.length > 0) {
    const explicitTotal = explicitCategories.reduce((total, category) => total + category.tokens, 0);
    const uncategorizedTokens = Math.max(0, Math.round(usage.usedTokens - explicitTotal));
    if (uncategorizedTokens > 0) {
      return [
        ...explicitCategories,
        {
          id: "uncategorized",
          label: "Other",
          tokens: uncategorizedTokens,
        },
      ];
    }
    return explicitCategories;
  }

  return [
    {
      id: "conversation",
      label: "Conversation",
      tokens: Math.round(usage.usedTokens),
    },
  ];
}

function ContextUsagePlaceholderRing() {
  return (
    <span
      className="inline-flex size-4 shrink-0 items-center justify-center text-multi-fg-tertiary"
      aria-hidden
    >
      <svg className="size-4" viewBox="0 0 24 24" fill="none">
        <circle
          cx="12"
          cy="12"
          r="8.75"
          stroke="currentColor"
          strokeWidth="3"
          opacity="0.55"
        />
      </svg>
    </span>
  );
}

function ContextUsagePopoverHeader() {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-body font-medium text-multi-fg-primary">Context Usage</div>
      <PopoverClose
        type="button"
        aria-label="Close context usage"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-multi-icon-tertiary hover:bg-multi-bg-quaternary hover:text-multi-icon-secondary"
      >
        <IconCrossSmall className="size-3.5" aria-hidden />
      </PopoverClose>
    </div>
  );
}

function ContextUsagePopover(props: { usage: ContextWindowSnapshot | null }) {
  const { usage } = props;
  if (usage === null) {
    return (
      <Popover data-composer-context-meter="">
        <PopoverTrigger
          delay={150}
          closeDelay={0}
          render={
            <Button
              data-clickable=""
              size="xs"
              variant="ghost"
              className={cn(
                "h-5 shrink-0 gap-1 rounded-full px-1.5 text-caption text-multi-fg-tertiary tabular-nums",
                "hover:bg-multi-bg-quaternary hover:text-multi-fg-secondary",
              )}
              aria-label="Show context usage, no usage reported yet"
            >
              <ContextUsagePlaceholderRing />
              <span className="min-w-0">-</span>
            </Button>
          }
        />
        <PopoverPopup
          instant
          side="top"
          align="end"
          sideOffset={8}
          variant="workbench"
          className="max-w-none"
        >
          <div
            aria-label="Context usage preview"
            className="flex w-[min(30rem,calc(100vw-2rem))] flex-col gap-3 p-3"
          >
            <ContextUsagePopoverHeader />
            <div className="text-body text-multi-fg-secondary">No context usage reported yet.</div>
          </div>
        </PopoverPopup>
      </Popover>
    );
  }

  const maxTokens = usage.maxTokens ?? null;
  const usedPercentage = usage.usedPercentage ?? null;
  const categories = contextUsageCategories(usage);
  const percentageLabel = formatContextUsagePercentage(usedPercentage);
  const roundedPercentage =
    usedPercentage !== null ? `${Math.round(usedPercentage)}% Full` : null;
  const usedLabel = `~${formatContextUsageTokensCompact(usage.usedTokens)}`;
  const maxLabel = formatContextUsageTokensCompact(maxTokens);
  const remainderTokens =
    maxTokens !== null ? Math.max(0, Math.round(maxTokens - usage.usedTokens)) : 0;

  return (
    <Popover data-composer-context-meter="">
      <PopoverTrigger
        delay={150}
        closeDelay={0}
        render={
          <Button
            data-clickable=""
            size="xs"
            variant="ghost"
            className={cn(
              "h-5 shrink-0 gap-1 rounded-full px-1.5 text-caption text-multi-fg-tertiary tabular-nums",
              "hover:bg-multi-bg-quaternary hover:text-multi-fg-secondary",
            )}
            aria-label={
              percentageLabel
                ? `Show context usage, ${percentageLabel} full`
                : `Show context usage, ${formatContextUsageTokensCompact(usage.usedTokens)} tokens used`
            }
          >
            <ContextWindowRing usage={usage} size="xs" />
            <span className="min-w-0">{percentageLabel ?? "-"}</span>
          </Button>
        }
      />
      <PopoverPopup
        instant
        side="top"
        align="end"
        sideOffset={8}
        variant="workbench"
        className="max-w-none"
      >
        <div
          aria-label="Context usage preview"
          className="flex w-[min(30rem,calc(100vw-2rem))] flex-col gap-3 p-3"
        >
          <ContextUsagePopoverHeader />

          <div className="flex items-baseline justify-between gap-3 text-body text-multi-fg-secondary tabular-nums">
            <span>{roundedPercentage ?? "Context used"}</span>
            <span>
              {maxTokens !== null ? `${usedLabel} / ${maxLabel} Tokens` : `${usedLabel} Tokens`}
            </span>
          </div>

          <div
            className="flex h-1.5 overflow-hidden rounded-full bg-multi-bg-secondary"
            role="img"
            aria-label={
              maxTokens !== null
                ? `Context usage by category: ${usedLabel} of ${maxLabel} tokens used`
                : `Context usage by category: ${usedLabel} tokens used`
            }
          >
            {categories.map((category, index) => {
              const color = contextUsageColorForCategory(category.id, index);
              return (
                <span
                  key={`${category.id}:${index}`}
                  className="min-w-0.5 rounded-full"
                  data-context-usage-category-segment=""
                  style={{
                    ...contextUsageColorStyle(color),
                    flexGrow: Math.max(0, category.tokens),
                  }}
                  aria-hidden
                />
              );
            })}
            {remainderTokens > 0 ? (
              <span
                className="min-w-0 rounded-full bg-multi-bg-secondary"
                style={{ flexGrow: remainderTokens }}
                aria-hidden
              />
            ) : null}
          </div>

          <ul className="grid gap-1">
            {categories.map((category, index) => {
              const color = contextUsageColorForCategory(category.id, index);
              return (
                <li
                  key={`${category.id}:${index}`}
                  className="flex min-w-0 items-center gap-2 rounded-[4px] px-0 py-1 text-body"
                  data-context-usage-category=""
                  data-color={color}
                >
                  <span
                    className="size-3 shrink-0 rounded-[3px]"
                    style={contextUsageColorStyle(color)}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-multi-fg-primary">
                    {category.label}
                  </span>
                  <span className="shrink-0 text-multi-fg-secondary tabular-nums">
                    {formatContextUsageTokensCompact(category.tokens)}
                  </span>
                </li>
              );
            })}
          </ul>

          {usage.compactsAutomatically ? (
            <div className="text-detail text-multi-fg-tertiary">
              Automatically compacts its context when needed.
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

export function ComposerContextUsageBar(props: {
  usage: ContextWindowSnapshot | null;
  branchName: string | null;
  executionModeLabel: string | null;
  showContextUsageTrigger: boolean;
}) {
  return (
    <div
      data-composer-thread-status-bar=""
      className="box-border flex min-h-5 w-full min-w-0 items-center justify-between gap-3 px-3 text-body text-multi-fg-tertiary"
    >
      <div className="flex min-w-0 items-center gap-3 overflow-hidden">
        {props.branchName ? (
          <span className="min-w-0 truncate" title={props.branchName}>
            {props.branchName}
          </span>
        ) : null}
        {props.executionModeLabel ? (
          <span className="shrink-0" title={props.executionModeLabel}>
            {props.executionModeLabel}
          </span>
        ) : null}
      </div>
      {props.showContextUsageTrigger && props.usage ? (
        <ContextUsagePopover usage={props.usage} />
      ) : null}
    </div>
  );
}
