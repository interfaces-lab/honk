import * as React from "react";
import { FlatList } from "react-native";
import { Redirect, Stack } from "expo-router";

import { useRemote } from "../../../src/remote-context";
import { ThreadRow } from "../../../src/thread-row";
import { EmptyState, LoadingState, Page } from "../../../src/ui";

export default function ActivityRoute(): React.ReactElement {
  const remote = useRemote();
  const [refreshing, setRefreshing] = React.useState(false);
  if (remote.client === null) return <Redirect href="/connect" />;
  if (remote.workspace === null) return <LoadingState label="Loading activity…" />;

  const activeThreads = remote.workspace.threads.filter(
    (thread) =>
      thread.rowStatus === "running" ||
      thread.rowStatus === "needs_attention" ||
      thread.rowStatus === "error",
  );
  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await remote.refreshWorkspace();
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <Page>
      <Stack.Screen options={{ title: "Activity" }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={activeThreads}
        keyExtractor={(thread) => String(thread.id)}
        ListEmptyComponent={
          <EmptyState body="Running and attention-needed tasks appear here." title="All caught up" />
        }
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        renderItem={({ item }) => (
          <ThreadRow
            href={{
              pathname: "/(tabs)/activity/[threadId]",
              params: { threadId: String(item.id) },
            }}
            readAt={remote.workspace?.uiState.threadReadAt[String(item.id)] ?? null}
            thread={item}
          />
        )}
      />
    </Page>
  );
}
