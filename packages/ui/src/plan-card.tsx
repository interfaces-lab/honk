// Assistant plan output. Never a bubble.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { Text } from "./text";
import { colorVars, conversationVars, fontVars } from "./tokens.stylex";

const styles = stylex.create({
  card: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: conversationVars["--honk-conversation-step-gap"],
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    paddingInline: conversationVars["--honk-conversation-inset"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-text-title"],
    lineHeight: fontVars["--honk-leading-title"],
    color: colorVars["--honk-color-fg"],
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: conversationVars["--honk-conversation-row-gap"],
    minWidth: 0,
  },
  titleRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: conversationVars["--honk-conversation-step-gap"],
    minWidth: 0,
  },
  body: {
    minWidth: 0,
    overflowWrap: "anywhere",
  },
});

const forward = {
  title: { flexGrow: 1, flexShrink: 1, minWidth: 0, overflowWrap: "anywhere" },
  summary: { overflowWrap: "anywhere" },
} satisfies Record<string, HonkStyle>;

interface PlanCardProps {
  title: string;
  children?: React.ReactNode;
  summary?: string | undefined;
  action?: React.ReactNode;
  style?: StyleProp<HonkStyle>;
}

function PlanCard({ title, children, summary, action, style }: PlanCardProps): React.ReactElement {
  return (
    <div {...applyStyle(stylex.props(styles.card), style)}>
      <div {...stylex.props(styles.header)}>
        <div {...stylex.props(styles.titleRow)}>
          <Text size="lg" weight="semibold" tone="inherit" style={forward.title}>
            {title}
          </Text>
          {action}
        </div>
        {summary !== undefined && (
          <Text as="p" size="base" tone="muted" style={forward.summary}>
            {summary}
          </Text>
        )}
      </div>
      {children != null && <div {...stylex.props(styles.body)}>{children}</div>}
    </div>
  );
}

export { PlanCard };
