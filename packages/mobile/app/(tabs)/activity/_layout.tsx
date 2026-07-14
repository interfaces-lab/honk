import * as React from "react";
import { Stack } from "expo-router";

import { useHonkTheme } from "../../../src/ui";

export default function ActivityLayout(): React.ReactElement {
  const theme = useHonkTheme();
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: theme.colors.bgBase },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.bgBase },
        headerTintColor: theme.colors.textPrimary,
      }}
    />
  );
}
