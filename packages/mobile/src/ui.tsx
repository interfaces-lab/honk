import * as React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  View,
  useColorScheme,
  type TextProps,
  type ViewProps,
} from "react-native";
import { Button as ExpoButton, Host as ExpoHost } from "@expo/ui";
import { Button, Text as HonkText } from "@honk/ui";
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
  return <HonkText {...props} size="base" tone="primary" style={style} />;
}

export function DetailText({ style, ...props }: TextProps): React.ReactElement {
  return <HonkText {...props} size="sm" tone="muted" style={style} />;
}

interface ActionButtonProps {
  readonly accessibilityLabel?: string;
  readonly label: string;
  readonly onPress?: () => void;
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
  return (
    <Button
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      isPending={pending}
      {...(onPress === undefined ? {} : { onClick: onPress })}
      size={size === "compact" ? "sm" : "md"}
      variant={
        tone === "accent" ? "primary" : tone === "destructive" ? "destructive" : "neutral"
      }
    >
      {label}
    </Button>
  );
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
