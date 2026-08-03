import * as React from "react";
import { useColorScheme } from "react-native";
import { Stack } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Toaster } from "@honk/ui";

import { RemoteProvider } from "../src/remote";
import { ConnectionLinkProvider } from "../src/connection-link-provider";
import { ManagedRemoteProvider } from "../src/managed-remote-context";
import { useHonkTheme } from "../src/ui";

function RootNavigator(): React.ReactElement {
  const theme = useHonkTheme();
  const insets = useSafeAreaInsets();
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const navigationTheme: Theme = {
    ...(mode === "dark" ? DarkTheme : DefaultTheme),
    colors: {
      ...(mode === "dark" ? DarkTheme.colors : DefaultTheme.colors),
      background: theme.colors.bgBase,
      border: theme.colors.borderBase,
      card: theme.colors.bgBase,
      notification: theme.colors.errFg,
      primary: theme.colors.accent,
      text: theme.colors.textPrimary,
    },
  };
  return (
    <ThemeProvider value={navigationTheme}>
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
          options={{ presentation: "modal", sheetGrabberVisible: true, title: "New session" }}
        />
        <Stack.Screen
          name="session/[serverKey]/[sessionId]/settings"
          options={{ presentation: "modal", sheetGrabberVisible: true, title: "Session settings" }}
        />
      </Stack>
      <Toaster topInset={insets.top} />
    </ThemeProvider>
  );
}

export default function RootLayout(): React.ReactElement {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <ManagedRemoteProvider>
          <RemoteProvider>
            <ConnectionLinkProvider>
              <RootNavigator />
            </ConnectionLinkProvider>
          </RemoteProvider>
        </ManagedRemoteProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
