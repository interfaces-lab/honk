import * as React from "react";
import { Alert, FlatList, View, type ListRenderItemInfo } from "react-native";
import { Redirect, Stack } from "expo-router";
import type { ThreadSummary } from "@honk/api/core/v1";

import { useRemote } from "../src/remote-context";
import { ThreadRow } from "../src/thread-row";
import { ActionButton, DetailText, EmptyState, Page, useHonkTheme } from "../src/ui";

export default function ArchivedTasksRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const [threads, setThreads] = React.useState<ReadonlyArray<ThreadSummary>>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (): Promise<void> => {
    if (remote.client === null) return;
    setError(null);
    try {
      const result = await remote.client.threads.list({ archived: true });
      setThreads(result.threads);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Archived tasks could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [remote.client]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (remote.client === null) return <Redirect href="/connect" />;

  const unarchive = async (thread: ThreadSummary): Promise<void> => {
    await remote.client?.threads.unarchive(thread.id);
    setThreads((current) => current.filter((item) => item.id !== thread.id));
    await remote.refreshWorkspace();
  };

  const remove = (thread: ThreadSummary): void => {
    Alert.alert(
      `Delete “${thread.title}”?`,
      "This permanently removes the task, conversation, attachments, and checkpoints from Core.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void remote.client?.threads
              .remove(thread.id)
              .then(() => setThreads((current) => current.filter((item) => item.id !== thread.id)))
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : "The task could not be deleted."),
              );
          },
        },
      ],
    );
  };

  const renderItem = ({ item }: ListRenderItemInfo<ThreadSummary>): React.ReactElement => (
    <View>
      <ThreadRow
        href={{ pathname: "/(tabs)/home/[threadId]", params: { threadId: String(item.id) } }}
        thread={item}
      />
      <View
        style={{
          flexDirection: "row",
          gap: theme.metrics.space.contentGap,
          justifyContent: "flex-end",
          padding: theme.metrics.space.contentGap,
        }}
      >
        <ActionButton label="Restore" onPress={() => void unarchive(item)} tone="neutral" />
        <ActionButton label="Delete" onPress={() => remove(item)} tone="destructive" />
      </View>
    </View>
  );

  return (
    <Page>
      <Stack.Screen options={{ title: "Archived tasks" }} />
      {error === null ? null : (
        <DetailText
          accessibilityLiveRegion="polite"
          style={{ color: theme.colors.errFg, padding: theme.metrics.space.screenGutter }}
        >
          {error}
        </DetailText>
      )}
      <FlatList
        contentContainerStyle={threads.length === 0 ? { flexGrow: 1 } : undefined}
        contentInsetAdjustmentBehavior="automatic"
        data={threads}
        keyExtractor={(thread) => String(thread.id)}
        ListEmptyComponent={
          loading ? (
            <EmptyState body="Fetching archived tasks from Core." title="Loading…" />
          ) : (
            <EmptyState body="Archived tasks will appear here." title="No archived tasks" />
          )
        }
        onRefresh={() => void load()}
        refreshing={loading}
        renderItem={renderItem}
      />
    </Page>
  );
}
