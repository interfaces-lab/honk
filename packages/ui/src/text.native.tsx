import * as React from "react";
import {
  Text as NativeText,
  useColorScheme,
  type StyleProp,
  type TextProps as NativeTextProps,
  type TextStyle,
} from "react-native";

import { resolveNativeTheme } from "./theme";

type TextElement = "span" | "p" | "div" | "label";
type TextSize = "xs" | "sm" | "base" | "lg" | "xl";
type TextTone = "primary" | "muted" | "faint" | "accent" | "ok" | "warn" | "err" | "inherit";
type TextWeight = "regular" | "semibold";
type TextAlign = "start" | "center" | "end";
type TextFamily = "ui" | "mono" | "rounded";

interface TextProps extends Omit<NativeTextProps, "style"> {
  as?: TextElement;
  size?: TextSize;
  tone?: TextTone;
  weight?: TextWeight;
  align?: TextAlign;
  family?: TextFamily;
  tabularNums?: boolean;
  truncate?: boolean;
  style?: StyleProp<TextStyle>;
}

function Text({
  size = "base",
  tone = "primary",
  weight = "regular",
  align = "start",
  family = "ui",
  tabularNums = false,
  truncate = false,
  style,
  numberOfLines,
  ...props
}: TextProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  const font = theme.metrics.font;
  const sizeStyle: TextStyle =
    size === "xs"
      ? { fontSize: font.captionSize, lineHeight: font.captionLeading }
      : size === "sm"
        ? { fontSize: font.detailSize, lineHeight: font.detailLeading }
        : size === "base"
          ? { fontSize: font.bodySize, lineHeight: font.bodyLeading }
          : size === "lg"
            ? { fontSize: font.titleSize, lineHeight: font.titleLeading }
            : { fontSize: font.titleSize + 4, lineHeight: font.titleLeading + 4 };
  const color =
    tone === "primary"
      ? theme.colors.textPrimary
      : tone === "muted"
        ? theme.colors.textMuted
        : tone === "faint"
          ? theme.colors.textFaint
          : tone === "accent"
            ? theme.colors.accent
            : tone === "ok"
              ? theme.colors.okFg
              : tone === "warn"
                ? theme.colors.warnFg
                : tone === "err"
                  ? theme.colors.errFg
                  : undefined;
  const fontWeight = weight === "semibold" ? font.weightSemibold : font.weightRegular;
  const textStyle: TextStyle = {
    ...sizeStyle,
    ...(color === undefined ? {} : { color }),
    fontFamily: family === "mono" ? "monospace" : undefined,
    fontVariant: tabularNums ? ["tabular-nums"] : undefined,
    fontWeight,
    textAlign: align === "start" ? "left" : align === "end" ? "right" : "center",
  };

  return (
    <NativeText
      {...props}
      allowFontScaling
      numberOfLines={truncate ? 1 : numberOfLines}
      style={[textStyle, style]}
    />
  );
}

export { Text };
export type { TextAlign, TextElement, TextFamily, TextProps, TextSize, TextTone, TextWeight };
