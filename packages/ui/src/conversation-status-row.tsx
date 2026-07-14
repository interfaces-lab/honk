// The conversation status row — the render target for a Part kind 'custom'/extension row (the app's
// RuntimeExtensionUiRequestMessage: "Waiting for approval" · "Answered …"), and the general
// "a step is live" row: a leading glyph + a label + an optional detail. Anatomy and values ported
// from honkkit's ConversationStatusRow (packages/honkkit/src/conversation-status-row.tsx): the row
// is top-aligned (items-start) so a 14px glyph seats on the FIRST line of a wrapping label (a 2px
// top nudge), an 8px glyph→text gap, the conversation title tier (13/18), and the fg ramp carrying
// the whole hierarchy — label fg-primary, detail fg-tertiary, the resting glyph icon-tertiary.
//
// THE LAW (locked.html §5). Assistant output is NEVER a bubble: this row is text-first and
// full-width, no surface/card/border. Hierarchy is the fg type ramp, never a container. And there
// is NO status-icon badge — the leading glyph is the step's own identity, and "live" is carried by
// color + motion (an accent-toned glyph + the label shimmer), not a badge of state icons. Distinct
// from status-row.tsx, which is the between-steps waiting PULSE (a mask-swept, icon-less label);
// THIS is an icon+label+detail content row for a custom/extension step.
//
// Presentational and effect-free (ADR 0025): active/label/detail are all props — the leaf never
// computes elapsed time, streaming, or the "Waiting…/Answered…" label swap (the app resolves that
// from request.status and passes the finished string). Three deltas from the app reference:
//   • ACTIVE tones the leading glyph accent (the app's text-honk-icon-accent-primary) and shimmers
//     the LABEL with the shared toolCallShimmer (imported from ./tool-call), which carries its own
//     prefers-reduced-motion still-fallback. The app ALSO drops that shimmer on the icon span, but
//     background-clip:text cannot paint an SVG (it would blank the currentColor strokes), so here
//     the glyph takes only the accent tone and the label owns the shimmer — the honest split.
//     Active is an attention/pending state ("waiting for you"), so it reads as accent, deliberately
//     NOT a working-only spinner planted over a meaningful glyph.
//   • When the caller gives NO glyph but marks the row active (the bare "a step is happening"
//     case), the leading slot falls back to a <Spinner> (honk's liveness motion, tokens §Motion:
//     "liveness (shimmer/spin)") so a live row is never an unmarked line. Icon and Spinner share
//     the 14px size="sm" slot, so the fallback never shifts the label (Spinner's box-sizing note).
//   • This row owns NO conversation-inset or min-height (unlike tool-call.tsx): the app's
//     ConversationStatusRow carries neither — it sits inside an already-inset container — so a
//     top-level timeline placement supplies the inset through xstyle.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Icon, type Glyph } from "./icon";
import { Spinner } from "./spinner";
import { toolCallShimmer } from "./tool-call";
import { colorVars, fontVars } from "./tokens.stylex";

// ── Row intrinsics (justified per the stylex skill; the app's exact interior numbers) ──────────
// The glyph→text gap: gap-2 on the app's row. Wider than the inline conversation row-gap (4px) on
// purpose — the leading glyph is a list-marker-style lead-in, not an inline chip. No conversation
// token is 8px, so it is a named intrinsic like user-message.tsx's BUBBLE_* numbers.
const ICON_GAP = "8px";
// mt-0.5 on the glyph slot: with the row top-aligned (items-start), this seats the 14px glyph on
// the first text line's cap height instead of centering it across a multi-line label.
const LEAD_TOP_NUDGE = "2px";
// mt-0.5 on the detail: its top offset below the label.
const DETAIL_GAP = "2px";

