// Thinking body uses fg-tertiary, the dimmest prose rung. Streaming caret stays currentColor so it
// never outshines the prose.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { Text } from "./text";
import { colorVars, conversationVars, fontVars } from "./tokens.stylex";

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
    fontSize: fontVars["--honk-font-size-body-lg"],
    lineHeight: fontVars["--honk-leading-heading"],
    color: colorVars["--honk-color-fg-tertiary"],
  },
  prose: {
    minWidth: 0,
    overflowWrap: "anywhere",
  },
});

const forward = {
  label: { margin: 0 },
} satisfies Record<string, HonkStyle>;

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
        <Text
          as="p"
          size="xs"
          tone="muted"
          tabularNums={true}
          truncate={true}
          style={forward.label}
        >
          {label}
        </Text>
      )}
      <div {...stylex.props(styles.prose)}>{children}</div>
    </div>
  );
}

export { ReasoningBlock };
export type { ReasoningBlockProps };
