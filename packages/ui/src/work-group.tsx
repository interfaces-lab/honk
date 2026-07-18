import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { DiffStats, ToolCallLineChevron, toolCallShimmer } from "./tool-call";
import {
  colorVars,
  controlVars,
  conversationVars,
  fontVars,
  motionVars,
  radiusVars,
} from "./tokens.stylex";

// Preview and output caps are law-fixed, not design tokens. Identity rounds must not swap them.
const PREVIEW_MAX_HEIGHT = "144px";
const OUTPUT_STRIP_MAX_HEIGHT = "90px";
// Fade mask uses black as alpha, not a theme color. The 32px shoulder is surface geometry.
const PREVIEW_FADE_MASK = "linear-gradient(to bottom, rgb(0 0 0 / 0.35) 0, rgb(0 0 0) 32px)";

const styles = stylex.create({
  group: {
    display: "flex",
    flexDirection: "column",
    gap: conversationVars["--honk-conversation-row-gap"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px group vertical breathing room is fixed geometry, no spacing token owns 2px
    paddingBlock: "2px",
    minWidth: 0,
    maxWidth: "100%",
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body-lg"],
    lineHeight: fontVars["--honk-leading-heading"],
  },
  // Disclosure and Stop are siblings because buttons cannot nest. Hover feeds Stop via a private var.
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
  // Locked law. Stop reveals on live-group hover, and on keyboard focus.
  stop: {
    flexShrink: 0,
    opacity: {
      default: "var(--_reveal, 0)",
      ":focus-visible": "1",
    },
    paddingInline: controlVars["--honk-control-pad-sm"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px stop-button vertical padding is fixed geometry, no control/spacing token owns 2px
    paddingBlock: "2px",
    borderWidth: controlVars["--honk-control-border-width"],
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
    // Bottom-anchored so the newest work stays visible without JS scroll pinning.
    justifyContent: "flex-end",
    gap: conversationVars["--honk-conversation-step-gap"],
    maxHeight: PREVIEW_MAX_HEIGHT,
    overflow: "hidden",
    paddingTop: conversationVars["--honk-conversation-step-gap"],
  },
  previewScrollable: {
    // oxlint-disable-next-line honk/design-no-raw-values -- fade mask uses black as an alpha ramp, not a theme color, so no colorVars token applies
    maskImage: PREVIEW_FADE_MASK,
  },
  outputWindow: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    maxHeight: OUTPUT_STRIP_MAX_HEIGHT,
    overflow: "hidden",
    boxSizing: "border-box",
    paddingInline: conversationVars["--honk-conversation-inset"],
    // Top fade so the 90px cap does not slice the first visible mono line mid-glyph.
    // oxlint-disable-next-line honk/design-no-raw-values -- fade mask uses black as an alpha ramp, not a theme color, so no colorVars token applies
    maskImage: PREVIEW_FADE_MASK,
  },
  output: {
    margin: 0,
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-text-title"],
    lineHeight: fontVars["--honk-leading-title"],
    color: colorVars["--honk-color-fg-tertiary"],
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "none",
  },
});

interface WorkGroupHeaderProps {
  verb: string;
  detail?: string | undefined;
  added?: number | undefined;
  removed?: number | undefined;
  isRunning?: boolean | undefined;
  isExpanded?: boolean | undefined;
  onToggle?: (() => void) | undefined;
  onStop?: (() => void) | undefined;
  style?: StyleProp<HonkStyle>;
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
  style,
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
    <div {...applyStyle(stylex.props(styles.headerRow), style)}>
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
  isScrollable?: boolean | undefined;
  style?: StyleProp<HonkStyle>;
}

function Preview({
  children,
  isScrollable = false,
  style,
}: WorkGroupPreviewProps): React.ReactElement {
  return (
    <div
      data-work-group-preview=""
      {...applyStyle(stylex.props(styles.preview, isScrollable && styles.previewScrollable), style)}
    >
      {children}
    </div>
  );
}

interface WorkGroupOutputStripProps {
  children?: React.ReactNode;
  style?: StyleProp<HonkStyle>;
}

function OutputStrip({ children, style }: WorkGroupOutputStripProps): React.ReactElement {
  return (
    <div {...applyStyle(stylex.props(styles.outputWindow), style)}>
      <pre data-work-preview-output="" {...stylex.props(styles.output)}>
        {children}
      </pre>
    </div>
  );
}

interface WorkGroupProps {
  children?: React.ReactNode;
  isRunning?: boolean | undefined;
  style?: StyleProp<HonkStyle>;
}

function WorkGroupRoot({ children, isRunning = false, style }: WorkGroupProps): React.ReactElement {
  return (
    <div
      data-assistant-work-group=""
      data-work-group-running={isRunning ? "true" : "false"}
      aria-busy={isRunning || undefined}
      {...applyStyle(stylex.props(styles.group), style)}
    >
      {children}
    </div>
  );
}

const WorkGroup = Object.assign(WorkGroupRoot, { Header, Preview, OutputStrip });

export { WorkGroup };
export type {
  WorkGroupHeaderProps,
  WorkGroupOutputStripProps,
  WorkGroupPreviewProps,
  WorkGroupProps,
};
