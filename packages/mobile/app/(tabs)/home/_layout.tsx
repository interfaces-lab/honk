import * as React from "react";
import Stack from "expo-router/stack";

import { useHonkTheme } from "../../../src/ui";

export default function HomeLayout(): React.ReactElement {
  const theme = useHonkTheme();
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: theme.colors.bgBase },
        headerBackButtonDisplayMode: "minimal",
        headerBlurEffect: "none",
        headerLargeStyle: { backgroundColor: theme.colors.bgBase },
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.bgBase },
        headerTintColor: theme.colors.textPrimary,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Sessions" }} />
      <Stack.Screen
        name="server/[serverKey]/session/[sessionId]"
        options={{ headerLargeTitle: false }}
      />
    </Stack>
  );
}
