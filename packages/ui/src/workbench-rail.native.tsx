import * as React from "react";
import { Pressable, StyleSheet, Text, useColorScheme, type ViewStyle } from "react-native";

import { resolveNativeTheme } from "./theme";
import { type WorkbenchRailLabelProps, type WorkbenchRailRowProps } from "./workbench-rail.types";

const layout = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    justifyContent: "flex-start",
    width: "100%",
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
  },
});

function WorkbenchRailRow({
  children,
  disabled = false,
  accessibilityLabel,
  onClick,
}: WorkbenchRailRowProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onClick}
      style={({ pressed }) => {
        const style: ViewStyle = {
          backgroundColor: pressed ? theme.colors.statePress : "transparent",
          borderCurve: "continuous",
          borderRadius: theme.metrics.radius.control,
          gap: theme.metrics.space.contentGap,
          minHeight: theme.metrics.interaction.touchTarget,
          opacity: disabled ? theme.metrics.interaction.disabledOpacity : 1,
          paddingHorizontal: theme.metrics.space.panelPad,
        };
        return [layout.row, style];
      }}
    >
      {children}
    </Pressable>
  );
}

function Label({ children }: WorkbenchRailLabelProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  return (
    <Text
      numberOfLines={1}
      style={[
        layout.label,
        {
          color: theme.colors.textMuted,
          fontSize: theme.metrics.font.bodySize,
          fontWeight: theme.metrics.font.weightRegular,
          lineHeight: theme.metrics.font.bodyLeading,
        },
      ]}
    >
      {children}
    </Text>
  );
}

const WorkbenchRailRowWithLabel = Object.assign(WorkbenchRailRow, { Label });

export { WorkbenchRailRowWithLabel as WorkbenchRailRow };
export type { WorkbenchRailLabelProps, WorkbenchRailRowProps } from "./workbench-rail.types";
