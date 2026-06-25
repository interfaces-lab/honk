"use client";

import { mergeProps as mergeBaseProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import * as stylex from "@stylexjs/stylex";

import { colorVars, radiusVars, sizeVars } from "./theme/tokens.stylex";
import { mergeProps } from "./utils";
import { themeProps } from "./utils/themeProps";

type StatusDotState =
  | "critical"
  | "doneSeen"
  | "doneUnseen"
  | "draft"
  | "inactive"
  | "needsAttention"
  | "running"
  | "success";

interface StatusDotProps extends useRender.ComponentProps<"span"> {
  state?: StatusDotState;
  xstyle?: stylex.StyleXStyles;
}

const styles = stylex.create({
  root: {
    alignItems: "center",
    display: "inline-flex",
    flexShrink: 0,
    justifyContent: "center",
    position: "relative",
  },
  dot: {
    borderRadius: radiusVars["--honk-kit-radius-full"],
    display: "block",
    height: sizeVars["--honk-kit-size-status-dot"],
    width: sizeVars["--honk-kit-size-status-dot"],
  },
  draft: {
    backgroundColor: "transparent",
    borderColor: colorVars["--honk-kit-color-icon-quaternary"],
    borderStyle: "solid",
    borderWidth: 1,
  },
  running: {
    backgroundColor: colorVars["--honk-kit-color-icon-tertiary"],
  },
  needsAttention: {
    backgroundColor: colorVars["--honk-kit-color-warning"],
  },
  doneUnseen: {
    backgroundColor: colorVars["--honk-kit-color-icon-accent-primary"],
  },
  doneSeen: {
    backgroundColor: colorVars["--honk-kit-color-icon-quaternary"],
  },
  success: {
    backgroundColor: colorVars["--honk-kit-color-success"],
  },
  critical: {
    backgroundColor: colorVars["--honk-kit-color-destructive"],
  },
  inactive: {
    backgroundColor: colorVars["--honk-kit-color-warning-strong"],
  },
});

const stateStyles: Record<StatusDotState, stylex.StyleXStyles> = {
  critical: styles.critical,
  doneSeen: styles.doneSeen,
  doneUnseen: styles.doneUnseen,
  draft: styles.draft,
  inactive: styles.inactive,
  needsAttention: styles.needsAttention,
  running: styles.running,
  success: styles.success,
};

function StatusDot({
  children,
  className,
  render,
  role = "status",
  state = "draft",
  style,
  xstyle,
  ...props
}: StatusDotProps) {
  const dot = <span aria-hidden="true" {...stylex.props(styles.dot, stateStyles[state])} />;

  const defaultProps = {
    ...mergeProps(
      themeProps("status-dot", { state }),
      stylex.props(styles.root, xstyle),
      className,
      style,
    ),
    children: children ?? dot,
    "data-slot": "status-dot",
    role,
  };

  return useRender({
    defaultTagName: "span",
    props: mergeBaseProps<"span">(defaultProps, props),
    render,
  });
}

export { StatusDot };
export type { StatusDotProps, StatusDotState };
