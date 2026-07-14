import * as React from "react";
import { Alert, FlatList, View, type ListRenderItemInfo } from "react-native";
import { Redirect, Stack, router } from "expo-router";
import type { ThreadSummary } from "@honk/opencode";

import { useRemote } from "../src/remote-context";
import { ThreadRow } from "../src/thread-row";
import { ActionButton, DetailText, EmptyState, Page, useHonkTheme } from "../src/ui";

export default function ArchivedTasksRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const [threads, setThreads] = React.useState<readonly ThreadSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (): Promise<void> => {
    const client = remote.client;
    if (client === null) return;
    setLoading(true);
    setError(null);
    try {
      setThreads(await client.threads.listArchived());
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

  const restore = async (thread: ThreadSummary): Promise<void> => {
    setPendingId(thread.id);
    setError(null);
    try {
      const restored = await remote.client?.threads.restoreAsCopy(thread.id);
      if (restored === undefined) {
        throw new Error("The Honk host disconnected while restoring the task.");
      }
      setThreads((current) => current.filter((item) => item.id !== thread.id));
      await remote.refreshWorkspace();
      router.replace({
        pathname: "/(tabs)/home/[threadId]",
        params: { threadId: restored.id },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The task could not be restored.");
    } finally {
      setPendingId(null);
    }
  };

  const remove = (thread: ThreadSummary): void => {
    Alert.alert(
      `Delete “${thread.title}”?`,
      "This permanently removes the task and its conversation.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setPendingId(thread.id);
            void remote.client?.threads
              .remove(thread.id)
              .then(() => setThreads((current) => current.filter((item) => item.id !== thread.id)))
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : "The task could not be deleted."),
              )
              .finally(() => setPendingId(null));
          },
        },
      ],
    );
  };

  const renderItem = ({ item }: ListRenderItemInfo<ThreadSummary>): React.ReactElement => (
    <View>
      <ThreadRow
        href={{ pathname: "/(tabs)/home/[threadId]", params: { threadId: item.id } }}
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
        <ActionButton
          label="Restore as copy"
          onPress={() => void restore(item)}
          pending={pendingId === item.id}
          tone="neutral"
        />
        <ActionButton
          label="Delete"
          onPress={() => remove(item)}
          pending={pendingId === item.id}
          tone="destructive"
        />
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
        contentContainerStyle={[
          { paddingHorizontal: theme.metrics.space.screenGutter },
          threads.length === 0 ? { flexGrow: 1 } : undefined,
        ]}
        contentInsetAdjustmentBehavior="automatic"
        data={threads}
        keyExtractor={(thread) => thread.id}
        ListEmptyComponent={
          loading ? (
            <EmptyState body="Fetching archived tasks from your Honk host." title="Loading…" />
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
