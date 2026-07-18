// Thinking body uses fg-tertiary, the dimmest prose rung. Streaming caret stays currentColor so it
// never outshines the prose.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { Text } from "./text";
import { colorVars, conversationVars, fontVars, motionVars } from "./tokens.stylex";

const caretPulse = stylex.keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: 0.2 },
  "100%": { opacity: 1 },
});

const styles = stylex.create({
  root: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: conversationVars["--honk-conversation-row-gap"],
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    paddingInline: conversationVars["--honk-conversation-inset"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px row inset is fixed geometry, no spacing token owns it
    paddingBlock: "2px",
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-text-title"],
    lineHeight: fontVars["--honk-leading-title"],
    color: colorVars["--honk-color-fg-tertiary"],
  },
  prose: {
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  caret: {
    display: "inline-block",
    width: "1.5px",
    height: fontVars["--honk-text-title"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px caret nudge is fixed geometry, no spacing token owns it
    marginInlineStart: "1px",
    verticalAlign: "middle",
    backgroundColor: "currentColor",
    animationName: {
      default: caretPulse,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: motionVars["--honk-motion-duration-shimmer"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});

const forward = {
  label: { margin: 0 },
} satisfies Record<string, HonkStyle>;

// Streaming caret is decorative (aria-hidden).
function StreamingCaret(): React.ReactElement {
  return <span aria-hidden={true} data-streaming-caret="" {...stylex.props(styles.caret)} />;
}

interface ReasoningBlockProps {
  children?: React.ReactNode;
  label?: string | undefined;
  isStreaming?: boolean | undefined;
  style?: StyleProp<HonkStyle>;
}

function ReasoningBlock({
  children,
  label,
  isStreaming = false,
  style,
}: ReasoningBlockProps): React.ReactElement {
  return (
    <div
      data-runtime-thinking=""
      data-runtime-thinking-streaming={isStreaming ? "true" : undefined}
      {...applyStyle(stylex.props(styles.root), style)}
    >
      {label !== undefined && (
        <Text as="p" size="xs" tone="muted" tabularNums={true} truncate={true} style={forward.label}>
          {label}
        </Text>
      )}
      <div {...stylex.props(styles.prose)}>
        {children}
        {isStreaming && <StreamingCaret />}
      </div>
    </div>
  );
}

export { ReasoningBlock };
export type { ReasoningBlockProps };
