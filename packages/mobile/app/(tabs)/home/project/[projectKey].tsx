import * as React from "react";
import { FlatList, type ListRenderItemInfo } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import type { ThreadSummary } from "@honk/opencode";

import { groupThreadsByProject } from "../../../../src/projects";
import { useRemote } from "../../../../src/remote-context";
import { ThreadRow } from "../../../../src/thread-row";
import { EmptyState, LoadingState, Page, useHonkTheme } from "../../../../src/ui";

export default function ProjectRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const { projectKey } = useLocalSearchParams<{ projectKey: string }>();
  const [refreshing, setRefreshing] = React.useState(false);

  if (remote.client === null) return <Redirect href="/connect" />;
  if (remote.workspace === null) return <LoadingState label="Loading project…" />;

  const project = groupThreadsByProject(remote.workspace.threads).find(
    (candidate) => candidate.key === projectKey,
  );
  const threads = project?.threads ?? [];

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await remote.refreshWorkspace();
    } finally {
      setRefreshing(false);
    }
  };

  const renderThread = ({ item }: ListRenderItemInfo<ThreadSummary>): React.ReactElement => (
    <ThreadRow
      href={{ pathname: "/(tabs)/home/[threadId]", params: { threadId: item.id } }}
      thread={item}
    />
  );

  return (
    <Page>
      <Stack.Title>{project?.title ?? "Project"}</Stack.Title>
      <FlatList
        contentContainerStyle={[
          { paddingHorizontal: theme.metrics.space.screenGutter },
          threads.length === 0 ? { flexGrow: 1 } : undefined,
        ]}
        contentInsetAdjustmentBehavior="automatic"
        data={threads}
        keyExtractor={(thread) => thread.id}
        ListEmptyComponent={
          <EmptyState body="This project has no active tasks." title="No tasks" />
        }
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        renderItem={renderThread}
      />
    </Page>
  );
}
