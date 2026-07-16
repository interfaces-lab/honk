// Hairline rule.

import { Separator as Base } from "@base-ui/react/separator";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars } from "./tokens.stylex";

type SeparatorTone = "muted" | "base";

const HAIRLINE = "1px";

const sx = stylex.create({
  root: {
    flexShrink: 0,
  },
  horizontal: {
    height: HAIRLINE,
    width: "100%",
  },
  vertical: {
    width: HAIRLINE,
    alignSelf: "stretch",
  },
  muted: { backgroundColor: colorVars["--honk-color-border-muted"] },
  base: { backgroundColor: colorVars["--honk-color-border-base"] },
});

const axisStyleByOrientation: Record<"horizontal" | "vertical", stylex.StyleXStyles> = {
  horizontal: sx.horizontal,
  vertical: sx.vertical,
};
const toneStyleByTone: Record<SeparatorTone, stylex.StyleXStyles> = {
  muted: sx.muted,
  base: sx.base,
};

interface SeparatorProps extends Omit<Base.Props, "className" | "style"> {
  tone?: SeparatorTone;
  style?: StyleProp<HonkStyle>;
}

function Separator({
  orientation = "horizontal",
  tone = "muted",
  style,
  ...rest
}: SeparatorProps): React.ReactElement {
  return (
    <Base
      {...rest}
      orientation={orientation}
      data-slot="separator"
      {...applyStyle(
        stylex.props(
          sx.root,
          axisStyleByOrientation[orientation],
          toneStyleByTone[tone],
        ),
        style,
      )}
    />
  );
}

export { Separator };
export type { SeparatorProps, SeparatorTone };
