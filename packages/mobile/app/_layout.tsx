import * as React from "react";
import { useColorScheme } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { RemoteProvider } from "../src/remote";
import { useHonkTheme } from "../src/ui";

function RootNavigator(): React.ReactElement {
  const theme = useHonkTheme();
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: theme.colors.bgBase },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.colors.bgBase },
          headerTintColor: theme.colors.textPrimary,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="connect" options={{ headerShown: false }} />
        <Stack.Screen name="pair" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="new"
          options={{ presentation: "modal", sheetGrabberVisible: true, title: "New task" }}
        />
        <Stack.Screen name="archived" options={{ title: "Archived tasks" }} />
        <Stack.Screen
          name="task/[threadId]"
          options={{ presentation: "modal", sheetGrabberVisible: true, title: "Task settings" }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout(): React.ReactElement {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <RemoteProvider>
        <RootNavigator />
      </RemoteProvider>
    </GestureHandlerRootView>
  );
}
