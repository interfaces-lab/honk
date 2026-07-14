// The notice row — a warning/error marker in the work stream: a leading status glyph, a short
// medium-weight NAME, and the message, all painted in the matching status foreground. It renders
// Part kind 'notice' (packages/api/src/core/v1/part.ts: severity 'warning'|'error', name, message).
// Anatomy and tone come from honkkit's StatusNotice/Marker (packages/honkkit/src/marker.tsx): the
// row aligns items to the TOP so the glyph holds the first line when the message wraps, and the
// WHOLE row — glyph included — takes the status colour (the app's `text-warning [&>svg]:text-warning`
// / `text-destructive` tone classes), never a fill.
//
// THE LAW IT OBEYS (locked.html §5): a notice is a QUIET inline row, never a heavy banner — no
// surface, no card, no border. Assistant output is never bubbled, and a system marker keeps the same
// restraint: colour + the type ramp carry the state, so severity is ONE glyph tinted two ways
// (warn-fg vs err-fg), not two different badges. role='alert' for error (assertive, interrupts),
// role='status' for warning (polite) — the marker's own a11y split (marker.tsx:64).
//
// Tokens: --honk-color-warn-fg / --honk-color-err-fg (the tint), the conversation geometry
// (--honk-conversation-inset row inset, --honk-conversation-row-gap for the glyph↔text and
// name↔message gaps), and the prose tier (--honk-text-title / --honk-leading-title, 13/18px — the
// same tier tool-call and status-row sit on). The warn-bg/err-bg fills exist in the vocabulary but
// stay UNUSED here: a banner is the old model; the law says text-first.
//
// Presentational and effect-free (ADR 0025): props in, DOM out. Composes Icon + Text; no state, no
// timers, and no motion — a notice is a still row, so there is deliberately no reduced-motion sibling
// (nothing animates).

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Icon } from "./icon";
import { IconExclamationCircle } from "./icons";
import { Text } from "./text";
import { colorVars, conversationVars, fontVars } from "./tokens.stylex";

// The two severities the 'notice' Part carries (part.ts:127). Warning is a polite advisory
// (role=status); error is an assertive interruption (role=alert).
type NoticeSeverity = "warning" | "error";

// A little vertical breathing room so a single- or multi-line notice registers as a distinct marker
// without a fill. The marker leaned on its generous 22px leading for this air; the conversation tier
// uses the tighter 18px leading, so a 2px pad compensates (the same py-0.5 status-row carries). A
// named intrinsic, not a token — layout air, not a design value the identity round swaps.
const ROW_PAD_Y = "2px";

const styles = stylex.create({
  // The row: a leading glyph + the tinted text, top-aligned so the glyph holds the first line when
  // the message wraps (marker items-start). The whole row takes the status colour — the glyph
  // inherits it through currentColor (Icon tone="current") and the Text inherits it (tone="inherit"),
  // so the severity variant below is the ONE place the tint is set.
  root: {
    display: "flex",
    alignItems: "flex-start",
    gap: conversationVars["--honk-conversation-row-gap"],
    minWidth: 0,
    maxWidth: "100%",
    boxSizing: "border-box",
    paddingInline: conversationVars["--honk-conversation-inset"],
    paddingBlock: ROW_PAD_Y,
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-text-title"],
    lineHeight: fontVars["--honk-leading-title"],
  },
  // Severity = the tint, and only the tint (no fill, no ring — the law: a quiet row, not a banner).
  // color cascades to the glyph (currentColor) and the text (inherit).
  warning: {
    color: colorVars["--honk-color-warn-fg"],
  },
  error: {
    color: colorVars["--honk-color-err-fg"],
  },
  // The message block takes the remaining width and wraps; min-width:0 lets it shrink inside the flex
  // row, and long unbreakable strings (paths, tokens) break instead of overflowing (user-message
  // precedent). Selectable so an error message can be copied even inside a select-none region
  // (marker's select-text).
  content: {
    flexGrow: 1,
    minWidth: 0,
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  // The name leads the message as a medium-weight inline label; one row-gap of space to the message
  // so the two read as one line that wraps naturally.
  name: {
    marginInlineEnd: conversationVars["--honk-conversation-row-gap"],
  },
});

// The variant→style pick happens in JS so the render body stays branch-free (Text/Icon precedent).
const severityStyles: Record<NoticeSeverity, stylex.StyleXStyles> = {
  warning: styles.warning,
  error: styles.error,
};

interface NoticeRowProps {
  severity: NoticeSeverity;
  // The short marker label (part.notice.name), rendered medium-weight, leading the message. Empty or
  // omitted → the message stands alone.
  name?: string | undefined;
  // The notice body. Prefer `children`; `message` mirrors the Part's `message: string` field for a
  // render straight off the atom. `children` wins when both are given.
  message?: string | undefined;
  children?: React.ReactNode;
  // Caller override, merged last (charter merge order).
  xstyle?: stylex.StyleXStyles;
}

function NoticeRow({
  severity,
  name,
  message,
  children,
  xstyle,
}: NoticeRowProps): React.ReactElement {
  // Error interrupts (assertive), warning is polite — the marker's role split (marker.tsx:64).
  const role = severity === "error" ? "alert" : "status";
  // children is the rich slot; message is the plain-string mirror of the Part field.
  const body = children ?? message;

  return (
    <div
      role={role}
      // data-notice mirrors a DOM contract for tests/consumers; data-severity carries the state word.
      // Styling never reads them (the severity STYLE is picked in JS above).
      data-notice=""
      data-severity={severity}
      {...stylex.props(styles.root, severityStyles[severity], xstyle)}
    >
      {/* One glyph for both severities — colour, not a different badge, carries the state (locked §5
          restraint). Decorative: the role + text announce the notice, the glyph reinforces it.
          tone="current" inherits the root's status colour set by the severity variant above. */}
      <Icon icon={IconExclamationCircle} size="lg" tone="current" />
      <Text as="span" size="lg" tone="inherit" xstyle={styles.content}>
        {name !== undefined && name.length > 0 && (
          <Text as="span" size="lg" tone="inherit" weight="medium" xstyle={styles.name}>
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
