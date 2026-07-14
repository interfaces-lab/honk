// The tool call line — the conversation's activity/verb row: "Read src/tabs.tsx · 681 lines",
// "Running pnpm test…", "Command node lint.mjs · exit 1". The app's vocabulary and anatomy come
// from honkkit's ToolCallLine (packages/honkkit/src/tool-call.tsx: toolCallLineVariants /
// -ActionVariants / -DetailsVariants) with values ported exactly; the locked thread law shapes
// two deltas (recon memo, locked-law deltas):
//   • NO status icons on tool calls, ever (locked.html §5 "Assistant output is never a bubble").
//     The app's detailed-density icon channel is dropped; the type ramp carries the hierarchy.
//     The disclosure CHEVRON stays — it is a control, not a status icon.
//   • Hierarchy is type-role only: verb = fg-secondary (74% fg), detail = fg-tertiary (54% fg),
//     hover promotes each one step, running shimmers, failed goes tone-red — all exact app values
//     via the conversation color tokens.
//
// Presentational and effect-free (ADR 0025): props in, DOM out; the row holds no expanded state —
// the caller passes isExpanded/onToggle. The app applies the 11px row inset from timeline scope
// CSS ([data-chat-timeline-scroll] [data-tool-call-line], conversation.css); with no descendant
// selectors here, the row owns its own inset instead.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Icon } from "./icon";
import { IconChevronRightMedium } from "./icons";
import { colorVars, conversationVars, fontVars, iconVars, motionVars } from "./tokens.stylex";

// The row's status vocabulary, as the recon memo names it: running shimmers, done rests on the
// secondary/tertiary ramp, failed pins everything to the failure red.
type ToolCallState = "running" | "done" | "failed";

interface ToolCallLineProps {
  // The action word, in the app's own verb grammar (tool-renderer TOOL_ACTION_LABELS):
  // Reading/Read, Editing/Edited, Running/Ran — error rows use the bare form ("Command").
  verb: string;
  // Trailing detail: paths, counts, exit codes. fg-tertiary + tabular-nums on the line; mono
  // detail only ever appears in expanded bodies in the app, never on the line itself.
  detail?: string | undefined;
  state?: ToolCallState | undefined;
  // Edit-tool diff stats, rendered as +N/-N in the diff hues (tool-renderer EditStats).
  added?: number | undefined;
  removed?: number | undefined;
  // Disclosure: providing onToggle renders the row as a <button> with the chevron; the caller
  // owns the expanded state and whatever body it reveals.
  isExpanded?: boolean | undefined;
  onToggle?: (() => void) | undefined;
  // Caller override, merged last (charter merge order).
  xstyle?: stylex.StyleXStyles;
}

// ── The running shimmer (shared vocabulary) ────────────────────────────────────────────────
// The app's .tool-call-shimmer (packages/honkkit/src/styles.css), which conversation.css
// re-declares verbatim for running work-group headers — here the style object is exported once
// (toolCallShimmer) instead of duplicated. Text is painted with a shine gradient through
// background-clip:text and the gradient sweeps via background-position.

// The shine gradient: 60%-fg shoulders around a full-strength fg center. Colors are tokens; the
// stop OFFSETS (0/25/60/75/100%) and the 60% shoulder mix are the signature animation's fixed
// geometry — intrinsics, not vocabulary (stylex skill, Tokens rule 3).
const SHIMMER_SHOULDER = `color-mix(in srgb, ${colorVars["--honk-color-fg"]} 60%, transparent)`;
const SHIMMER_GRADIENT =
  `linear-gradient(90deg, ${SHIMMER_SHOULDER} 0%, ${SHIMMER_SHOULDER} 25%, ` +
  `${colorVars["--honk-color-fg"]} 60%, ${SHIMMER_SHOULDER} 75%, ${SHIMMER_SHOULDER} 100%)`;

// One shine pass, verbatim from styles.css @keyframes tool-call-line-shine.
const shine = stylex.keyframes({
  "0%": { backgroundPosition: "200% 0" },
  "100%": { backgroundPosition: "-200% 0" },
});

