import * as stylex from "@stylexjs/stylex";
import type * as React from "react";

import type { BaseProps } from "./BaseProps";
import { mergeProps } from "./utils";
import { themeProps } from "./utils/themeProps";
import {
  colorVars,
  radiusVars,
  sizeVars,
  spacingVars,
  typographyVars,
} from "./theme/tokens.stylex";

interface KbdProps extends BaseProps<HTMLElement> {
  children?: React.ReactNode;
}

const styles = stylex.create({
  key: {
    alignItems: "center",
    backgroundColor: colorVars["--honk-kit-color-bg-quinary"],
    borderColor: colorVars["--honk-kit-color-stroke-tertiary"],
    borderRadius: radiusVars["--honk-kit-radius-sm"],
    borderStyle: "solid",
    borderWidth: 1,
    color: colorVars["--honk-kit-color-fg-secondary"],
    display: "inline-flex",
    fontFamily: typographyVars["--honk-kit-font-ui"],
    fontSize: typographyVars["--honk-kit-text-detail"],
    fontWeight: 500,
    gap: spacingVars["--honk-kit-spacing-1"],
    height: sizeVars["--honk-kit-size-kbd"],
    justifyContent: "center",
    lineHeight: typographyVars["--honk-kit-leading-detail"],
    minWidth: sizeVars["--honk-kit-size-kbd"],
    paddingInline: spacingVars["--honk-kit-spacing-1"],
    pointerEvents: "none",
    userSelect: "none",
  },
  group: {
    alignItems: "center",
    display: "inline-flex",
    gap: spacingVars["--honk-kit-spacing-1"],
  },
});

function Kbd({ className, style, xstyle, ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      {...mergeProps(themeProps("kbd"), stylex.props(styles.key, xstyle), className, style)}
      {...props}
    />
  );
}

function KbdGroup({ className, style, xstyle, ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd-group"
      {...mergeProps(themeProps("kbd-group"), stylex.props(styles.group, xstyle), className, style)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
export type { KbdProps };
