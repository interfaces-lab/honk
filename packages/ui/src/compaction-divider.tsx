// The compaction divider — the thread's "older context was summarized here" marker: a full-width
// hairline rule split by a quiet centered caption ("Summarized 42 earlier messages · 128,000 tokens
// compacted"). Renders Part kind `compaction` (packages/api/src/core/v1/part.ts:119-123 — summary:
// string, tokensBefore?: number). GREENFIELD: no app renderer exists yet, so the anatomy is built
// from that schema plus the locked wireframes' bare intent (§5, "a visible divider") — there is no
// app DOM contract to port, only the surface's hard laws to obey.
//
// THE LAW IT OBEYS (locked.html §5): assistant history is NEVER a bubble. A compaction is
// meta-history — quieter even than a tool row — so it is text-first: muted/faint tones only, no
// surface, no card, no border. Hierarchy is carried entirely by the type ramp (summary = text-muted,
// count = text-faint) and the two flanking hairline rules, never a container. And there is no status
// badge and no liveness: a compaction is always settled, so — like the Separator primitive it
// composes — this leaf deliberately has NO shimmer, NO keyframe, and therefore NO reduced-motion
// sibling to write (a divider never animates).
//
// Presentational and effect-free (ADR 0025): summary + tokensBefore are the CALLER's props; a long
// summary truncates to a single quiet line (it never wraps — a wrapping divider reads as broken),
// exactly as ToolCallLine's detail truncates. Composes the already-ported primitives instead of
// re-authoring: Separator (the rule, one per flank), Text (the muted summary + the faint tabular
// count), Icon (a small decorative archive glyph naming the divider's kind). Tokens:
// conversation-inset / -row-gap / -row-min-h carry the row rhythm shared with the rest of the
// family; the text-muted / text-faint prose ramp carries tone; border-muted (Separator's default)
// draws the hairline.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Icon } from "./icon";
import { IconArchive1 } from "./icons";
import { Separator } from "./separator";
import { Text } from "./text";
import { colorVars, conversationVars, fontVars } from "./tokens.stylex";

const styles = stylex.create({
  // The divider is a full-width row sharing the conversation rhythm: the same 11px text inset and
  // 24px min-height every tool/status row carries, so it seats cleanly in the timeline column. No
  // vertical margin — the timeline's own row gap owns the spacing above and below (family idiom).
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
    // family-ui + the quiet detail tier (11/14): a compaction is meta-chrome, a step below the
    // conversation title tier the message rows sit on. The Text children pick their own size; this
    // sizes the bare "·" separator glyph between summary and count.
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-text-detail"],
    lineHeight: fontVars["--honk-leading-detail"],
    // A settled marker, not prose — non-selectable like the tool/work chrome rows.
    userSelect: "none",
  },
  // Each flanking hairline grows to fill its side of the centered label. flexBasis 0 + flexGrow 1
  // overrides Separator's own width:100% (its main size becomes free-space-driven, so two rules plus
  // a label share the row cleanly); Separator keeps its 1px height + border-muted fill.
  rule: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  // The centered caption cluster: content-width (flexGrow 0) so the rules take the slack, but able to
  // shrink (minWidth 0) so a long summary can truncate rather than push the rules off the row.
  label: {
    display: "inline-flex",
    alignItems: "center",
    gap: conversationVars["--honk-conversation-row-gap"],
    minWidth: 0,
  },
  // The summary is the one shrinkable piece of the cluster; the icon and the count stay pinned.
  summary: {
    minWidth: 0,
    flexShrink: 1,
  },
  // The "·" between summary and count — pinned faint, never shrinks (mirrors work-group's separator
  // dot). Inherits the detail-tier size from the root.
  dot: {
    flexShrink: 0,
    color: colorVars["--honk-color-text-faint"],
  },
  // "N tokens compacted" — pinned faint + tabular so the digits align; never shrinks or wraps.
  count: {
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
});

interface CompactionDividerProps {
  // The compaction summary — what the summarized-away context was about ("Summarized 42 earlier
  // messages about the auth refactor"). part.ts compaction.summary; rendered muted. A long one
  // truncates to a single quiet line (ellipsis), never wraps.
  summary: string;
  // Optional context size before the compaction (part.ts compaction.tokensBefore, a NonNegativeInt).
  // When present it shows faint + tabular as "N tokens compacted"; gated on `!== undefined`, the same
  // presence check ToolCallLine uses for its detail.
  tokensBefore?: number | undefined;
  // Caller override on the divider row, merged last (charter merge order).
  xstyle?: stylex.StyleXStyles;
}

function CompactionDivider({
  summary,
  tokensBefore,
  xstyle,
}: CompactionDividerProps): React.ReactElement {
  return (
    // data-slot is the test/consumer hook (no app contract exists to mirror yet); styling here never
    // reads it — the surface is StyleX-only.
    <div data-slot="compaction-divider" {...stylex.props(styles.root, xstyle)}>
      <Separator xstyle={styles.rule} />
      <span {...stylex.props(styles.label)}>
        {/* A small decorative glyph naming the divider's kind — not a status badge (the surface
            forbids those); it just marks "this is a compaction". Decorative → aria-hidden by Icon. */}
        <Icon icon={IconArchive1} size="xs" tone="faint" />
        <Text size="sm" tone="muted" truncate xstyle={styles.summary}>
          {summary}
        </Text>
        {tokensBefore !== undefined && (
          <>
            <span aria-hidden={true} {...stylex.props(styles.dot)}>
              ·
            </span>
            <Text size="sm" tone="faint" tabularNums xstyle={styles.count}>
              {tokensBefore.toLocaleString()} tokens compacted
            </Text>
          </>
        )}
      </span>
      <Separator xstyle={styles.rule} />
    </div>
  );
}

export { CompactionDivider };
export type { CompactionDividerProps };
