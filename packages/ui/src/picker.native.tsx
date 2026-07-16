import * as React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import type {
  PickerCompound,
  PickerGroupLabelProps,
  PickerGroupProps,
  PickerOptionProps,
  PickerPopupProps,
  PickerRootProps,
  PickerTriggerProps,
} from "./picker.types";
import { resolveNativeTheme } from "./theme";

interface PickerContextValue {
  value: string;
  disabled: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  select: (value: string) => void;
}

const PickerContext = React.createContext<PickerContextValue | null>(null);

function usePickerContext(): PickerContextValue {
  const context = React.use(PickerContext);
  if (context === null) throw new Error("Picker compound parts must be rendered inside Picker.Root");
  return context;
}

const layout = StyleSheet.create({
  trigger: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  triggerContent: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
  chevron: {
    borderBottomWidth: 1.5,
    borderRightWidth: 1.5,
    height: 7,
    transform: [{ rotate: "45deg" }],
    width: 7,
  },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: "72%",
    paddingBottom: 24,
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  sheetLabel: {
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  option: {
    alignItems: "center",
    flexDirection: "row",
  },
  optionLeading: {
    alignItems: "center",
    justifyContent: "center",
  },
  optionContent: {
    flex: 1,
    minWidth: 0,
  },
  indicator: {
    borderStyle: "solid",
    borderWidth: 2,
  },
  indicatorDot: {
    borderRadius: 999,
  },
  group: {
    width: "100%",
  },
});

function PickerRoot({
  children,
  value,
  onValueChange,
  disabled = false,
}: PickerRootProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const context = React.useMemo<PickerContextValue>(
    () => ({
      value,
      disabled,
      open,
      setOpen,
      select: (next) => {
        onValueChange(next);
        setOpen(false);
      },
    }),
    [disabled, onValueChange, open, value],
  );
  return <PickerContext value={context}>{children}</PickerContext>;
}

function PickerTrigger({
  children,
  accessibilityLabel,
  size = "md",
  tone = "neutral",
}: PickerTriggerProps): React.ReactElement {
  const picker = usePickerContext();
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  const metrics = theme.metrics;
  const height = size === "sm" ? metrics.button.compactHeight : metrics.button.height;
  const triggerStyle: ViewStyle = {
    backgroundColor: tone === "quiet" ? "transparent" : theme.colors.control,
    borderCurve: "continuous",
    borderRadius: metrics.radius.control,
    gap: metrics.space.contentGap,
    height,
    opacity: picker.disabled ? metrics.interaction.disabledOpacity : 1,
    paddingHorizontal:
      size === "sm" ? metrics.button.compactPaddingInline : metrics.button.paddingInline,
  };
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: picker.disabled, expanded: picker.open }}
      disabled={picker.disabled}
      onPress={() => picker.setOpen(true)}
      style={({ pressed }) => [
        layout.trigger,
        triggerStyle,
        pressed && { opacity: metrics.interaction.pressedOpacity },
      ]}
    >
      <View style={layout.triggerContent}>{children}</View>
      <View style={[layout.chevron, { borderColor: theme.colors.textMuted }]} />
    </Pressable>
  );
}

