// The status row — the timeline's waiting indicator: a shimmer-masked label ("Planning next
// moves") that appends while the agent is between visible steps. Anatomy and values ported
// exactly from the app's WorkingStatusRow + honkkit's ChatLoader (packages/app/src/components/
// chat/message/status-row.tsx wrapping packages/honkkit/src/conversation-loader.tsx ChatLoader),
// flattened per the recon memo §5: the row-level overrides (min-h-6 · px-conversation-inset ·
// py-0 · text-conversation) win over ChatLoader's own metrics at the call site, so one element
// carries them here. The label's shimmer is a MASK sweep (honkkit styles.css
// [data-slot="conversation-loader-thinking"] + @keyframes thinking-shimmer), distinct from the
// tool line's background-clip shine.
//
// Presentational and effect-free (ADR 0025): the label is a prop; the 15s "This is taking a bit
// longer..." swap is caller/store timing (the app's waiting-status.ts), never a component timer.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { colorVars, conversationVars, fontVars, motionVars } from "./tokens.stylex";

// ── Row intrinsics (justified per the stylex skill) ────────────────────────────────────────
const ROW_PAD_Y = "2px"; // py-0.5 on the app's WorkingStatusRow wrapper (status-row.tsx)
// text-muted-foreground/80: the label's 80% alpha step over fg-secondary, applied as element
// opacity — equivalent for a single text node, and it composes with the mask (conversation-
// loader.tsx ChatLoader call site).
const LABEL_OPACITY = 0.8;
// The shimmer mask, verbatim from honkkit styles.css: 0.45-alpha shoulders around an opaque
// center. An ALPHA ramp (black = mask alpha, not a theme color) — an intrinsic, not vocabulary.
const SHIMMER_MASK =
  "linear-gradient(90deg, oklch(0 0 0 / 0.45) 0%, oklch(0 0 0 / 0.45) 30%, " +
  "oklch(0 0 0) 50%, oklch(0 0 0 / 0.45) 70%, oklch(0 0 0 / 0.45) 100%)";

// One mask sweep, verbatim from styles.css @keyframes thinking-shimmer: slide from the resting
// position to -200% center (mask-size is 200%, so one full pass).
const thinkingShimmer = stylex.keyframes({
  to: { maskPosition: "-200% center" },
});

const styles = stylex.create({
  row: {
    display: "flex",
    width: "100%",
    minWidth: 0,
    alignItems: "center",
    paddingBlock: ROW_PAD_Y,
  },
  loader: {
    display: "inline-flex",
    alignItems: "center",
    maxWidth: "100%",
    minHeight: conversationVars["--honk-conversation-row-min-h"],
    paddingInline: conversationVars["--honk-conversation-inset"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-text-title"],
    lineHeight: fontVars["--honk-leading-title"],
    color: colorVars["--honk-color-fg-secondary"],
    opacity: LABEL_OPACITY,
  },
  // The label's mask sweep. Reduced motion drops the animation AND the mask (the app's
  // motion-reduce:animate-none would leave a part-faded still mask; removing it renders the
  // honest still label instead).
  label: {
    animationName: {
      default: thinkingShimmer,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: motionVars["--honk-motion-duration-shimmer"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
    maskImage: {
      default: SHIMMER_MASK,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    maskSize: "200% 100%",
  },
});

interface StatusRowProps {
  // The waiting label — a string so it can double as the row's accessible name (the app's
  // ChatLoader: role="status" + aria-label, with the shimmering span aria-hidden).
  children: string;
  // Caller override, merged last (charter merge order).
  xstyle?: stylex.StyleXStyles;
}

function StatusRow({ children, xstyle }: StatusRowProps): React.ReactElement {
  return (
    <div role="status" aria-label={children} {...stylex.props(styles.row, xstyle)}>
      <span {...stylex.props(styles.loader)}>
        <span aria-hidden={true} {...stylex.props(styles.label)}>
          {children}
        </span>
      </span>
    </div>
  );
}

export { StatusRow };
export type { StatusRowProps };
