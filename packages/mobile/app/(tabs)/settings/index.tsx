import * as React from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { TextField } from "@honk/ui/text-field";

import { presentRemoteServerConnection } from "../../../src/connection-presentation";
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
  const activeServerKey = activeServer?.descriptor.key ?? null;
  const activeDirectory = activeServer?.defaultDirectory ?? "";
  const [directoryDraft, setDirectoryDraft] = React.useState({
    server: activeServerKey,
    value: activeDirectory,
  });
  const cwd = directoryDraft.server === activeServerKey ? directoryDraft.value : activeDirectory;
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const save = async (): Promise<void> => {
    if (activeServer === null) return;
    setPending(true);
    setMessage(null);
    await remote
      .setDefaultDirectory(activeServer.descriptor.key, cwd)
      .then(
        () => setMessage("Default project folder saved."),
        (cause: unknown) =>
          setMessage(cause instanceof Error ? cause.message : "The setting could not be saved."),
      )
      .finally(() => setPending(false));
  };

  const confirmDisconnect = (): void => {
    if (activeServer === null) return;
    Alert.alert(
      `Remove ${activeServer.descriptor.label} from this phone?`,
      "Honk will delete this phone’s saved credential. Revoke the phone on your computer if you also need to end an active device session.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            void remote.disconnect(activeServer.descriptor.key).then(
              () => router.push("/(tabs)/settings/computers"),
              (error: unknown) =>
                Alert.alert(
                  "Could not remove computer",
                  error instanceof Error ? error.message : "Try again.",
                ),
            );
          },
        },
      ],
    );
  };

  return (
    <Page>
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
          <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Computers</BodyText>
          <DetailText>
            {remote.servers.length === 0
              ? "Pair a computer once, then Honk reconnects whenever it is reachable."
              : `${remote.servers.length} saved ${
                  remote.servers.length === 1 ? "computer" : "computers"
                }`}
          </DetailText>
          <SystemButton
            label={remote.servers.length === 0 ? "Add computer" : "Manage computers"}
            onPress={() =>
              router.push(remote.servers.length === 0 ? "/connect" : "/(tabs)/settings/computers")
            }
          />
        </View>

        {activeServer === null ? null : (
          <>
            <View style={{ gap: theme.metrics.space.contentGap }}>
              <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
                Default computer
              </BodyText>
              <DetailText>{activeServer.descriptor.label}</DetailText>
              <DetailText selectable>{activeServer.descriptor.origin}</DetailText>
              <DetailText>Status: {presentRemoteServerConnection(activeServer).title}</DetailText>
            </View>

            <View style={{ gap: theme.metrics.space.rowGap }}>
              <TextField
                autoCapitalize="none"
                autoCorrect={false}
                label="Default project folder"
                onChangeText={(value) => setDirectoryDraft({ server: activeServerKey, value })}
                placeholder="/Users/you/Developer/project"
                value={cwd}
              />
              <ActionButton
                label="Save"
                onPress={() => void save()}
                pending={pending}
                tone="neutral"
              />
              {message === null ? null : (
                <DetailText accessibilityLiveRegion="polite">{message}</DetailText>
              )}
            </View>

            <ActionButton
              label="Remove from this phone"
              onPress={confirmDisconnect}
              tone="destructive"
            />
          </>
        )}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
});
