import * as React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  type ViewStyle,
} from "react-native";

import { resolveNativeTheme, type NativeTheme } from "./theme";

type ButtonVariant = "primary" | "neutral" | "quiet" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconStart?: React.ReactNode;
  iconEnd?: React.ReactNode;
  block?: boolean;
  disabled?: boolean;
  isPending?: boolean;
  accessibilityLabel?: string;
  onClick?: () => void;
  testID?: string;
}

interface IconButtonProps extends Omit<ButtonProps, "block" | "iconEnd" | "iconStart"> {
  accessibilityLabel: string;
}

const layout = StyleSheet.create({
  root: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  block: { width: "100%" },
});

function buttonPaint(colors: NativeTheme["colors"], variant: ButtonVariant, pressed: boolean): {
  backgroundColor: string;
  borderColor: string;
  color: string;
} {
  if (variant === "primary") {
    return {
      backgroundColor: colors.accentFill,
      borderColor: colors.accentFill,
      color: colors.onAccent,
    };
  }
  if (variant === "destructive") {
    return {
      backgroundColor: colors.errBg,
      borderColor: colors.errBorder,
      color: colors.errFg,
    };
  }
  if (variant === "quiet") {
    return {
      backgroundColor: pressed ? colors.statePress : "transparent",
      borderColor: "transparent",
      color: colors.textMuted,
    };
  }
  return {
    backgroundColor: pressed ? colors.controlPress : colors.control,
    borderColor: "transparent",
    color: colors.textPrimary,
  };
}

function Button({
  children,
  variant = "neutral",
  size = "md",
  iconStart,
  iconEnd,
  block = false,
  disabled = false,
  isPending = false,
  accessibilityLabel,
  onClick,
  testID,
}: ButtonProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  const compact = size === "sm";
  const height = compact ? theme.metrics.button.compactHeight : theme.metrics.button.height;
  const paddingInline = compact
    ? theme.metrics.button.compactPaddingInline
    : theme.metrics.button.paddingInline;
  const inactive = disabled || isPending;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: isPending, disabled: inactive }}
      disabled={inactive}
      hitSlop={(theme.metrics.interaction.touchTarget - height) / 2}
      onPress={onClick}
      testID={testID}
      style={({ pressed }) => {
        const paint = buttonPaint(theme.colors, variant, pressed);
        const rootStyle: ViewStyle = {
          backgroundColor: paint.backgroundColor,
          borderColor: paint.borderColor,
          borderCurve: "continuous",
          borderRadius: theme.metrics.radius.control,
          borderStyle: "solid",
          borderWidth: theme.metrics.button.borderWidth,
          gap: theme.metrics.space.contentGap,
          height,
          opacity: inactive
            ? theme.metrics.interaction.disabledOpacity
            : pressed
              ? theme.metrics.interaction.pressedOpacity
              : 1,
          paddingHorizontal: paddingInline,
        };
        return [layout.root, block && layout.block, rootStyle];
      }}
    >
      {({ pressed }) => {
        const paint = buttonPaint(theme.colors, variant, pressed);
        return isPending ? (
          <ActivityIndicator color={paint.color} />
        ) : (
          <>
            {iconStart}
            {typeof children === "string" || typeof children === "number" ? (
              <Text
                allowFontScaling
                style={{
                  color: paint.color,
                  fontSize: theme.metrics.font.detailSize,
                  fontWeight: theme.metrics.font.weightSemibold,
                  lineHeight: theme.metrics.font.detailLeading,
                }}
              >
                {children}
              </Text>
            ) : (
              <View>{children}</View>
            )}
            {iconEnd}
          </>
        );
      }}
    </Pressable>
  );
}

function IconButton(props: IconButtonProps): React.ReactElement {
  return <Button {...props}>{props.children}</Button>;
}

export { Button, IconButton };
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps };
