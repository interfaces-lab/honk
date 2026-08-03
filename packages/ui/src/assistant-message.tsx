import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, conversationVars, fontVars, motionVars } from "./tokens.stylex";

const styles = stylex.create({
  root: {
    // StyleX 0.19 has no descendant selectors, so the root exposes actions opacity via a private var.
    // Hover is gated to real pointers so touch taps do not reveal actions.
    "--_actions-opacity": {
      default: "0",
      ":focus-within": "1",
      ":hover": { "@media (hover: hover)": "1" },
    },
    position: "relative",
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    paddingInline: conversationVars["--honk-conversation-inset"],
    paddingBlock: 0,
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body-lg"],
    lineHeight: fontVars["--honk-leading-heading"],
    color: colorVars["--honk-color-fg"],
  },
  actions: {
    position: "absolute",
    insetBlockStart: 0,
    insetInlineEnd: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: conversationVars["--honk-conversation-row-gap"],
    opacity: "var(--_actions-opacity, 0)",
    transitionProperty: "opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
});

interface AssistantMessageProps {
  children?: React.ReactNode;
  isStreaming?: boolean | undefined;
  actions?: React.ReactNode | undefined;
  style?: StyleProp<HonkStyle>;
}

function AssistantMessage({
  children,
  isStreaming = false,
  actions,
  style,
}: AssistantMessageProps): React.ReactElement {
  return (
    <div
      // DOM contract name only. Locked law keeps this surface unbubbled.
      data-message-bubble="assistant"
      aria-busy={isStreaming || undefined}
      {...applyStyle(stylex.props(styles.root), style)}
    >
      {children}
      {actions != null && (
        <div data-message-actions="" {...stylex.props(styles.actions)}>
          {actions}
        </div>
      )}
    </div>
  );
}

export { AssistantMessage };
export type { AssistantMessageProps };
