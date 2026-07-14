import * as React from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from "react-native";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { TextField } from "@honk/ui/text-field";

import { parseOpenCodeConnection } from "./pairing";
import { useRemote } from "./remote-context";
import { ActionButton, BodyText, DetailText, Page, useHonkTheme } from "./ui";

export function ConnectScreen(): React.ReactElement {
  const theme = useHonkTheme();
  const linkingUrl = Linking.useLinkingURL();
  const params = useLocalSearchParams<{ origin?: string; password?: string; token?: string }>();
  const remote = useRemote();
  const [form, setForm] = React.useState(() => ({
    origin: params.origin ?? remote.origin ?? "",
    connectionValue: params.password ?? params.token ?? "",
    defaultCwd: remote.defaultCwd,
  }));
  const [localError, setLocalError] = React.useState<string | null>(null);
  const consumedUrl = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (linkingUrl === null || consumedUrl.current === linkingUrl) return;
    consumedUrl.current = linkingUrl;
    try {
      const candidate = parseOpenCodeConnection(linkingUrl, form.origin);
      if (candidate === null) return;
      setForm((current) => ({
        ...current,
        origin: candidate.origin,
        connectionValue: linkingUrl,
      }));
    } catch {
      // Expo development links and unrelated universal links are ignored.
    }
  }, [linkingUrl, form.origin]);

  const submit = async (): Promise<void> => {
    setLocalError(null);
    try {
      const candidate = parseOpenCodeConnection(form.connectionValue, form.origin);
      if (candidate === null) {
        throw new Error("Paste a Honk attach link, or enter the OpenCode password.");
      }
      await remote.connect({
        origin: candidate.origin,
        password: candidate.password,
        defaultCwd: form.defaultCwd,
      });
      router.replace("/");
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "Pairing failed.");
    }
  };

  const pending = remote.status === "connecting" || remote.status === "restoring";

  return (
    <Page>
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
        style={styles.fill}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              gap: theme.metrics.space.sectionGap,
              padding: theme.metrics.space.screenGutter,
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: theme.metrics.space.contentGap }}>
            <BodyText
              accessibilityRole="header"
              style={{
                fontSize: theme.metrics.font.titleSize,
                fontWeight: theme.metrics.font.weightSemibold,
                lineHeight: theme.metrics.font.titleLeading,
              }}
            >
              Connect to OpenCode
            </BodyText>
            <DetailText>
              Start the Honk host on your computer, then open its attach link or enter the server
              address and password. Use HTTP only over a trusted LAN or encrypted tailnet.
            </DetailText>
          </View>

          {remote.hasCredential ? (
            <View
              style={[
                styles.saved,
                {
                  backgroundColor: theme.colors.layer01,
                  borderColor: theme.colors.borderBase,
                  borderRadius: theme.metrics.radius.panel,
                  borderWidth: theme.metrics.field.borderWidth,
                  gap: theme.metrics.space.contentGap,
                  padding: theme.metrics.space.panelPad,
                },
              ]}
            >
              <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
                Saved connection
              </BodyText>
              <DetailText selectable>{remote.origin}</DetailText>
              <DetailText>Status: {remote.status}</DetailText>
              <ActionButton label="Retry connection" onPress={() => void remote.retry()} />
              <ActionButton
                label="Forget this device"
                onPress={() => void remote.disconnect()}
                tone="destructive"
              />
            </View>
          ) : (
            <View style={{ gap: theme.metrics.space.rowGap }}>
              <TextField
                autoCapitalize="none"
                autoComplete="url"
                autoCorrect={false}
                inputMode="url"
                label="OpenCode address"
                onChangeText={(origin) => setForm((current) => ({ ...current, origin }))}
                placeholder="https://honk.example.com"
                value={form.origin}
              />
              <TextField
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                label="Attach link or password"
                onChangeText={(connectionValue) =>
                  setForm((current) => ({ ...current, connectionValue }))
                }
                placeholder="honk://connect?origin=…"
                secureTextEntry={!form.connectionValue.includes("://")}
                value={form.connectionValue}
              />
              <TextField
                autoCapitalize="none"
                autoCorrect={false}
                label="Default project folder"
                onChangeText={(defaultCwd) =>
                  setForm((current) => ({ ...current, defaultCwd }))
                }
                placeholder="/Users/you/Developer/project"
                value={form.defaultCwd}
              />
              <ActionButton label="Connect" onPress={() => void submit()} pending={pending} />
            </View>
          )}

          {localError ?? remote.error ? (
            <DetailText accessibilityLiveRegion="polite" style={{ color: theme.colors.errFg }}>
              {localError ?? remote.error}
            </DetailText>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
  },
  saved: {
    width: "100%",
  },
});
