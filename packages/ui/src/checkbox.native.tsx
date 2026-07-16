import * as React from "react";
import { Pressable, StyleSheet, View, useColorScheme } from "react-native";

import { resolveNativeTheme } from "./theme";

type CheckboxSize = "sm" | "md";

interface CheckboxProps {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  size?: CheckboxSize;
  accessibilityLabel: string;
}

const layout = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
  mark: { borderBottomWidth: 2, borderRightWidth: 2, transform: [{ rotate: "45deg" }] },
});

function Checkbox({
  checked,
  onCheckedChange,
  disabled = false,
  size = "md",
  accessibilityLabel,
}: CheckboxProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  const edge = size === "sm" ? 18 : 22;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      hitSlop={(theme.metrics.interaction.touchTarget - edge) / 2}
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
          layout.box,
          {
            backgroundColor: checked ? theme.colors.accentFill : theme.colors.layer01,
            borderColor: checked ? theme.colors.accentFill : theme.colors.borderStrong,
            borderCurve: "continuous",
            borderRadius: theme.metrics.radius.control,
            borderWidth: theme.metrics.field.borderWidth,
            height: edge,
            width: edge,
          },
        ]}
      >
        {checked ? (
          <View
            style={[
              layout.mark,
              {
                borderColor: theme.colors.onAccent,
                height: edge * 0.5,
                marginTop: -edge * 0.16,
                width: edge * 0.28,
              },
            ]}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

export { Checkbox };
export type { CheckboxProps, CheckboxSize };
