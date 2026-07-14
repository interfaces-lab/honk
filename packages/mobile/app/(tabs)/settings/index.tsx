import * as React from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, router } from "expo-router";
import type { AuthSnapshot, ModelCatalog } from "@honk/api/core/v1";
import { TextField } from "@honk/ui/text-field";

import { useRemote } from "../../../src/remote-context";
import { ActionButton, BodyText, DetailText, Page, useHonkTheme } from "../../../src/ui";

export default function SettingsRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const [cwd, setCwd] = React.useState(remote.defaultCwd);
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [auth, setAuth] = React.useState<AuthSnapshot | null>(null);
  const [catalog, setCatalog] = React.useState<ModelCatalog | null>(null);

  React.useEffect(() => setCwd(remote.defaultCwd), [remote.defaultCwd]);
  React.useEffect(() => {
    let active = true;
    if (remote.client === null) return;
    void Promise.all([remote.client.auth.get(), remote.client.models.catalog()])
      .then(([nextAuth, nextCatalog]) => {
        if (!active) return;
        setAuth(nextAuth);
        setCatalog(nextCatalog);
      })
      .catch((cause: unknown) => {
        if (active) setMessage(cause instanceof Error ? cause.message : "Core status could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [remote.client]);
  if (remote.client === null) return <Redirect href="/connect" />;

  const save = async (): Promise<void> => {
    setPending(true);
    setMessage(null);
    try {
      await remote.setDefaultCwd(cwd);
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
      "Honk will revoke this mobile session when Core is reachable and remove the saved bearer.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            void remote.disconnect().then(() => router.replace("/connect"));
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
          <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Core</BodyText>
          <DetailText selectable>{remote.origin}</DetailText>
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

        <View style={{ gap: theme.metrics.space.rowGap }}>
          <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Models</BodyText>
          {catalog === null ? (
            <DetailText>Loading model availability…</DetailText>
          ) : (
            catalog.models.map((model) => (
              <View key={String(model.id)} style={{ gap: theme.metrics.space.compactGap }}>
                <BodyText>{model.name}</BodyText>
                <DetailText style={{ color: model.available ? theme.colors.okFg : theme.colors.textMuted }}>
                  {model.available ? "Available" : "Unavailable"} · {model.provider}
                </DetailText>
              </View>
            ))
          )}
        </View>

        <View style={{ gap: theme.metrics.space.rowGap }}>
          <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Authentication</BodyText>
          {auth === null ? (
            <DetailText>Loading authentication status…</DetailText>
          ) : (
            <>
              {auth.credentials.map((credential) => (
                <View key={credential.kind} style={{ gap: theme.metrics.space.compactGap }}>
                  <BodyText>{credential.kind}</BodyText>
                  <DetailText>
                    {credential.state}
                    {credential.label === null ? "" : ` · ${credential.label}`}
                  </DetailText>
                </View>
              ))}
              {auth.harnesses.map((harness) => (
                <View key={harness.harness} style={{ gap: theme.metrics.space.compactGap }}>
                  <BodyText>{harness.harness}</BodyText>
                  <DetailText>
                    {harness.available ? "Available" : "Unavailable"}
                    {harness.detail === null ? "" : ` · ${harness.detail}`}
                  </DetailText>
                </View>
              ))}
              <DetailText>
                Sign-in changes stay on the trusted Core host; mobile only reads availability.
              </DetailText>
            </>
          )}
        </View>

        <View style={{ gap: theme.metrics.space.rowGap }}>
          <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Paired devices</BodyText>
          <DetailText>
            Device inventory is restricted to a Core App. Run `honk-core devices` on the Core host
            to inspect sessions or `honk-core revoke &lt;session-id&gt;` to revoke one.
          </DetailText>
        </View>

        <ActionButton
          label="Open archived tasks"
          onPress={() => router.push("/archived")}
          tone="neutral"
        />

        <ActionButton label="Disconnect this device" onPress={confirmDisconnect} tone="destructive" />
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
});
