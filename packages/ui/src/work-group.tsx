// The work group — the thread's grouped-work presentation (locked.html §5 "Work groups: verb
// line + live window"): a header that leads with the summary verb (Explored / Edited / Ran /
// "Thought for 4s"), and, while running, a live preview window capped at 144px with the last
// shell/edit step tailing output in a 90px mono strip. One family, one file, compound
// attachment:
//
//   WorkGroup              the group container (4px header gap, conversation text tier)
//   ├ WorkGroup.Header     verb · detail · diff stats · chevron — plus the Stop affordance
//   ├ WorkGroup.Preview    the 144px bottom-anchored live window with the top fade mask
//   └ WorkGroup.OutputStrip the 90px mono tail (5 × 18px lines)
//
// Values ported exactly from the app's step-renderer (packages/app/src/components/chat/
// timeline/step-renderer.tsx + packages/app/src/styles/conversation.css); the running header
// verb shimmers with the SAME .tool-call-shimmer the tool line owns (conversation.css
// re-declares it for [data-group-loading] headers — here it is imported once). Two locked-law
// deltas apply (recon memo §8):
//   • Stop is a hover affordance on the LIVE group's header (locked.html §5) — the app has no
//     header Stop (interrupt lives in the composer), so its structure comes from the locked
//     board and its values are board-vocabulary tokens pending the identity round.
//   • The app hides preview-row chevrons via descendant CSS; here callers simply omit onToggle
//     on rows they place inside the Preview.
//
// Presentational and effect-free (ADR 0025): expanded/running state and the "which rows are in
// the preview" question belong to the caller; the app's JS scroll-pinning of the preview/strip
// is replaced by justify-end bottom-anchoring (same visual: the tail stays in view).

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { DiffStats, ToolCallLineChevron, toolCallShimmer } from "./tool-call";
import { colorVars, conversationVars, fontVars, motionVars, radiusVars } from "./tokens.stylex";

// ── Group intrinsics ───────────────────────────────────────────────────────────────────────
// Preview/output caps are LAW, not vocabulary: locked.html §5 cites "144/28/90px" as the law of
// this surface and step-renderer.tsx defines them (WORK_GROUP_PREVIEW_PX 144,
// WORK_GROUP_PREVIEW_OUTPUT_STRIP_PX 90 — "5 × 18px mono lines"). Law-fixed numbers are named
// constants, never tokens (matrix.tsx precedent: tokens are what the identity round swaps; law
// never drifts).
const PREVIEW_MAX_HEIGHT = "144px";
const OUTPUT_STRIP_MAX_HEIGHT = "90px";
// The preview's top fade when content overflows, verbatim from conversation.css
// [data-preview-scrollable="true"] [data-work-group-preview] — an alpha MASK ramp (black =
// mask alpha, not a theme color) with its fixed 32px shoulder; an intrinsic of the surface.
const PREVIEW_FADE_MASK = "linear-gradient(to bottom, rgb(0 0 0 / 0.35) 0, rgb(0 0 0) 32px)";
const GROUP_PAD_Y = "2px"; // py-0.5 on the group container (step-renderer.tsx)
// Stop-chip anatomy: this affordance exists only on the locked board (no app source), so its
// interior numbers are private constants proportioned to the caption tier, and its colors are
// board-vocabulary tokens. The border is a hairline (shell.tsx precedent).
const STOP_PAD_X = "8px";
const STOP_PAD_Y = "2px";
const STOP_BORDER_WIDTH = "1px";

