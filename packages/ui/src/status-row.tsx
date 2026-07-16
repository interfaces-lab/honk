
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, conversationVars, fontVars, motionVars } from "./tokens.stylex";

const ROW_PAD_Y = "2px";
const LABEL_OPACITY = 0.8;
// Mask uses black as alpha, not a theme color. Stop offsets are fixed animation geometry.
const SHIMMER_MASK =
  "linear-gradient(90deg, oklch(0 0 0 / 0.45) 0%, oklch(0 0 0 / 0.45) 30%, " +
  "oklch(0 0 0) 50%, oklch(0 0 0 / 0.45) 70%, oklch(0 0 0 / 0.45) 100%)";

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
  // Reduced motion drops the animation and the mask. Leaving a still partial mask would look faded.
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
  children: string;
  style?: StyleProp<HonkStyle>;
}

function StatusRow({ children, style }: StatusRowProps): React.ReactElement {
  return (
    <div role="status" aria-label={children} {...applyStyle(stylex.props(styles.row), style)}>
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