const styles = stylex.create({
  root: {
    display: "flex",
    // items-start: the glyph aligns to the FIRST label line (a wrapping label grows downward), not
    // centered across the whole block — paired with the glyph slot's 2px top nudge.
    alignItems: "flex-start",
    gap: ICON_GAP,
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    fontFamily: fontVars["--honk-font-family-ui"],
    // text-conversation = the prose title tier (13/18); label + detail inherit size/leading from here.
    fontSize: fontVars["--honk-text-title"],
    lineHeight: fontVars["--honk-leading-title"],
    // The base tone; the label promotes to fg-primary and the detail demotes to fg-tertiary below,
    // so this fg-secondary is the honest fallback rather than a color any child actually shows.
    color: colorVars["--honk-color-fg-secondary"],
  },
  // Leading-indicator slot: the resting glyph (identity) or, for an icon-less active row, the
  // Spinner (liveness). shrink-0 + the top nudge; color feeds the resting Icon's tone="current"
  // (icon-tertiary), while an active Icon overrides to accent and the Spinner paints its own tone.
  lead: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: LEAD_TOP_NUDGE,
    color: colorVars["--honk-color-icon-tertiary"],
  },
  // The label/detail column — grows to fill (flex-1) with min-w-0 so long tokens wrap inside it
  // instead of forcing the row wide.
  content: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  // The label: fg-primary, medium weight, wraps anywhere (long unbroken step names still break).
  // Inherits the title size/leading + ui family from the root. When active, toolCallShimmer is
  // merged AFTER, so its transparent shine-fill (and its reduced-motion still-fallback) win the color.
  label: {
    display: "block",
    minWidth: 0,
    fontWeight: fontVars["--honk-font-weight-medium"],
    color: colorVars["--honk-color-fg"],
    overflowWrap: "anywhere",
  },
  // The detail: fg-tertiary, one 2px step under the label, newlines preserved (pre-wrap) and long
  // tokens broken (wrap-anywhere). Inherits size/family from the root.
  detail: {
    display: "block",
    marginTop: DETAIL_GAP,
    minWidth: 0,
    color: colorVars["--honk-color-fg-tertiary"],
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
});

interface ConversationStatusRowProps {
  // The step's identifying glyph (an extension's mark — the app passes a question bubble), rendered
  // at rest in icon-tertiary and promoted to accent while active. Optional: an icon-less row is just
  // label + detail, and an icon-less ACTIVE row leads with a Spinner instead.
  icon?: Glyph | undefined;
  // The step label — the one required piece ("Waiting for approval"). Shimmers while active. A
  // string so it stays plain text the shimmer can paint and a screen reader can read.
  label: string;
  // Secondary detail under the label (fg-tertiary; newlines preserved).
  detail?: string | undefined;
  // Live flag: tones the leading glyph accent (or shows the Spinner fallback) and shimmers the
  // label. Caller-owned (ADR 0025) — this leaf never computes it, and never swaps the label text.
  active?: boolean | undefined;
  // Caller override on the row, merged last (charter merge order).
  xstyle?: stylex.StyleXStyles;
}

function ConversationStatusRow({
  icon,
  label,
  detail,
  active = false,
  xstyle,
}: ConversationStatusRowProps): React.ReactElement {
  // The leading indicator: the caller's glyph when given (accent while active, icon-tertiary at
  // rest); otherwise, only while active, a Spinner so a live icon-less row is never an unmarked
  // line. Both are size="sm" (14px), so the icon↔spinner choice holds the slot geometry.
  const lead =
    icon !== undefined ? (
      <Icon icon={icon} size="sm" tone={active ? "accent" : "current"} />
    ) : active ? (
      <Spinner size="sm" tone="accent" />
    ) : null;

  return (
    // data-slot mirrors the app's DOM contract; data-active carries the state for tests/consumers.
    // Styling never reads either — the row is styled entirely through the stylex classes.
    <div
      data-slot="conversation-status-row"
      data-active={active ? "true" : "false"}
      {...stylex.props(styles.root, xstyle)}
    >
      {lead !== null && (
        <span data-slot="conversation-status-row-icon" {...stylex.props(styles.lead)}>
          {lead}
        </span>
      )}
      <div data-slot="conversation-status-row-content" {...stylex.props(styles.content)}>
        <span
          data-slot="conversation-status-row-label"
          {...stylex.props(styles.label, active && toolCallShimmer)}
        >
          {label}
        </span>
        {detail !== undefined && (
          <span data-slot="conversation-status-row-detail" {...stylex.props(styles.detail)}>
            {detail}
          </span>
        )}
      </div>
    </div>
  );
}

export { ConversationStatusRow };
export type { ConversationStatusRowProps };
