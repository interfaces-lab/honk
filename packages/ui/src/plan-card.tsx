// Assistant plan output. Never a bubble.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Button } from "./button";
import { Icon } from "./icon";
import { IconCheckmark1, IconPencilLine } from "./icons";
import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { Text } from "./text";
import { colorVars, conversationVars, fontVars } from "./tokens.stylex";

const IMPLEMENTED_OPACITY = 0.7;

const styles = stylex.create({
  card: {
    "--_reveal": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
      ":focus-within": "1",
    },
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
  // Implemented = a settled plan recedes a touch. Opacity only. No surface or bubble change.
  implemented: {
    opacity: IMPLEMENTED_OPACITY,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: conversationVars["--honk-conversation-row-gap"],
    minWidth: 0,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: conversationVars["--honk-conversation-step-gap"],
    minWidth: 0,
  },
  marker: {
    display: "inline-flex",
    alignItems: "center",
    gap: conversationVars["--honk-conversation-row-gap"],
    flexShrink: 0,
    color: colorVars["--honk-color-fg-tertiary"],
  },
  body: {
    minWidth: 0,
    overflowWrap: "anywhere",
  },
});

const forward = {
  title: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  summary: { color: colorVars["--honk-color-fg-secondary"] },
  editReveal: { opacity: "var(--_reveal, 0)" },
} satisfies Record<string, HonkStyle>;

interface PlanCardProps {
  title: string;
  children?: React.ReactNode;
  summary?: string | undefined;
  onEdit?: (() => void) | undefined;
  implemented?: boolean | undefined;
  style?: StyleProp<HonkStyle>;
}

function PlanCard({
  title,
  children,
  summary,
  onEdit,
  implemented = false,
  style,
}: PlanCardProps): React.ReactElement {
  return (
    <div
      data-proposed-plan-message=""
      data-plan-implemented={implemented ? "" : undefined}
      {...applyStyle(stylex.props(styles.card, implemented && styles.implemented), style)}
    >
      <div {...stylex.props(styles.header)}>
        <div {...stylex.props(styles.titleRow)}>
          <Text size="lg" weight="semibold" tone="inherit" truncate style={forward.title}>
            {title}
          </Text>
          {implemented && (
            <span {...stylex.props(styles.marker)}>
              <Icon icon={IconCheckmark1} size="xs" />
              <Text size="sm" tone="inherit">
                Implemented
              </Text>
            </span>
          )}
          {onEdit !== undefined && (
            <Button
              variant="quiet"
              size="sm"
              onClick={onEdit}
              iconStart={<Icon icon={IconPencilLine} size="sm" />}
              style={forward.editReveal}
            >
              Edit
            </Button>
          )}
        </div>
        {summary !== undefined && (
          <Text as="p" size="sm" tone="inherit" truncate style={forward.summary}>
            {summary}
          </Text>
        )}
      </div>
      {children != null && <div {...stylex.props(styles.body)}>{children}</div>}
    </div>
  );
}

export { PlanCard };
export type { PlanCardProps };
