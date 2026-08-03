import { Image } from "expo-image";
import * as React from "react";
import { StyleSheet, View, useColorScheme, type StyleProp, type ViewStyle } from "react-native";

import {
  ICON_SF_SYMBOL,
  ICON_SIZE,
  iconTint,
  type IconName,
  type IconSize,
  type IconTone,
} from "./icon-symbols.native";
import { resolveNativeTheme } from "./theme";

// Expo's babel plugin inlines EXPO_OS at bundle time so the unreachable branch below is dropped.
// @honk/ui carries neither @types/node nor expo's env types, so the one field this leaf reads is
// declared here rather than pulling a types package in for it.
declare const process: { readonly env: { readonly EXPO_OS?: string } };

// Parity note: web takes `icon: Glyph` (a central-icons component); a React SVG component cannot
// cross into React Native, so the native leaf takes `name: IconName`. Every other prop — size, tone,
// label, style — matches the web contract so call sites read the same.
interface IconProps {
  name: IconName;
  size?: IconSize;
  tone?: IconTone;
  // Native has no `currentColor`. Pass the color the surrounding chrome already paints with when
  // `tone` cannot name it, such as the always-dark toast palette.
  color?: string;
  // Omit label for decorative glyphs. Provide label when the icon is the sole cue.
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const layout = StyleSheet.create({
  root: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
  },
  glyph: {
    height: "100%",
    width: "100%",
  },
});

function Icon({
  name,
  size = "md",
  tone = "current",
  color,
  label,
  style,
  testID,
}: IconProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  const box: ViewStyle = { height: ICON_SIZE[size], width: ICON_SIZE[size] };

  return (
    <View
      {...(label === undefined
        ? {
            accessibilityElementsHidden: true,
            importantForAccessibility: "no-hide-descendants" as const,
          }
        : { accessibilityLabel: label, accessibilityRole: "image" as const })}
      pointerEvents="none"
      style={[layout.root, box, style]}
      testID={testID}
    >
      {/*
        Android renders nothing here on purpose. expo-image serves `sf:` from an iOS-only loader
        (ios/Loaders/SFSymbolLoader.swift, with no Android counterpart), central-icons emits DOM SVG
        hosts React Native cannot mount, and every remaining Android glyph source is a dependency
        this package does not carry — inventing one is not this leaf's call. The box still reserves
        its size so layout does not shift, which makes the rule explicit: a native Icon is never a
        call site's only cue. Pair it with visible text, or put the accessibilityLabel on the
        enclosing pressable.
      */}
      {process.env.EXPO_OS === "ios" ? (
        <Image
          contentFit="contain"
          source={`sf:${ICON_SF_SYMBOL[name]}`}
          style={layout.glyph}
          tintColor={color ?? iconTint(theme.colors, tone)}
        />
      ) : null}
    </View>
  );
}

export { Icon };
export type { IconName, IconProps, IconSize, IconTone };
