import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import * as stylex from "@stylexjs/stylex";

import { colorVars } from "./theme/tokens.stylex";
import { mergeProps } from "./utils";
import { themeProps } from "./utils/themeProps";

interface SeparatorProps extends SeparatorPrimitive.Props {
  xstyle?: stylex.StyleXStyles;
}

const styles = stylex.create({
  root: {
    backgroundColor: colorVars["--honk-kit-color-border"],
    flexShrink: 0,
  },
  horizontal: {
    height: 1,
    width: "100%",
  },
  vertical: {
    alignSelf: "stretch",
    width: 1,
  },
});

function Separator({
  className,
  orientation = "horizontal",
  style,
  xstyle,
  ...props
}: SeparatorProps) {
  const mergedProps = mergeProps(
    themeProps("separator", { orientation }),
    stylex.props(
      styles.root,
      orientation === "horizontal" ? styles.horizontal : styles.vertical,
      xstyle,
    ),
    typeof className === "function" ? undefined : className,
    typeof style === "function" ? undefined : style,
  );
  const mergedClassName =
    typeof mergedProps.className === "string" ? mergedProps.className : undefined;
  const classNameProp =
    typeof className === "function"
      ? (state: SeparatorPrimitive.State) =>
          [mergedClassName, className(state)].filter(Boolean).join(" ") || undefined
      : mergedClassName;
  const mergedStyle = mergedProps.style;
  const styleProp =
    typeof style === "function"
      ? (state: SeparatorPrimitive.State) => {
          const resolvedStyle = style(state);
          return mergedStyle && resolvedStyle
            ? { ...mergedStyle, ...resolvedStyle }
            : (resolvedStyle ?? mergedStyle);
        }
      : mergedStyle;

  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      {...mergedProps}
      className={classNameProp}
      style={styleProp}
      {...props}
    />
  );
}

export { Separator };
export type { SeparatorProps };
