import * as React from "react";
import { FlatList, type ListRenderItemInfo } from "react-native";
import { Redirect, Stack } from "expo-router";
import { openCodeSessionKey } from "@honk/opencode";

import { useRemote } from "../src/remote-context";
import type { RemoteSession } from "../src/remote-context";
import { ThreadRow } from "../src/thread-row";
import { EmptyState, Page, useHonkTheme } from "../src/ui";

// OpenCode exposes archived sessions in the session index but offers no
// restore/delete operations, so this screen is read-only.
export default function ArchivedTasksRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const [refreshing, setRefreshing] = React.useState(false);

  if (remote.servers.length === 0) return <Redirect href="/connect" />;

  const sessions = remote.sessions.filter(
    (session) => session.info.time.archived !== undefined,
  );

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await remote.refreshSessions();
    } finally {
      setRefreshing(false);
    }
  };

  const renderItem = ({ item }: ListRenderItemInfo<RemoteSession>): React.ReactElement => (
    <ThreadRow
      href={{
        pathname: "/(tabs)/home/server/[serverKey]/session/[sessionId]",
        params: { serverKey: item.ref.server, sessionId: item.ref.sessionID },
      }}
      session={item}
    />
  );

  return (
    <Page>
      <Stack.Screen options={{ title: "Archived sessions" }} />
      <FlatList
        contentContainerStyle={[
          { paddingHorizontal: theme.metrics.space.screenGutter },
          sessions.length === 0 ? { flexGrow: 1 } : undefined,
        ]}
        contentInsetAdjustmentBehavior="automatic"
        data={sessions}
        keyExtractor={(session) => openCodeSessionKey(session.ref)}
        ListEmptyComponent={
          <EmptyState body="Archived sessions will appear here." title="No archived sessions" />
        }
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        renderItem={renderItem}
      />
    </Page>
  );
}
