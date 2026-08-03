import type { OpenCodeServerKey } from "@honk/opencode";
import { Stack, router } from "expo-router";
import * as React from "react";
import { Alert, ScrollView, View } from "react-native";

import { ComputerRow } from "../../../src/computer-row";
import { ManagedComputerRows } from "../../../src/managed-computer-rows";
import { useRemote } from "../../../src/remote-context";
import {
  ActionButton,
  DetailText,
  EmptyState,
  LoadingState,
  Page,
  useHonkTheme,
} from "../../../src/ui";

export default function ComputersRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const [expanded, setExpanded] = React.useState<OpenCodeServerKey | null>(remote.activeServerKey);
  const savedEnvironmentIds = new Set(
    remote.servers.flatMap((server) =>
      server.environmentId === null ? [] : [server.environmentId],
    ),
  );

  if (remote.status === "restoring") return <LoadingState label="Restoring computers…" />;

  const remove = (server: OpenCodeServerKey, label: string): void => {
    Alert.alert(
      `Remove ${label} from this phone?`,
      "Honk will delete this phone’s saved credential. This does not unlink the computer from cloud access or revoke other devices.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void remote.disconnect(server).catch((error: unknown) => {
              Alert.alert(
                "Could not remove computer",
                error instanceof Error ? error.message : "Try again.",
              );
            });
          },
        },
      ],
    );
  };

  return (
    <Page>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          accessibilityLabel="Add computer"
          icon="plus"
          onPress={() => router.push("/connect")}
        />
      </Stack.Toolbar>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: theme.metrics.space.contentGap,
          padding: theme.metrics.space.screenGutter,
        }}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        {remote.servers.length === 0 ? (
          <View style={{ flex: 1, gap: theme.metrics.space.sectionGap }}>
            <EmptyState
              body="Scan the QR code shown by Honk on your computer to add it to this phone."
              title="No computers on this phone"
            />
            <ActionButton label="Add computer" onPress={() => router.push("/connect")} />
          </View>
        ) : (
          remote.servers.map((server) => (
            <ComputerRow
              key={server.descriptor.key}
              active={remote.activeServerKey === server.descriptor.key}
              expanded={expanded === server.descriptor.key}
              onRepair={() => router.push("/connect")}
              onRemove={() => remove(server.descriptor.key, server.descriptor.label)}
              onRetry={() => {
                void remote.retry(server.descriptor.key);
              }}
              onSelect={() => remote.selectServer(server.descriptor.key)}
              onToggle={() =>
                setExpanded((current) =>
                  current === server.descriptor.key ? null : server.descriptor.key,
                )
              }
              server={server}
            />
          ))
        )}
        {remote.servers.length === 0 ? null : (
          <DetailText>
            Honk reconnects saved computers automatically after launch, network changes, and long
            background pauses.
          </DetailText>
        )}
        <ManagedComputerRows savedEnvironmentIds={savedEnvironmentIds} />
      </ScrollView>
    </Page>
  );
}
