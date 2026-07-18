// Quiet inline notice. No banner fill.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Icon } from "./icon";
import { IconExclamationCircle } from "./icons";
import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { Text } from "./text";
import { colorVars, conversationVars, fontVars } from "./tokens.stylex";

// role=status for warning. role=alert for error.
type NoticeSeverity = "warning" | "error";

const styles = stylex.create({
  root: {
    display: "flex",
    alignItems: "flex-start",
    gap: conversationVars["--honk-conversation-row-gap"],
    minWidth: 0,
    maxWidth: "100%",
    boxSizing: "border-box",
    paddingInline: conversationVars["--honk-conversation-inset"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px optical top/bottom nudge to align the notice glyph baseline; no spacing token owns this sub-grid value
    paddingBlock: "2px",
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-text-title"],
    lineHeight: fontVars["--honk-leading-title"],
  },
  warning: {
    color: colorVars["--honk-color-warn-fg"],
  },
  error: {
    color: colorVars["--honk-color-err-fg"],
  },
});

const forward = {
  content: {
    flexGrow: 1,
    minWidth: 0,
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  name: {
    marginInlineEnd: conversationVars["--honk-conversation-row-gap"],
  },
} satisfies Record<string, HonkStyle>;

const severityStyles: Record<NoticeSeverity, stylex.StyleXStyles> = {
  warning: styles.warning,
  error: styles.error,
};

interface NoticeRowProps {
  severity: NoticeSeverity;
  name?: string | undefined;
  message?: string | undefined;
  children?: React.ReactNode;
  style?: StyleProp<HonkStyle>;
}

function NoticeRow({
  severity,
  name,
  message,
  children,
  style,
}: NoticeRowProps): React.ReactElement {
  const role = severity === "error" ? "alert" : "status";
  const body = children ?? message;

  return (
    <div
      role={role}
      data-notice=""
      data-severity={severity}
      {...applyStyle(stylex.props(styles.root, severityStyles[severity]), style)}
    >
      {/* One glyph for both severities — colour, not a different badge, carries the state (locked §5
          restraint). Decorative: the role + text announce the notice, the glyph reinforces it.
          tone="current" inherits the root's status colour set by the severity variant above. */}
      <Icon icon={IconExclamationCircle} size="lg" tone="current" />
      <Text as="span" size="lg" tone="inherit" style={forward.content}>
        {name !== undefined && name.length > 0 && (
          <Text as="span" size="lg" tone="inherit" weight="regular" style={forward.name}>
            {name}
          </Text>
        )}
        {body}
      </Text>
    </div>
  );
}

export { NoticeRow };
export type { NoticeRowProps, NoticeSeverity };
