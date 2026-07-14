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
import { resolveNativeTheme, type NativeTheme } from "@honk/ui/theme";

export const useHonkTheme = (): NativeTheme =>
  resolveNativeTheme(useColorScheme() === "dark" ? "dark" : "light");

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
  readonly tone?: "accent" | "neutral" | "destructive";
}

export function ActionButton({
  accessibilityLabel,
  disabled = false,
  label,
  onPress,
  pending = false,
  tone = "accent",
}: ActionButtonProps): React.ReactElement {
  const theme = useHonkTheme();
  const backgroundColor =
    tone === "accent"
      ? theme.colors.accentFill
      : tone === "destructive"
        ? theme.colors.errBg
        : theme.colors.control;
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
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor,
          borderRadius: theme.metrics.radius.control,
          minHeight: theme.metrics.interaction.touchTarget,
          opacity:
            disabled || pending
              ? theme.metrics.interaction.disabledOpacity
              : pressed
                ? theme.metrics.interaction.pressedOpacity
                : 1,
          paddingHorizontal: theme.metrics.space.panelPad,
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