function PickerPopup({ children, label }: PickerPopupProps): React.ReactElement | null {
  const picker = usePickerContext();
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  if (!picker.open) return null;

  const scrimStyle: ViewStyle = { backgroundColor: theme.colors.scrim };
  const sheetStyle: ViewStyle = { backgroundColor: theme.colors.bgBase };
  const labelStyle: TextStyle = {
    color: theme.colors.textMuted,
    fontSize: theme.metrics.font.captionSize,
    fontWeight: theme.metrics.font.weightMedium,
    lineHeight: theme.metrics.font.captionLeading,
  };
  return (
    <Modal
      animationType="slide"
      onRequestClose={() => picker.setOpen(false)}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Close ${label}`}
        onPress={() => picker.setOpen(false)}
        style={[layout.backdrop, scrimStyle]}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={[layout.sheet, sheetStyle]}
        >
          <Text style={[layout.sheetLabel, labelStyle]}>{label}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PickerOption({
  value,
  label,
  description,
  leading,
  metadata,
  disabled = false,
}: PickerOptionProps): React.ReactElement {
  const picker = usePickerContext();
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  const selected = picker.value === value;
  const optionStyle: ViewStyle = {
    backgroundColor: selected ? theme.colors.controlSelected : "transparent",
    borderCurve: "continuous",
    borderRadius: theme.metrics.radius.control,
    gap: theme.metrics.space.contentGap,
    minHeight: description === undefined ? theme.metrics.interaction.touchTarget : 56,
    opacity: disabled ? theme.metrics.interaction.disabledOpacity : 1,
    paddingHorizontal: theme.metrics.button.paddingInline,
    paddingVertical: theme.metrics.space.compactGap,
  };
  const labelStyle: TextStyle = {
    color: theme.colors.textPrimary,
    fontSize: theme.metrics.font.bodySize,
    fontWeight: theme.metrics.font.weightMedium,
    lineHeight: theme.metrics.font.bodyLeading,
  };
  const descriptionStyle: TextStyle = {
    color: theme.colors.textMuted,
    fontSize: theme.metrics.font.detailSize,
    fontWeight: theme.metrics.font.weightRegular,
    lineHeight: theme.metrics.font.detailLeading,
  };
  const indicatorStyle: ViewStyle = {
    alignItems: "center",
    borderColor: selected ? theme.colors.accent : theme.colors.borderStrong,
    borderRadius: theme.metrics.radius.pill,
    height: 18,
    justifyContent: "center",
    width: 18,
  };
  const indicatorDotStyle: ViewStyle = {
    backgroundColor: theme.colors.accent,
    height: 8,
    width: 8,
  };
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={() => picker.select(value)}
      style={({ pressed }) => [
        layout.option,
        optionStyle,
        pressed && { opacity: theme.metrics.interaction.pressedOpacity },
      ]}
    >
      {leading === undefined ? null : <View style={layout.optionLeading}>{leading}</View>}
      <View style={layout.optionContent}>
        <Text numberOfLines={1} style={labelStyle}>
          {label}
        </Text>
        {description === undefined ? null : (
          <Text numberOfLines={1} style={descriptionStyle}>
            {description}
          </Text>
        )}
      </View>
      {metadata}
      <View style={[layout.indicator, indicatorStyle]}>
        {selected ? <View style={[layout.indicatorDot, indicatorDotStyle]} /> : null}
      </View>
    </Pressable>
  );
}

function PickerGroup({ children }: PickerGroupProps): React.ReactElement {
  return <View accessibilityRole="radiogroup" style={layout.group}>{children}</View>;
}

function PickerGroupLabel({ children }: PickerGroupLabelProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  const textStyle: TextStyle = {
    color: theme.colors.textMuted,
    fontSize: theme.metrics.font.captionSize,
    fontWeight: theme.metrics.font.weightMedium,
    lineHeight: theme.metrics.font.captionLeading,
    paddingHorizontal: theme.metrics.button.paddingInline,
    paddingVertical: theme.metrics.space.compactGap,
  };
  return <Text style={textStyle}>{children}</Text>;
}

const Picker: PickerCompound = {
  Root: PickerRoot,
  Trigger: PickerTrigger,
  Popup: PickerPopup,
  Option: PickerOption,
  Group: PickerGroup,
  GroupLabel: PickerGroupLabel,
};

export { Picker };
export type {
  PickerGroupLabelProps,
  PickerGroupProps,
  PickerOptionProps,
  PickerPopupProps,
  PickerPopupWidth,
  PickerRootProps,
  PickerSize,
  PickerTone,
  PickerTriggerProps,
} from "./picker.types";