const shimmerStyles = stylex.create({
  // Reduced motion mirrors the app's fallback per-property: no animation, no gradient, a still
  // fg-tertiary line. background-clip:text ships unprefixed on the pinned Chromium/WebKit
  // targets (vite.config.ts lightningcss targets), so no -webkit- twin is written here.
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

// The shared style, by the app's own name — running work-group headers reuse it exactly as the
// app reuses the .tool-call-shimmer class.
const toolCallShimmer = shimmerStyles.shimmer;

// ── Row styles ─────────────────────────────────────────────────────────────────────────────

const styles = stylex.create({
  // The app's group-hover/tool-call-line utilities become private color channels: the row flips
  // its own vars on :hover and the verb/detail spans read them (parent-sets-a-var — StyleX 0.19
  // has no descendant selectors; tabs.tsx precedent).
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
    fontSize: fontVars["--honk-text-title"],
    lineHeight: fontVars["--honk-leading-title"],
    color: colorVars["--honk-color-fg"],
    userSelect: "none",
  },
  // Failed: the whole row goes failure red — root color plus both channels (the app's error
  // variants pin action + details to red, hover included).
  failed: {
    "--_verb-color": colorVars["--honk-color-fg-red"],
    "--_detail-color": colorVars["--honk-color-fg-red"],
    color: colorVars["--honk-color-fg-red"],
  },
  // Button chrome reset for the disclosure-enabled row.
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
  // Diff stats: +N/-N in the diff hues, tabular-nums, one row-gap step of extra lead-in
  // (tool-renderer EditStats: ml-1 + gap-1).
  stats: {
    display: "inline-flex",
    flexShrink: 0,
    gap: conversationVars["--honk-conversation-row-gap"],
    marginInlineStart: conversationVars["--honk-conversation-row-gap"],
    fontVariantNumeric: "tabular-nums",
  },
  added: { color: colorVars["--honk-color-diff-addition"] },
  removed: { color: colorVars["--honk-color-diff-deletion"] },
  // The universal disclosure chevron (honkkit ToolCallLineChevron): a 12px box, icon-tertiary
  // paint, quarter-turn when expanded, 100ms rotation with its reduced-motion 0s sibling.
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

// ── Leaves shared across the work stream ───────────────────────────────────────────────────

interface DiffStatsProps {
  added?: number | undefined;
  removed?: number | undefined;
  xstyle?: stylex.StyleXStyles;
}

// Edit-tool diff stats (+N/-N). Also used by the work-group header, exactly as the app's
// EditStats renders on both the edit line and the group header (recon memo §4).
function DiffStats({ added = 0, removed = 0, xstyle }: DiffStatsProps): React.ReactElement | null {
  if (added === 0 && removed === 0) {
    return null;
  }
  return (
    <span {...stylex.props(styles.stats, xstyle)}>
      {added > 0 && <span {...stylex.props(styles.added)}>+{added}</span>}
      {removed > 0 && <span {...stylex.props(styles.removed)}>-{removed}</span>}
    </span>
  );
}

interface ToolCallLineChevronProps {
  isExpanded: boolean;
}

// The disclosure chevron, by honkkit's own name — decorative (the owning control carries the
// aria-expanded), pointing right at rest and down (rotate-90) when expanded.
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

// ── The row ────────────────────────────────────────────────────────────────────────────────

function ToolCallLine({
  verb,
  detail,
  state = "done",
  added,
  removed,
  isExpanded = false,
  onToggle,
  xstyle,
}: ToolCallLineProps): React.ReactElement {
  const isRunning = state === "running";
  const isFailed = state === "failed";

  const content = (
    <>
      <span {...stylex.props(styles.verb, isRunning && toolCallShimmer)}>{verb}</span>
      {detail !== undefined && (
        <span {...stylex.props(styles.detail, isRunning && toolCallShimmer)}>{detail}</span>
      )}
      <DiffStats added={added} removed={removed} />
      {onToggle !== undefined && <ToolCallLineChevron isExpanded={isExpanded} />}
    </>
  );

  // data-tool-call-line mirrors the app's DOM contract; data-tool-status keeps the app's
  // attribute NAME but carries THIS package's state words (running|done|failed, not the app's
  // loading|completed|error). Tests and consumers only; styling never reads them.
  if (onToggle !== undefined) {
    return (
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggle}
        data-tool-call-line=""
        data-tool-status={state}
        {...stylex.props(styles.root, styles.button, isFailed && styles.failed, xstyle)}
      >
        {content}
      </button>
    );
  }
  return (
    <div
      data-tool-call-line=""
      data-tool-status={state}
      {...stylex.props(styles.root, isFailed && styles.failed, xstyle)}
    >
      {content}
    </div>
  );
}

export { DiffStats, ToolCallLine, ToolCallLineChevron, toolCallShimmer };
export type { DiffStatsProps, ToolCallLineProps, ToolCallState };
