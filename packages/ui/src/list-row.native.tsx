import * as React from "react";
import { Pressable, StyleSheet, Text, View, useColorScheme, type ViewStyle } from "react-native";

import { resolveNativeTheme } from "./theme";

type ListRowSize = "sm" | "md";

interface ListRowProps {
  children: React.ReactNode;
  isSelected?: boolean;
  isHighlighted?: boolean;
  size?: ListRowSize;
  disabled?: boolean;
  accessibilityLabel?: string;
  onClick?: () => void;
  testID?: string;
}

interface ListRowPieceProps {
  children?: React.ReactNode;
}

interface ListRowActionProps {
  children?: React.ReactNode;
  isActive?: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
  onClick?: () => void;
  testID?: string;
}

const layout = StyleSheet.create({
  root: {
    alignItems: "center",
    flexDirection: "row",
    width: "100%",
  },
  slot: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  meta: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
  },
});

function ListRowRoot({
  children,
  isSelected = false,
  isHighlighted = false,
  disabled = false,
  accessibilityLabel,
  onClick,
  testID,
}: ListRowProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: isSelected }}
      disabled={disabled}
      onPress={onClick}
      testID={testID}
      style={({ pressed }) => {
        const rootStyle: ViewStyle = {
          backgroundColor: isSelected
            ? theme.colors.controlSelected
            : pressed
              ? theme.colors.statePress
              : isHighlighted
                ? theme.colors.stateHover
                : "transparent",
          borderCurve: "continuous",
          borderRadius: theme.metrics.radius.control,
          gap: theme.metrics.space.contentGap,
          minHeight: theme.metrics.interaction.touchTarget,
          opacity: disabled ? theme.metrics.interaction.disabledOpacity : 1,
          paddingHorizontal: theme.metrics.space.panelPad,
          paddingVertical: theme.metrics.space.compactGap,
        };
        return [layout.root, rootStyle];
      }}
    >
      {children}
    </Pressable>
  );
}

function Slot({ children }: ListRowPieceProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  return (
    <View style={[layout.slot, { width: theme.metrics.interaction.touchTarget }]}>{children}</View>
  );
}

function Content({ children }: ListRowPieceProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  return <View style={[layout.content, { gap: theme.metrics.space.compactGap }]}>{children}</View>;
}

function Title({ children }: ListRowPieceProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  return (
    <Text
      numberOfLines={1}
      style={{
        color: theme.colors.textPrimary,
        fontSize: theme.metrics.font.bodySize,
        fontWeight: theme.metrics.font.weightMedium,
        lineHeight: theme.metrics.font.bodyLeading,
      }}
    >
      {children}
    </Text>
  );
}

function Description({ children }: ListRowPieceProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  return (
    <Text
      numberOfLines={1}
      style={{
        color: theme.colors.textMuted,
        fontSize: theme.metrics.font.detailSize,
        fontWeight: theme.metrics.font.weightRegular,
        lineHeight: theme.metrics.font.detailLeading,
      }}
    >
      {children}
    </Text>
  );
}

function Meta({ children }: ListRowPieceProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  return <View style={[layout.meta, { gap: theme.metrics.space.compactGap }]}>{children}</View>;
}

function Action({
  children,
  isActive = false,
  disabled = false,
  accessibilityLabel,
  onClick,
  testID,
}: ListRowActionProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: isActive }}
      disabled={disabled}
      onPress={onClick}
      testID={testID}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: isActive
          ? theme.colors.controlSelected
          : pressed
            ? theme.colors.statePress
            : "transparent",
        borderCurve: "continuous",
        borderRadius: theme.metrics.radius.control,
        height: theme.metrics.interaction.touchTarget,
        justifyContent: "center",
        opacity: disabled ? theme.metrics.interaction.disabledOpacity : 1,
        width: theme.metrics.interaction.touchTarget,
      })}
    >
      {children}
    </Pressable>
  );
}

const ListRow = Object.assign(ListRowRoot, { Slot, Content, Title, Description, Meta, Action });

export { ListRow };
export type { ListRowActionProps, ListRowPieceProps, ListRowProps, ListRowSize };
