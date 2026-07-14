// The assistant message — the conversation's DOMINANT row: the agent's prose reply. This is the
// one surface the locked thread law is loudest about (locked.html §5: "Assistant output is never a
// bubble" — user messages are the ONLY bubbled element). So there is deliberately NO surface here:
// no card, no border, no fill. The reply is TEXT-FIRST and full-width, and its hierarchy is carried
// entirely by the conversation type ramp (fg → fg-secondary → fg-tertiary), never by a container.
// Renders Part kind "text", role "assistant" (packages/api/src/core/v1/part.ts).
//
// Anatomy ported from the app's assistant branch (packages/honkkit/src/conversation-bubble.tsx
// assistantBody + packages/app/src/styles/conversation.css [data-assistant-transcript-row]),
// flattened into one element the way status-row flattened its wrapper + ChatLoader:
//   • prose tier = the conversation "title" step (13px / 18px) — the app's --conversation-text-
//     font-size / --conversation-text-leading, which conversation.css resolves to --honk-text-title
//     / --honk-leading-title. The spec named --honk-font-size-body and --honk-leading-conversation;
//     the first is the CHROME ramp's 13px twin and the second is not a real token — the prose ramp's
//     title step is the identical 13/18 and is what all four conversation leaves use, so the whole
//     never-bubbled surface stays on one ramp (the spec's --honk-leading-body fallback would have
//     been the WRONG 16px body leading it warned against).
//   • primary tone = the conversation ramp's base, --honk-color-fg — the 100% rung above fg-
//     secondary/-tertiary. Identical value to the spec's --honk-color-text-primary, but fg keeps
//     the surface deriving from the one conversation foreground the sibling leaves already use.
//   • the 11px leading inset every row carries (conversation.css padding-inline; the tool/work/
//     status rows own it too, since there are no descendant selectors here). Vertical rhythm
//     between messages stays the caller's timeline concern — paddingBlock 0, exactly like the tool
//     line (the app's 0.8rem/0.4rem transcript insets are composition, not the atom).
//
// Presentational and effect-free (ADR 0025): props in, DOM out. The prose arrives already rendered
// as `children` (the app's markdown engine paints it; this leaf only styles the container — it
// never parses markdown). Streaming, elapsed time, and answer state are ALL the caller's: `is
// Streaming` is a prop the app owns, never a timer or state computed here.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { colorVars, conversationVars, fontVars, motionVars } from "./tokens.stylex";

// ── Caret intrinsics (justified per the stylex skill) ──────────────────────────────────────────
// The streaming caret's fixed geometry — a thin text-cursor bar. Private, like user-message's
// bubble metrics; these are LAW-FIXED, not identity vocabulary, so named consts, never tokens
// (work-group precedent: tokens are what the identity round swaps, law never drifts).
const CARET_WIDTH = "2px"; // a thin bar, reads as a text cursor beside the 13px prose
const CARET_HEIGHT = "1em"; // tracks the prose's own height (icon.tsx's GLYPH_SIZE precedent)
const CARET_GAP = "1px"; // sits tight after the last glyph, like a typing cursor
const CARET_RADIUS = "1px"; // soften the bar's ends
// The blink cadence: ~1s is the conventional text-cursor period — a LIVENESS intrinsic (like the
// shimmer's 2s pass), NOT one of the sourced motion durations and independent of the spinner's own
// 900ms cadence, so it stays a named const rather than borrowing a token it would drift with.
const CARET_BLINK_PERIOD = "1s";

// One blink cycle: full-strength at the ends, extinguished at the midpoint — a soft symmetric pulse
// (linear, matching the family's other liveness sweeps) rather than a hard terminal flicker, the
// calmer register for a chat stream.
const caretBlink = stylex.keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: 0 },
  "100%": { opacity: 1 },
});

const styles = stylex.create({
  root: {
    // The message-actions reveal, via parent-sets-a-var (StyleX 0.19 has no descendant selectors,
    // so the app's ":hover [data-message-actions] { opacity: 1 }" becomes a private channel the
    // root flips and the seam reads). Hover is gated @media (hover: hover) so a touch tap never
    // reveals it; :focus-within reveals on keyboard focus everywhere — both mirror the app's
    // assistantBody :hover / :focus-within rules exactly.
    "--_actions-opacity": {
      default: "0",
      ":focus-within": "1",
      ":hover": { "@media (hover: hover)": "1" },
    },
    position: "relative",
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    // The 11px conversation leading inset; vertical rhythm is the caller's timeline (paddingBlock 0,
    // like the tool line — see the file header).
    paddingInline: conversationVars["--honk-conversation-inset"],
    paddingBlock: 0,
    fontFamily: fontVars["--honk-font-family-ui"],
    // The conversation prose tier (13/18) and its primary tone — see the file header for why these
    // are the title/fg ramp, not the chrome ramp the spec named.
    fontSize: fontVars["--honk-text-title"],
    lineHeight: fontVars["--honk-leading-title"],
    color: colorVars["--honk-color-fg"],
  },
  // The streaming caret: a thin bar that blinks while the app reports the turn is still generating.
  // Pure CSS — the app owns WHEN (the isStreaming prop), never a timer here.
  caret: {
    display: "inline-block",
    width: CARET_WIDTH,
    height: CARET_HEIGHT,
    marginInlineStart: CARET_GAP,
    verticalAlign: "text-bottom",
    borderRadius: CARET_RADIUS,
    backgroundColor: colorVars["--honk-color-fg"],
    // Reduced motion holds the bar steady and lit: animation removed → the base opacity 1 shows, an
    // honest still caret marking the end of the stream (no blink).
    opacity: 1,
    animationName: {
      default: caretBlink,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: CARET_BLINK_PERIOD,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  // The reserved message-actions seam (the app's [data-message-actions]): pinned top-right, so it
  // overlays the prose corner without reserving column width, and revealed by the root's private
  // var above. Opacity-only, exactly like the app (StyleX 0.19 also cannot type a var() onto
  // pointer-events; this is a desktop hover surface, so hover/focus reveal is the whole contract).
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
  // The app's already-rendered prose (its markdown engine's output). This leaf only styles the
  // container to the conversation tier — it never parses or renders markdown itself.
  children?: React.ReactNode;
  // The app's streaming flag: true appends the blinking caret. The app owns WHEN a turn is live
  // (ADR 0025 — no streaming state, timers, or elapsed-time computed here).
  isStreaming?: boolean | undefined;
  // The reserved message-actions seam (copy / edit / retry …): caller-supplied controls, pinned
  // top-right and revealed on row hover or keyboard focus. The controls are the caller's — this
  // leaf owns only the placement and the reveal.
  actions?: React.ReactNode | undefined;
  // Caller override on the row, merged last (charter merge order).
  xstyle?: stylex.StyleXStyles;
}

function AssistantMessage({
  children,
  isStreaming = false,
  actions,
  xstyle,
}: AssistantMessageProps): React.ReactElement {
  return (
    <div
      // The app's DOM contract for the assistant turn (conversation-bubble.tsx
      // data-message-bubble="assistant") — a contract NAME, not a bubble; this surface is never
      // bubbled (locked §5). Styling here never reads it. aria-busy marks the turn live for
      // assistive tech while it streams (work-group's aria-busy precedent).
      data-message-bubble="assistant"
      aria-busy={isStreaming || undefined}
      {...stylex.props(styles.root, xstyle)}
    >
      {children}
      {isStreaming && (
        <span aria-hidden={true} data-streaming-caret="" {...stylex.props(styles.caret)} />
      )}
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