const styles = stylex.create({
  group: {
    display: "flex",
    flexDirection: "column",
    // --chat-timeline-collapsible-header-gap: the 4px between header and body
    gap: conversationVars["--honk-conversation-row-gap"],
    paddingBlock: GROUP_PAD_Y,
    minWidth: 0,
    maxWidth: "100%",
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-text-title"],
    lineHeight: fontVars["--honk-leading-title"],
  },
  // The header row hosts the disclosure button AND the Stop chip — they are siblings because
  // buttons cannot nest. The row's own hover feeds the Stop reveal (parent-sets-a-var).
  headerRow: {
    "--_reveal": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
    },
    display: "flex",
    alignItems: "center",
    gap: conversationVars["--honk-conversation-row-gap"],
    width: "fit-content",
    maxWidth: "100%",
    minWidth: 0,
  },
  // The header line: the app's WorkGroupHeaderButton — fg-tertiary resting, fg-secondary on its
  // own hover (children inherit through currentColor, so no per-span channels needed here).
  // Button chrome (reset + pointer) applies only when the header is actually a disclosure —
  // same honesty split as ToolCallLine's root/button pair.
  headerLine: {
    display: "inline-flex",
    alignItems: "center",
    gap: conversationVars["--honk-conversation-row-gap"],
    minHeight: conversationVars["--honk-conversation-row-min-h"],
    width: "fit-content",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    boxSizing: "border-box",
    paddingInline: conversationVars["--honk-conversation-inset"],
    paddingBlock: 0,
    color: {
      default: colorVars["--honk-color-fg-tertiary"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-fg-secondary"] },
    },
    transitionProperty: "color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  headerButton: {
    borderStyle: "none",
    backgroundColor: "transparent",
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
  },
  verb: {
    flexShrink: 0,
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
  // The "·" between verb and detail — pinned fg-tertiary, unmoved by the button's hover
  // (the app gives it an explicit text-honk-fg-tertiary).
  separator: {
    flexShrink: 0,
    color: colorVars["--honk-color-fg-tertiary"],
  },
  detail: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
    color: colorVars["--honk-color-fg-tertiary"],
  },
  // Stop: hover-revealed on the live group's header (locked §5); keyboard focus reveals it too.
  stop: {
    flexShrink: 0,
    opacity: {
      default: "var(--_reveal, 0)",
      ":focus-visible": "1",
    },
    paddingInline: STOP_PAD_X,
    paddingBlock: STOP_PAD_Y,
    borderWidth: STOP_BORDER_WIDTH,
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-base"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: "transparent",
    color: colorVars["--honk-color-text-muted"],
    fontFamily: "inherit",
    fontSize: fontVars["--honk-font-size-caption"],
    lineHeight: 1,
    cursor: "pointer",
  },
  preview: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    // Bottom-anchored: overflowing rows extend above the clip, so the newest work stays
    // visible — the presentational stand-in for the app's JS scroll pinning.
    justifyContent: "flex-end",
    gap: conversationVars["--honk-conversation-step-gap"],
    maxHeight: PREVIEW_MAX_HEIGHT,
    overflow: "hidden",
    paddingTop: conversationVars["--honk-conversation-step-gap"],
  },
  previewScrollable: {
    maskImage: PREVIEW_FADE_MASK,
  },
  outputWindow: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end", // tail the output: last lines stay visible
    maxHeight: OUTPUT_STRIP_MAX_HEIGHT,
    overflow: "hidden",
    boxSizing: "border-box",
    paddingInline: conversationVars["--honk-conversation-inset"],
    // Same top fade as the preview: without it the 90px cap slices the first visible mono line
    // mid-glyph, which reads as a rendering bug rather than a tail window. (The app avoids this
    // with JS scroll pinning; the mask is the presentational stand-in's honest equivalent.)
    maskImage: PREVIEW_FADE_MASK,
  },
  output: {
    margin: 0,
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-text-detail"],
    // leading-title = the strip's 18px mono lines — 5 of them make the 90px law cap
    lineHeight: fontVars["--honk-leading-title"],
    color: colorVars["--honk-color-fg-tertiary"],
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "none",
  },
});

// ── Pieces ─────────────────────────────────────────────────────────────────────────────────

interface WorkGroupHeaderProps {
  // The summary verb, in the app's grammar: Explored / Editing… / Ran / "Thought for 4s".
  verb: string;
  // Trailing details ("input.tsx, tokens.ts · 3 searches"), joined to the verb by the app's
  // "·" separator.
  detail?: string | undefined;
  // Diff stats chips, as on edit-heavy groups.
  added?: number | undefined;
  removed?: number | undefined;
  // Running shimmers the verb only — exactly the app's [data-group-loading] > span:first-child.
  isRunning?: boolean | undefined;
  isExpanded?: boolean | undefined;
  onToggle?: (() => void) | undefined;
  // Wires the Stop affordance onto a live group's header (locked §5 delta — see file header).
  onStop?: (() => void) | undefined;
  xstyle?: stylex.StyleXStyles;
}

