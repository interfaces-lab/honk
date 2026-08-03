import * as React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, { FadeOut, ReduceMotion, SlideInUp } from "react-native-reanimated";

import { Icon } from "./icon.native";
import { resolveNativeTheme, type NativeTheme } from "./theme";
import {
  invokeToastAction,
  toast,
  useToasts,
  type ToastAction,
  type ToastItem,
  type ToastOptions,
  type ToastType,
} from "./toast-store.native";

interface ToasterProps {
  // react-native-safe-area-context is not a @honk/ui dependency, so the safe-area top inset crosses
  // as a number: the host passes useSafeAreaInsets().top.
  topInset?: number;
  testID?: string;
}

interface ToastCardProps {
  item: ToastItem;
  theme: NativeTheme;
}

const ENTERING = SlideInUp.reduceMotion(ReduceMotion.System);
const EXITING = FadeOut.reduceMotion(ReduceMotion.System);

const layout = StyleSheet.create({
  root: {
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  card: {
    alignItems: "center",
    flexDirection: "row",
  },
  body: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  action: {
    alignItems: "center",
    justifyContent: "center",
  },
});

// The empty root stays mounted: Reanimated only plays `exiting` when a child leaves a parent that
// is still there, so unmounting the overlay with the last toast would cut its exit short.
function Toaster({ topInset = 0, testID }: ToasterProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  const items = useToasts();
  const rootStyle: ViewStyle = {
    gap: theme.metrics.space.contentGap,
    paddingHorizontal: theme.metrics.space.screenGutter,
    paddingTop: topInset + theme.metrics.space.screenGutter,
  };

  return (
    <View pointerEvents="box-none" style={[layout.root, rootStyle]} testID={testID}>
      {items.map((item) => (
        <ToastCard key={item.id} item={item} theme={theme} />
      ))}
    </View>
  );
}

function ToastCard({ item, theme }: ToastCardProps): React.ReactElement {
  const cardStyle: ViewStyle = {
    backgroundColor: theme.colors.toastBg,
    borderColor: theme.colors.toastBorder,
    borderCurve: "continuous",
    borderRadius: theme.metrics.radius.panel,
    borderStyle: "solid",
    borderWidth: theme.metrics.field.borderWidth,
    gap: theme.metrics.space.contentGap,
    paddingHorizontal: theme.metrics.space.panelPad,
    paddingVertical: theme.metrics.space.contentGap,
  };
  const titleStyle: TextStyle = {
    color: theme.colors.toastText,
    fontSize: theme.metrics.font.detailSize,
    fontWeight: theme.metrics.font.weightSemibold,
    lineHeight: theme.metrics.font.detailLeading,
  };
  const descriptionStyle: TextStyle = {
    color: theme.colors.toastMuted,
    fontSize: theme.metrics.font.captionSize,
    fontWeight: theme.metrics.font.weightRegular,
    lineHeight: theme.metrics.font.captionLeading,
  };
  const bodyStyle: ViewStyle = { gap: theme.metrics.space.contentGap };

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      entering={ENTERING}
      exiting={EXITING}
      style={[layout.card, cardStyle]}
    >
      <Pressable
        accessibilityLabel={`Dismiss ${item.title}`}
        accessibilityRole="button"
        onPress={() => {
          toast.dismiss(item.id);
        }}
        style={[layout.body, bodyStyle]}
      >
        {item.type === "loading" ? (
          <ActivityIndicator color={theme.colors.toastMuted} />
        ) : (
          // The toast palette is always dark in both modes, so a light-mode status foreground would
          // fail contrast on it. The glyph shape carries the type; the tint stays on-chrome.
          <Icon
            color={theme.colors.toastText}
            name={item.type === "success" ? "circle-check" : "exclamation-circle"}
            size="lg"
          />
        )}
        <View style={layout.copy}>
          <Text allowFontScaling numberOfLines={2} style={titleStyle}>
            {item.title}
          </Text>
          {item.description === undefined ? null : (
            <Text allowFontScaling numberOfLines={3} style={descriptionStyle}>
              {item.description}
            </Text>
          )}
        </View>
      </Pressable>
      {item.action === undefined ? null : (
        <Pressable
          accessibilityLabel={item.action.label}
          accessibilityRole="button"
          onPress={() => {
            invokeToastAction(item.id);
          }}
          style={({ pressed }) => [
            layout.action,
            {
              backgroundColor: theme.colors.toastText,
              borderCurve: "continuous",
              borderRadius: theme.metrics.radius.control,
              minHeight: theme.metrics.interaction.touchTarget,
              opacity: pressed ? theme.metrics.interaction.pressedOpacity : 1,
              paddingHorizontal: theme.metrics.button.paddingInline,
            },
          ]}
        >
          <Text
            allowFontScaling
            style={{
              color: theme.colors.toastActionText,
              fontSize: theme.metrics.font.detailSize,
              fontWeight: theme.metrics.font.weightSemibold,
              lineHeight: theme.metrics.font.detailLeading,
            }}
          >
            {item.action.label}
          </Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

export { Toaster, toast };
export type { ToastAction, ToasterProps, ToastItem, ToastOptions, ToastType };
