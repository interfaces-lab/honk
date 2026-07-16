import * as React from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, router } from "expo-router";
import { TextField } from "@honk/ui/text-field";

import { useRemote } from "../../../src/remote-context";
import {
  ActionButton,
  BodyText,
  DetailText,
  Page,
  SystemButton,
  useHonkTheme,
} from "../../../src/ui";

export default function SettingsRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const activeServer = remote.activeServer;
  const [cwd, setCwd] = React.useState(remote.activeServer?.defaultDirectory ?? "");
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(
    () => setCwd(remote.activeServer?.defaultDirectory ?? ""),
    [remote.activeServer?.defaultDirectory],
  );

  if (activeServer === null || remote.client === null) return <Redirect href="/connect" />;

  const save = async (): Promise<void> => {
    setPending(true);
    setMessage(null);
    try {
      await remote.setDefaultDirectory(activeServer.descriptor.key, cwd);
      setMessage("Default project folder saved.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The setting could not be saved.");
    } finally {
      setPending(false);
    }
  };

  const confirmDisconnect = (): void => {
    Alert.alert(
      "Disconnect this device?",
      "Honk will remove the saved host credential from this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            void remote.disconnect(activeServer.descriptor.key).then(() => router.replace("/connect"));
          },
        },
      ],
    );
  };

  return (
    <Page>
      <Stack.Screen options={{ title: "Settings" }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            gap: theme.metrics.space.sectionGap,
            padding: theme.metrics.space.screenGutter,
          },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: theme.metrics.space.contentGap }}>
          <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Honk host</BodyText>
          <DetailText>{activeServer.descriptor.label}</DetailText>
          <DetailText selectable>{activeServer.descriptor.origin}</DetailText>
          <DetailText>Status: {remote.status}</DetailText>
        </View>

        <View style={{ gap: theme.metrics.space.rowGap }}>
          <TextField
            autoCapitalize="none"
            autoCorrect={false}
            label="Default project folder"
            onChangeText={setCwd}
            placeholder="/Users/you/Developer/project"
            value={cwd}
          />
          <ActionButton label="Save" onPress={() => void save()} pending={pending} tone="neutral" />
          {message === null ? null : (
            <DetailText accessibilityLiveRegion="polite">{message}</DetailText>
          )}
        </View>

        <SystemButton label="Manage servers" onPress={() => router.push("/connect")} />
        <SystemButton label="Open archived sessions" onPress={() => router.push("/archived")} />
        <ActionButton
          label="Disconnect this device"
          onPress={confirmDisconnect}
          tone="destructive"
        />
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
});
