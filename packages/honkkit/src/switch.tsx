"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import * as stylex from "@stylexjs/stylex";

import { switchStyles } from "./switch-styles";
import { mergeProps } from "./utils/mergeProps";
import { themeProps } from "./utils/themeProps";

interface SwitchProps extends SwitchPrimitive.Root.Props {
  xstyle?: stylex.StyleXStyles;
}

function Switch({ className, style, xstyle, ...props }: SwitchProps) {
  const mergedProps = mergeProps(
    themeProps("switch"),
    stylex.props(switchStyles.root, xstyle),
    typeof className === "function" ? undefined : className,
    typeof style === "function" ? undefined : style,
  );
  const mergedClassName =
    typeof mergedProps.className === "string" ? mergedProps.className : undefined;
  const classNameProp: SwitchPrimitive.Root.Props["className"] =
    typeof className === "function"
      ? (state) => [mergedClassName, className(state)].filter(Boolean).join(" ") || undefined
      : mergedClassName;
  const mergedStyle = mergedProps.style;
  const styleProp: SwitchPrimitive.Root.Props["style"] =
    typeof style === "function"
      ? (state) => {
          const resolvedStyle = style(state);
          return mergedStyle && resolvedStyle
            ? { ...mergedStyle, ...resolvedStyle }
            : (resolvedStyle ?? mergedStyle);
        }
      : mergedStyle;

  return (
    <SwitchPrimitive.Root
      {...mergedProps}
      className={classNameProp}
      data-slot="switch"
      style={styleProp}
      {...props}
    >
      <SwitchPrimitive.Thumb {...stylex.props(switchStyles.thumb)} data-slot="switch-thumb" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
export type { SwitchProps };
