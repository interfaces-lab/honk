import * as stylex from "@stylexjs/stylex";
import { IconLoader } from "central-icons";
import type * as React from "react";

import { motionVars } from "./theme/tokens.stylex";
import { mergeProps } from "./utils";
import { themeProps } from "./utils/themeProps";

interface SpinnerProps extends React.ComponentProps<typeof IconLoader> {
  xstyle?: stylex.StyleXStyles;
}

const spin = stylex.keyframes({
  to: {
    transform: "rotate(360deg)",
  },
});

const styles = stylex.create({
  root: {
    animationDuration: motionVars["--honk-kit-spinner-duration"],
    animationIterationCount: "infinite",
    animationName: {
      default: spin,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationTimingFunction: "linear",
  },
});

function Spinner({
  "aria-label": ariaLabel = "Loading",
  className,
  role = "status",
  style,
  xstyle,
  ...props
}: SpinnerProps) {
  return (
    <IconLoader
      aria-label={ariaLabel}
      role={role}
      {...mergeProps(themeProps("spinner"), stylex.props(styles.root, xstyle), className, style)}
      {...props}
    />
  );
}

export { Spinner };
export type { SpinnerProps };
