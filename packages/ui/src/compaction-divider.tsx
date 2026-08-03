// Settled meta-history divider. Text-first, no animation.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Icon } from "./icon";
import { IconArchive1 } from "./icons";
import { Separator } from "./separator";
import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { Text } from "./text";
import { colorVars, conversationVars, fontVars } from "./tokens.stylex";

const styles = stylex.create({
  root: {
    display: "flex",
    alignItems: "center",
    gap: conversationVars["--honk-conversation-row-gap"],
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    paddingInline: conversationVars["--honk-conversation-inset"],
    paddingBlock: 0,
    minHeight: conversationVars["--honk-conversation-row-min-h"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-text-detail"],
    lineHeight: fontVars["--honk-leading-detail"],
    userSelect: "none",
  },
  label: {
    display: "inline-flex",
    alignItems: "center",
    gap: conversationVars["--honk-conversation-row-gap"],
    minWidth: 0,
  },
  dot: {
    flexShrink: 0,
    color: colorVars["--honk-color-text-faint"],
  },
});

const forward = {
  rule: { flexGrow: 1, flexBasis: 0, minWidth: 0 },
  summary: { minWidth: 0, flexShrink: 1 },
  count: { flexShrink: 0, whiteSpace: "nowrap" },
} satisfies Record<string, HonkStyle>;

interface CompactionDividerProps {
  summary: string;
  tokensBefore?: number | undefined;
  style?: StyleProp<HonkStyle>;
}

function CompactionDivider({
  summary,
  tokensBefore,
  style,
}: CompactionDividerProps): React.ReactElement {
  return (
    <div data-slot="compaction-divider" {...applyStyle(stylex.props(styles.root), style)}>
      <Separator style={forward.rule} />
      <span {...stylex.props(styles.label)}>
        {/* A small decorative glyph naming the divider's kind — not a status badge (the surface
            forbids those); it just marks "this is a compaction". Decorative → aria-hidden by Icon. */}
        <Icon icon={IconArchive1} size="xs" tone="faint" />
        <Text size="sm" tone="muted" truncate style={forward.summary}>
          {summary}
        </Text>
        {tokensBefore !== undefined && (
          <>
            <span aria-hidden={true} {...stylex.props(styles.dot)}>
              ·
            </span>
            <Text size="sm" tone="faint" tabularNums style={forward.count}>
              {tokensBefore.toLocaleString()} tokens compacted
            </Text>
          </>
        )}
      </span>
      <Separator style={forward.rule} />
    </div>
  );
}

export { CompactionDivider };
export type { CompactionDividerProps };
