import * as React from "react";
import Stack from "expo-router/stack";

import { useHonkTheme } from "../../../src/ui";

export default function SettingsLayout(): React.ReactElement {
  const theme = useHonkTheme();
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: theme.colors.bgBase },
        headerLargeStyle: { backgroundColor: theme.colors.bgBase },
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.bgBase },
        headerTintColor: theme.colors.textPrimary,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings" }} />
    </Stack>
  );
}