function Header({
  verb,
  detail,
  added,
  removed,
  isRunning = false,
  isExpanded = false,
  onToggle,
  onStop,
  xstyle,
}: WorkGroupHeaderProps): React.ReactElement {
  const content = (
    <>
      <span {...stylex.props(styles.verb, isRunning && toolCallShimmer)}>{verb}</span>
      {detail !== undefined && (
        <>
          <span aria-hidden={true} {...stylex.props(styles.separator)}>
            ·
          </span>
          <span {...stylex.props(styles.detail)}>{detail}</span>
        </>
      )}
      <DiffStats added={added} removed={removed} />
      {onToggle !== undefined && <ToolCallLineChevron isExpanded={isExpanded} />}
    </>
  );

  return (
    <div {...stylex.props(styles.headerRow, xstyle)}>
      {/* A disclosure only when there is something to disclose (same law as ToolCallLine): no
          onToggle → a plain line, no chevron, no button semantics — a control must do what it
          says (.design principle 6). */}
      {onToggle !== undefined ? (
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={onToggle}
          data-work-group-header=""
          {...stylex.props(styles.headerLine, styles.headerButton)}
        >
          {content}
        </button>
      ) : (
        <div data-work-group-header="" {...stylex.props(styles.headerLine)}>
          {content}
        </div>
      )}
      {onStop !== undefined && (
        <button type="button" onClick={onStop} {...stylex.props(styles.stop)}>
          Stop
        </button>
      )}
    </div>
  );
}

interface WorkGroupPreviewProps {
  children?: React.ReactNode;
  // The caller knows whether content overflows the 144px window (the app tracks it as
  // data-preview-scrollable); true draws the top fade mask.
  isScrollable?: boolean | undefined;
  xstyle?: stylex.StyleXStyles;
}

function Preview({
  children,
  isScrollable = false,
  xstyle,
}: WorkGroupPreviewProps): React.ReactElement {
  return (
    <div
      data-work-group-preview=""
      {...stylex.props(styles.preview, isScrollable && styles.previewScrollable, xstyle)}
    >
      {children}
    </div>
  );
}

interface WorkGroupOutputStripProps {
  // The tailing output text (pre-formatted; newlines preserved).
  children?: React.ReactNode;
  xstyle?: stylex.StyleXStyles;
}

function OutputStrip({ children, xstyle }: WorkGroupOutputStripProps): React.ReactElement {
  return (
    <div {...stylex.props(styles.outputWindow, xstyle)}>
      <pre data-work-preview-output="" {...stylex.props(styles.output)}>
        {children}
      </pre>
    </div>
  );
}

interface WorkGroupProps {
  children?: React.ReactNode;
  // Marks the group live: aria-busy + the data attributes the app exposes. The header's
  // shimmer/Stop are separate props on Header — the container only reports.
  isRunning?: boolean | undefined;
  xstyle?: stylex.StyleXStyles;
}

function WorkGroupRoot({
  children,
  isRunning = false,
  xstyle,
}: WorkGroupProps): React.ReactElement {
  return (
    <div
      data-assistant-work-group=""
      data-work-group-running={isRunning ? "true" : "false"}
      aria-busy={isRunning || undefined}
      {...stylex.props(styles.group, xstyle)}
    >
      {children}
    </div>
  );
}

// The compound: one family, one concept, pieces attached as properties (same idiom as Shell).
const WorkGroup = Object.assign(WorkGroupRoot, { Header, Preview, OutputStrip });

export { WorkGroup };
export type {
  WorkGroupHeaderProps,
  WorkGroupOutputStripProps,
  WorkGroupPreviewProps,
  WorkGroupProps,
};
