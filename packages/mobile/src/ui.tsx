import * as React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  type PressableProps,
  type TextProps,
  type ViewProps,
} from "react-native";
import { Button as ExpoButton, Host as ExpoHost } from "@expo/ui";
import { resolveNativeTheme, type NativeTheme } from "@honk/ui/theme";

const nativeThemes = {
  dark: resolveNativeTheme("dark"),
  light: resolveNativeTheme("light"),
} as const;

export const useHonkTheme = (): NativeTheme => {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  return nativeThemes[mode];
};

export function Page({ style, ...props }: ViewProps): React.ReactElement {
  const theme = useHonkTheme();
  return <View {...props} style={[styles.page, { backgroundColor: theme.colors.bgBase }, style]} />;
}

export function BodyText({ style, ...props }: TextProps): React.ReactElement {
  const theme = useHonkTheme();
  return (
    <Text
      {...props}
      allowFontScaling
      style={[
        {
          color: theme.colors.textPrimary,
          fontSize: theme.metrics.font.bodySize,
          lineHeight: theme.metrics.font.bodyLeading,
        },
        style,
      ]}
    />
  );
}

export function DetailText({ style, ...props }: TextProps): React.ReactElement {
  const theme = useHonkTheme();
  return (
    <Text
      {...props}
      allowFontScaling
      style={[
        {
          color: theme.colors.textMuted,
          fontSize: theme.metrics.font.detailSize,
          lineHeight: theme.metrics.font.detailLeading,
        },
        style,
      ]}
    />
  );
}

interface ActionButtonProps extends Pick<PressableProps, "accessibilityLabel" | "onPress"> {
  readonly label: string;
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly size?: "compact" | "regular";
  readonly tone?: "accent" | "neutral" | "destructive";
}

export function ActionButton({
  accessibilityLabel,
  disabled = false,
  label,
  onPress,
  pending = false,
  size = "regular",
  tone = "accent",
}: ActionButtonProps): React.ReactElement {
  const theme = useHonkTheme();
  const restingBackgroundColor =
    tone === "accent"
      ? theme.colors.accentFill
      : tone === "destructive"
        ? theme.colors.errBg
        : theme.colors.control;
  const pressedBackgroundColor =
    tone === "neutral" ? theme.colors.controlPress : restingBackgroundColor;
  const borderColor =
    tone === "accent"
      ? theme.colors.accentFill
      : tone === "destructive"
        ? theme.colors.errBorder
        : theme.colors.borderStrong;
  const color =
    tone === "accent"
      ? theme.colors.onAccent
      : tone === "destructive"
        ? theme.colors.errFg
        : theme.colors.textPrimary;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || pending, busy: pending }}
      disabled={disabled || pending}
      hitSlop={
        (theme.metrics.interaction.touchTarget -
          (size === "compact" ? theme.metrics.button.compactHeight : theme.metrics.button.height)) /
        2
      }
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed ? pressedBackgroundColor : restingBackgroundColor,
          borderColor,
          borderCurve: "continuous",
          borderRadius: theme.metrics.radius.control,
          borderStyle: "solid",
          borderWidth: theme.metrics.button.borderWidth,
          height:
            size === "compact" ? theme.metrics.button.compactHeight : theme.metrics.button.height,
          opacity:
            disabled || pending
              ? theme.metrics.interaction.disabledOpacity
              : pressed
                ? theme.metrics.interaction.pressedOpacity
                : 1,
          paddingHorizontal:
            size === "compact"
              ? theme.metrics.button.compactPaddingInline
              : theme.metrics.button.paddingInline,
        },
      ]}
    >
      {pending ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text
          allowFontScaling
          style={{
            color,
            fontSize: theme.metrics.font.detailSize,
            fontWeight: theme.metrics.font.weightSemibold,
            lineHeight: theme.metrics.font.detailLeading,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

interface ChoiceButtonProps extends Pick<PressableProps, "onPress"> {
  readonly label: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
}

interface SystemButtonProps {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly variant?: "filled" | "outlined" | "text";
}

export function SystemButton({
  disabled = false,
  label,
  onPress,
  variant = "outlined",
}: SystemButtonProps): React.ReactElement {
  const theme = useHonkTheme();
  return (
    <ExpoHost matchContents seedColor={theme.colors.accent}>
      <ExpoButton disabled={disabled} label={label} onPress={onPress} variant={variant} />
    </ExpoHost>
  );
}

export function ChoiceButton({
  disabled = false,
  label,
  onPress,
  selected,
}: ChoiceButtonProps): React.ReactElement {
  const theme = useHonkTheme();
  const hitSlop = (theme.metrics.interaction.touchTarget - theme.metrics.button.compactHeight) / 2;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: selected
          ? theme.colors.accentSubtle
          : pressed
            ? theme.colors.controlPress
            : theme.colors.control,
        borderColor: selected ? theme.colors.accent : theme.colors.borderStrong,
        borderCurve: "continuous",
        borderRadius: theme.metrics.radius.control,
        borderStyle: "solid",
        borderWidth: theme.metrics.button.borderWidth,
        height: theme.metrics.button.compactHeight,
        justifyContent: "center",
        opacity: disabled ? theme.metrics.interaction.disabledOpacity : 1,
        paddingHorizontal: theme.metrics.button.compactPaddingInline,
      })}
    >
      <Text
        allowFontScaling
        style={{
          color: selected ? theme.colors.accent : theme.colors.textPrimary,
          fontSize: theme.metrics.font.detailSize,
          fontWeight: selected
            ? theme.metrics.font.weightSemibold
            : theme.metrics.font.weightMedium,
          lineHeight: theme.metrics.font.detailLeading,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function LoadingState({ label }: { readonly label: string }): React.ReactElement {
  const theme = useHonkTheme();
  return (
    <Page style={[styles.centered, { gap: theme.metrics.space.rowGap }]}>
      <ActivityIndicator color={theme.colors.accent} />
      <DetailText>{label}</DetailText>
    </Page>
  );
}

export function EmptyState({
  body,
  title,
}: {
  readonly body: string;
  readonly title: string;
}): React.ReactElement {
  const theme = useHonkTheme();
  return (
    <View
      style={[
        styles.empty,
        {
          gap: theme.metrics.space.contentGap,
          padding: theme.metrics.space.screenGutter,
        },
      ]}
    >
      <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>{title}</BodyText>
      <DetailText style={styles.centerText}>{body}</DetailText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  centerText: {
    textAlign: "center",
  },
});
