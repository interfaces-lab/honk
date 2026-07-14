// The reasoning block — the model's thinking, rendered TEXT-FIRST and dimmer than assistant
// prose (locked.html §5 "Assistant output is never a bubble": agent prose, work, and thinking are
// full-width text, never a card — hierarchy is the fg ramp, never a container). This leaf renders
// Part kind 'reasoning' (packages/api/src/core/v1/part.ts — a plain-text arm); the port source is
// the app's RuntimeThinkingStepRenderer (packages/app/src/components/chat/timeline/step-renderer.tsx),
// whose DOM contract (data-runtime-thinking / -streaming) is mirrored verbatim.
//
// THE DIMMEST PROSE RUNG. The thinking body takes --honk-color-fg-tertiary (54% fg — the app's
// `text-honk-fg-tertiary` on [data-runtime-thinking]), one step below assistant prose's
// fg-secondary: thinking is the quietest text on the surface. (There is no --honk-color-text-tertiary;
// fg-tertiary is the dimmest prose rung.) Geometry is the conversation row's own — the 11px inset the
// app applies via scope CSS ([data-runtime-thinking] { padding-inline: --conversation-text-inset })
// is owned here instead, since StyleX 0.19 has no descendant selectors (same as tool-call.tsx) — at
// the conversation title type tier (13px/18px), with the app's py-0.5 block padding.
//
// THE LABEL is an optional quiet caption lead-in ("Thought for 4s") — NOT the collapsed thinking
// header (that is work-group's job); here it is just a muted caption line above the prose. It
// composes <Text> at the caption tier in tone="muted" with tabular-nums, because the app renders
// "Thought for X" with tabular-nums so the counting duration never jitters.
//
// THE STREAMING CARET is the locked board's one caret idiom (locked.html §.omni .q .caret: an
// inline-block bar) turned into a liveness marker — a hairline bar that breathes on honk's 2s
// shimmer tempo (the package's established liveness duration, shared by tool-call's shine and
// status-row's mask sweep), painting a SOLID STILL bar under prefers-reduced-motion. It takes the
// prose currentColor (fg-tertiary), NOT the omnibox caret's accent, so the streaming marker never
// outshines the dimmest prose on the surface. It trails the rendered prose; exact inline seating
// follows the caller's markdown flow (this leaf only styles the container).
//
// Presentational and effect-free (ADR 0025): children in (the app's markdown engine renders the
// thinking prose — this leaf only styles the container), DOM out. isStreaming / label / elapsed
// time are ALL the caller's; this leaf computes none of them.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Text } from "./text";
import { colorVars, conversationVars, fontVars, motionVars } from "./tokens.stylex";

// ── Intrinsics (justified per the stylex skill) ─────────────────────────────────────────────
const ROW_PAD_Y = "2px"; // py-0.5 on the app's RuntimeThinkingStepRenderer wrapper (step-renderer.tsx)
// Caret geometry from the locked board's one caret idiom (locked.html §.omni .q .caret: an
// inline-block bar). Its width and lead-in are the board's hairline numbers; its fixed 16px height
// was placeholder pixels (the board's values are throwaway) — height instead rides the prose text
// token below, so the caret scales with the type tier.
const CARET_WIDTH = "1.5px"; // .omni .q .caret width
const CARET_MARGIN = "1px"; // .omni .q .caret margin-left — a hair off the last glyph

// One breathe: full → dim → full. The 0.2 dim floor is the animation's own geometry (an intrinsic,
// like the shimmer's stop offsets), not vocabulary — it never fully vanishes, so the bar reads as a
// live cursor rather than a hard blink.
const caretPulse = stylex.keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: 0.2 },
  "100%": { opacity: 1 },
});

const styles = stylex.create({
  // The thinking body: full-width and text-first (never a bubble — locked §5). Sets the prose type
  // tier and the dimmest fg rung ONCE; the caption, the prose, and the caret's currentColor all
  // inherit from here. A flex column so the caption lead-in sits one row-gap above the prose.
  root: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    // 4px between the caption lead-in and the prose — the conversation slot gap.
    gap: conversationVars["--honk-conversation-row-gap"],
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    paddingInline: conversationVars["--honk-conversation-inset"],
    paddingBlock: ROW_PAD_Y,
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-text-title"],
    lineHeight: fontVars["--honk-leading-title"],
    // The dimmest prose rung (54% fg): thinking is the quietest text on the surface.
    color: colorVars["--honk-color-fg-tertiary"],
  },
  // Reset the <p> UA margin so the flex-column gap alone spaces the caption (<Text> has no reset).
  label: {
    margin: 0,
  },
  // The prose wrapper: the app's markdown engine renders the thinking into this container; the leaf
  // only owns wrapping. The caret trails it as the last inline child.
  prose: {
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  // The streaming caret — the locked board's inline-block bar as a liveness marker. currentColor =
  // the inherited prose fg-tertiary, so it never outshines the thinking it trails.
  caret: {
    display: "inline-block",
    width: CARET_WIDTH,
    // As tall as the prose glyph (the caret spans its text, like the locked caret), seated on the
    // text midline. Reads the text-size token, so it scales with the type tier.
    height: fontVars["--honk-text-title"],
    marginInlineStart: CARET_MARGIN,
    verticalAlign: "middle",
    backgroundColor: "currentColor",
    // A soft breathe on honk's 2s liveness tempo (the shimmer duration tool-call/status-row share).
    // Reduced motion kills the animation and leaves a solid still bar (opacity defaults to 1) — the
    // honest still fallback.
    animationName: {
      default: caretPulse,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: motionVars["--honk-motion-duration-shimmer"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});

// The streaming caret — decorative (aria-hidden), flipped by the caller via isStreaming. Private to
// this leaf: assistant-message renders its own matching caret rather than importing across the
// family (a caret is a shared IDIOM here, not shared code).
function StreamingCaret(): React.ReactElement {
  return <span aria-hidden={true} data-streaming-caret="" {...stylex.props(styles.caret)} />;
}

interface ReasoningBlockProps {
  // The rendered thinking prose — the app's markdown engine renders it; this leaf only styles the
  // container (Part kind 'reasoning', a plain-text arm — part.ts).
  children?: React.ReactNode;
  // Optional quiet caption lead-in ("Thought for 4s"). The collapsed thinking header itself is
  // work-group's job; this is just a muted caption line. The caller computes the elapsed label —
  // this leaf never times anything.
  label?: string | undefined;
  // Live stream: appends the breathing caret. Caller-owned (ADR 0025) — the leaf computes no state.
  isStreaming?: boolean | undefined;
  // Caller override on the container, merged last (charter merge order).
  xstyle?: stylex.StyleXStyles;
}

function ReasoningBlock({
  children,
  label,
  isStreaming = false,
  xstyle,
}: ReasoningBlockProps): React.ReactElement {
  return (
    <div
      // The app's DOM contract (step-renderer.tsx RuntimeThinkingStepRenderer); styling never reads
      // these — they exist for tests and consumers.
      data-runtime-thinking=""
      data-runtime-thinking-streaming={isStreaming ? "true" : undefined}
      {...stylex.props(styles.root, xstyle)}
    >
      {label !== undefined && (
        <Text as="p" size="xs" tone="muted" tabularNums={true} truncate={true} xstyle={styles.label}>
          {label}
        </Text>
      )}
      <div {...stylex.props(styles.prose)}>
        {children}
        {isStreaming && <StreamingCaret />}
      </div>
    </div>
  );
}

export { ReasoningBlock };
export type { ReasoningBlockProps };
