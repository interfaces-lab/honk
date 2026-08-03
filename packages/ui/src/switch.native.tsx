import * as React from "react";
import { Pressable, StyleSheet, View, useColorScheme } from "react-native";

import { resolveNativeTheme } from "./theme";

type SwitchSize = "sm" | "md";

interface SwitchProps {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  size?: SwitchSize;
  accessibilityLabel: string;
}

const layout = StyleSheet.create({
  track: { justifyContent: "center" },
  thumb: {},
});

function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  size = "md",
  accessibilityLabel,
}: SwitchProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  const width = size === "sm" ? 38 : 46;
  const height = size === "sm" ? 22 : 26;
  const inset = 3;
  const thumb = height - inset * 2;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      hitSlop={(theme.metrics.interaction.touchTarget - height) / 2}
      onPress={() => onCheckedChange?.(!checked)}
      style={({ pressed }) => ({
        opacity: disabled
          ? theme.metrics.interaction.disabledOpacity
          : pressed
            ? theme.metrics.interaction.pressedOpacity
            : 1,
      })}
    >
      <View
        style={[
          layout.track,
          {
            backgroundColor: checked ? theme.colors.accentFill : theme.colors.control,
            borderColor: checked ? theme.colors.accentFill : theme.colors.borderStrong,
            borderRadius: theme.metrics.radius.pill,
            borderWidth: theme.metrics.field.borderWidth,
            height,
            width,
          },
        ]}
      >
        <View
          style={[
            layout.thumb,
            {
              backgroundColor: checked ? theme.colors.onAccent : theme.colors.textMuted,
              borderRadius: theme.metrics.radius.pill,
              height: thumb,
              transform: [{ translateX: checked ? width - thumb - inset * 2 : 0 }],
              width: thumb,
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

export { Switch };
export type { SwitchProps, SwitchSize };
