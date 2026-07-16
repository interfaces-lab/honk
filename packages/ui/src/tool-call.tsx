// Locked law. No status icons on tool calls. The disclosure chevron is a control, not a status icon.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Icon } from "./icon";
import { IconChevronRightMedium } from "./icons";
import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, conversationVars, fontVars, iconVars, motionVars } from "./tokens.stylex";

type ToolCallState = "running" | "done" | "failed";

interface ToolCallLineProps {
  id?: string | undefined;
  verb: string;
  detail?: string | undefined;
  state?: ToolCallState | undefined;
  added?: number | undefined;
  removed?: number | undefined;
  isExpanded?: boolean | undefined;
  onToggle?: (() => void) | undefined;
  "aria-controls"?: string | undefined;
  "aria-label"?: string | undefined;
  style?: StyleProp<HonkStyle>;
}

// Shimmer stop offsets are fixed animation geometry, not design tokens.
const SHIMMER_SHOULDER = `color-mix(in srgb, ${colorVars["--honk-color-fg"]} 60%, transparent)`;
const SHIMMER_GRADIENT =
  `linear-gradient(90deg, ${SHIMMER_SHOULDER} 0%, ${SHIMMER_SHOULDER} 25%, ` +
  `${colorVars["--honk-color-fg"]} 60%, ${SHIMMER_SHOULDER} 75%, ${SHIMMER_SHOULDER} 100%)`;

const shine = stylex.keyframes({
  "0%": { backgroundPosition: "200% 0" },
  "100%": { backgroundPosition: "-200% 0" },
});

const shimmerStyles = stylex.create({
  // Reduced motion drops the gradient and shows a still fg-tertiary line.
  shimmer: {
    animationName: { default: shine, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: {
      default: motionVars["--honk-motion-duration-shimmer"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
    backgroundImage: {
      default: SHIMMER_GRADIENT,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    backgroundSize: "200% 100%",
    backgroundClip: "text",
    color: {
      default: "transparent",
      "@media (prefers-reduced-motion: reduce)": colorVars["--honk-color-fg-tertiary"],
    },
  },
});

const toolCallShimmer = shimmerStyles.shimmer;

const styles = stylex.create({
  // StyleX 0.19 has no descendant selectors, so the row exposes verb/detail colors via private vars.
  root: {
    "--_verb-color": {
      default: colorVars["--honk-color-fg-secondary"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-fg"] },
    },
    "--_detail-color": {
      default: colorVars["--honk-color-fg-tertiary"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-fg-secondary"] },
    },
    display: "inline-flex",
    alignItems: "center",
    gap: conversationVars["--honk-conversation-row-gap"],
    minHeight: conversationVars["--honk-conversation-row-min-h"],
    width: "fit-content",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    boxSizing: "border-box",
    paddingInline: conversationVars["--honk-conversation-inset"],
    paddingBlock: 0,
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body-lg"],
    lineHeight: fontVars["--honk-leading-heading"],
    color: colorVars["--honk-color-fg"],
    userSelect: "none",
  },
  failed: {
    "--_verb-color": colorVars["--honk-color-fg-red"],
    "--_detail-color": colorVars["--honk-color-fg-red"],
    color: colorVars["--honk-color-fg-red"],
  },
  button: {
    borderStyle: "none",
    backgroundColor: "transparent",
    textAlign: "left",
    cursor: "pointer",
  },
  verb: {
    flexShrink: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: fontVars["--honk-font-weight-regular"],
    color: "var(--_verb-color)",
    transitionProperty: "color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  detail: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
    color: "var(--_detail-color)",
    transitionProperty: "color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  stats: {
    display: "inline-flex",
    flexShrink: 0,
    gap: conversationVars["--honk-conversation-row-gap"],
    marginInlineStart: conversationVars["--honk-conversation-row-gap"],
    fontVariantNumeric: "tabular-nums",
  },
  added: { color: colorVars["--honk-color-diff-addition"] },
  removed: { color: colorVars["--honk-color-diff-deletion"] },
  chevron: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: iconVars["--honk-icon-size-xs"],
    height: iconVars["--honk-icon-size-xs"],
    color: colorVars["--honk-color-icon-tertiary"],
    transform: "none",
    transitionProperty: "transform",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-collapsible"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  chevronExpanded: {
    transform: "rotate(90deg)",
  },
});

interface DiffStatsProps {
  added?: number | undefined;
  removed?: number | undefined;
  style?: StyleProp<HonkStyle>;
}

function DiffStats({ added = 0, removed = 0, style }: DiffStatsProps): React.ReactElement | null {
  if (added === 0 && removed === 0) {
    return null;
  }
  return (
    <span {...applyStyle(stylex.props(styles.stats), style)}>
      {added > 0 && <span {...stylex.props(styles.added)}>+{added}</span>}
      {removed > 0 && <span {...stylex.props(styles.removed)}>-{removed}</span>}
    </span>
  );
}

interface ToolCallLineChevronProps {
  isExpanded: boolean;
}

function ToolCallLineChevron({ isExpanded }: ToolCallLineChevronProps): React.ReactElement {
  return (
    <span
      aria-hidden={true}
      data-tool-call-line-chevron=""
      {...stylex.props(styles.chevron, isExpanded && styles.chevronExpanded)}
    >
      <Icon icon={IconChevronRightMedium} size="xs" />
    </span>
  );
}

function ToolCallLine({
  id,
  verb,
  detail,
  state = "done",
  added,
  removed,
  isExpanded = false,
  onToggle,
  "aria-controls": ariaControls,
  "aria-label": ariaLabel,
  style,
}: ToolCallLineProps): React.ReactElement {
  const isRunning = state === "running";
  const isFailed = state === "failed";

  const content = (
    <>
      <span {...stylex.props(styles.verb, isRunning && toolCallShimmer)}>{verb}</span>
      {detail !== undefined && <span {...stylex.props(styles.detail)}>{detail}</span>}
      <DiffStats added={added} removed={removed} />
      {onToggle !== undefined && <ToolCallLineChevron isExpanded={isExpanded} />}
    </>
  );

  // data-tool-status uses this package's state words (running|done|failed), not the app's.
  if (onToggle !== undefined) {
    return (
      <button
        id={id}
        type="button"
        aria-controls={ariaControls}
        aria-expanded={isExpanded}
        aria-label={ariaLabel}
        onClick={onToggle}
        data-tool-call-line=""
        data-tool-status={state}
        {...applyStyle(stylex.props(styles.root, styles.button, isFailed && styles.failed), style)}
      >
        {content}
      </button>
    );
  }
  return (
    <div
      id={id}
      data-tool-call-line=""
      data-tool-status={state}
      {...applyStyle(stylex.props(styles.root, isFailed && styles.failed), style)}
    >
      {content}
    </div>
  );
}

export { DiffStats, ToolCallLine, ToolCallLineChevron, toolCallShimmer };
export type { DiffStatsProps, ToolCallLineProps, ToolCallState };
