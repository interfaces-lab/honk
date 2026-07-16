import {
  OPEN_CODE_SESSION_CAPABILITIES,
  openCodeServerKey,
  openCodeSessionRef,
  type OpenCodeSessionInfo,
} from "@honk/opencode";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import * as React from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { useRemote } from "../../../../src/remote-context";
import {
  ActionButton,
  BodyText,
  DetailText,
  LoadingState,
  Page,
  useHonkTheme,
} from "../../../../src/ui";

export default function SessionSettingsRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const params = useLocalSearchParams<{ serverKey: string; sessionId: string }>();
  const serverKey = openCodeServerKey(params.serverKey);
  const sessionId = params.sessionId;
  const client = remote.clientFor(serverKey);
  const [info, setInfo] = React.useState<OpenCodeSessionInfo | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    if (client === null || sessionId.length === 0) return;
    void client.sessions
      .get(openCodeSessionRef(serverKey, sessionId))
      .then((next) => {
        if (active) setInfo(next);
      })
      .catch((cause: unknown) => {
        if (active) {
          setMessage(cause instanceof Error ? cause.message : "The session could not be loaded.");
        }
      });
    return () => {
      active = false;
    };
  }, [client, serverKey, sessionId]);

  if (client === null) return <Redirect href="/connect" />;
  if (info === null && message === null) return <LoadingState label="Loading session settings…" />;

  const copyID = async (): Promise<void> => {
    await Clipboard.setStringAsync(sessionId);
    await Haptics.selectionAsync();
    setMessage("Session ID copied.");
  };

  return (
    <Page>
      <Stack.Screen options={{ title: "Session settings" }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { gap: theme.metrics.space.sectionGap, padding: theme.metrics.space.screenGutter },
        ]}
        contentInsetAdjustmentBehavior="automatic"
      >
        {info === null ? null : (
          <>
            <View style={{ gap: theme.metrics.space.compactGap }}>
              <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
                {info.title}
              </BodyText>
              <DetailText>
                Automatic title generation and manual rename remain unavailable until the canonical
                server protocol exposes session title mutation.
              </DetailText>
            </View>

            <View style={{ gap: theme.metrics.space.compactGap }}>
              <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Details</BodyText>
              <DetailText selectable>{info.location.directory}</DetailText>
              <DetailText>
                {
                  remote.servers.find((server) => server.descriptor.key === serverKey)?.descriptor
                    .label
                }
              </DetailText>
              <DetailText>
                {info.model === undefined ? "Default model" : info.model.id}
                {info.model?.variant === undefined ? "" : ` · ${info.model.variant}`}
              </DetailText>
              <DetailText selectable>{sessionId}</DetailText>
              <View style={styles.leadingAction}>
                <ActionButton
                  label="Copy session ID"
                  onPress={() => void copyID()}
                  tone="neutral"
                />
              </View>
            </View>
          </>
        )}

        {message === null ? null : (
          <DetailText accessibilityLiveRegion="polite">{message}</DetailText>
        )}

        <View style={{ gap: theme.metrics.space.rowGap }}>
          <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
            Session lifecycle
          </BodyText>
          <ActionButton
            disabled={!OPEN_CODE_SESSION_CAPABILITIES.rename}
            label="Rename unavailable"
            onPress={() => undefined}
            tone="neutral"
          />
          <ActionButton
            disabled={!OPEN_CODE_SESSION_CAPABILITIES.archive}
            label="Archive unavailable"
            onPress={() => undefined}
            tone="neutral"
          />
          <ActionButton
            disabled={!OPEN_CODE_SESSION_CAPABILITIES.remove}
            label="Delete unavailable"
            onPress={() => undefined}
            tone="destructive"
          />
        </View>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  leadingAction: { alignItems: "flex-start" },
});
