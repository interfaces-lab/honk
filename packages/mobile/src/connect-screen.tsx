import * as React from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import { router, useLocalSearchParams } from "expo-router";
import { exchangeHonkPairing } from "@honk/opencode";
import { TextField } from "@honk/ui/text-field";

import { normalizeRemoteOrigin, parseOpenCodeConnection } from "./pairing";
import { useRemote } from "./remote-context";
import { ActionButton, BodyText, DetailText, Page, useHonkTheme } from "./ui";

const CONSUMED_PAIRING_DIGEST_KEY = "honk.mobile.consumed-pairing";

export function ConnectScreen(): React.ReactElement {
  const theme = useHonkTheme();
  const linkingUrl = Linking.useLinkingURL();
  const params = useLocalSearchParams<{ origin?: string; password?: string; token?: string }>();
  const remote = useRemote();
  const [form, setForm] = React.useState(() => ({
    origin: params.origin ?? remote.activeServer?.descriptor.origin ?? "",
    connectionValue: params.password ?? params.token ?? "",
    defaultDirectory: remote.activeServer?.defaultDirectory ?? "",
  }));
  const [localError, setLocalError] = React.useState<string | null>(null);
  const consumedUrl = React.useRef<string | null>(null);

  const connectValue = React.useCallback(
    async (connectionValue: string, fallbackOrigin: string): Promise<void> => {
      const candidate = parseOpenCodeConnection(connectionValue, fallbackOrigin);
      if (candidate === null) {
        throw new Error("Paste a Honk attach link, or enter the Honk host password.");
      }
      const origin = normalizeRemoteOrigin(candidate.origin);
      const connection =
        candidate.credential.type === "pairing"
          ? await exchangeHonkPairing(origin, candidate.credential.value, {
              label: "Honk mobile",
            })
          : { origin, password: candidate.credential.value };
      await remote.connect({
        ...connection,
        defaultDirectory: form.defaultDirectory,
      });
      router.replace("/");
    },
    [form.defaultDirectory, remote],
  );

  React.useEffect(() => {
    if (linkingUrl === null || consumedUrl.current === linkingUrl) return;
    consumedUrl.current = linkingUrl;
    let candidate;
    try {
      candidate = parseOpenCodeConnection(linkingUrl, form.origin);
    } catch {
      // Expo development links and unrelated universal links are ignored.
      return;
    }
    if (candidate === null || candidate.credential.type !== "pairing") return;
    void (async () => {
      const digest = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        linkingUrl,
      );
      if ((await SecureStore.getItemAsync(CONSUMED_PAIRING_DIGEST_KEY)) === digest) return;
      setForm((current) => ({
        ...current,
        origin: candidate.origin,
        connectionValue: "",
      }));
      setLocalError(null);
      await connectValue(linkingUrl, form.origin);
      await SecureStore.setItemAsync(CONSUMED_PAIRING_DIGEST_KEY, digest);
    })().catch((cause: unknown) => {
      setLocalError(cause instanceof Error ? cause.message : "Pairing failed.");
    });
  }, [connectValue, form.origin, linkingUrl]);

  const submit = async (): Promise<void> => {
    setLocalError(null);
    try {
      await connectValue(form.connectionValue, form.origin);
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
              Connect to Honk
            </BodyText>
            <DetailText>
              Start Honk on your computer, then open its attach link or enter the host address and
              password. Remote connections require HTTPS.
            </DetailText>
          </View>

          {remote.servers.map((server) => (
            <View
              key={server.descriptor.key}
              style={[
                styles.saved,
                {
                  backgroundColor: theme.colors.layer01,
                  borderColor:
                    server.descriptor.key === remote.activeServerKey
                      ? theme.colors.accent
                      : theme.colors.borderBase,
                  borderRadius: theme.metrics.radius.panel,
                  borderWidth: theme.metrics.field.borderWidth,
                  gap: theme.metrics.space.contentGap,
                  padding: theme.metrics.space.panelPad,
                },
              ]}
            >
              <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
                {server.descriptor.label}
              </BodyText>
              <DetailText selectable>{server.descriptor.origin}</DetailText>
              <DetailText>Status: {server.status}</DetailText>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: theme.metrics.space.contentGap,
                }}
              >
                <ActionButton
                  label="Use server"
                  onPress={() => remote.selectServer(server.descriptor.key)}
                  tone="neutral"
                />
                <ActionButton
                  label="Retry"
                  onPress={() => void remote.retry(server.descriptor.key)}
                  tone="neutral"
                />
                <ActionButton
                  label="Forget"
                  onPress={() => void remote.disconnect(server.descriptor.key)}
                  tone="destructive"
                />
              </View>
            </View>
          ))}

          <View style={{ gap: theme.metrics.space.rowGap }}>
            <TextField
              autoCapitalize="none"
              autoComplete="url"
              autoCorrect={false}
              inputMode="url"
              label="Honk host address"
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
              onChangeText={(defaultDirectory) =>
                setForm((current) => ({ ...current, defaultDirectory }))
              }
              placeholder="/Users/you/Developer/project"
              value={form.defaultDirectory}
            />
            <ActionButton
              label={remote.hasCredential ? "Add server" : "Connect to Honk"}
              onPress={() => void submit()}
              pending={pending}
            />
          </View>

          {(localError ?? remote.error) ? (
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
