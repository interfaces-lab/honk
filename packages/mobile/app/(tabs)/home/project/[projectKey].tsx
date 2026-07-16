import { openCodeSessionKey } from "@honk/opencode";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import * as React from "react";
import { FlatList, type ListRenderItemInfo } from "react-native";

import { activeRootSessions, groupSessionsByProject } from "../../../../src/projects";
import { useRemote } from "../../../../src/remote-context";
import type { RemoteSession } from "../../../../src/remote-context";
import { ThreadRow } from "../../../../src/thread-row";
import { EmptyState, LoadingState, Page, useHonkTheme } from "../../../../src/ui";

export default function ProjectRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const { projectKey } = useLocalSearchParams<{ projectKey: string }>();
  const [refreshing, setRefreshing] = React.useState(false);

  if (remote.status === "restoring") return <LoadingState label="Loading project…" />;
  if (remote.servers.length === 0) return <Redirect href="/connect" />;

  const project = groupSessionsByProject(activeRootSessions(remote.sessions)).find(
    (candidate) => candidate.key === projectKey,
  );
  const sessions = project?.sessions ?? [];

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await remote.refreshSessions();
    } finally {
      setRefreshing(false);
    }
  };

  const renderSession = ({ item }: ListRenderItemInfo<RemoteSession>): React.ReactElement => (
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
      <Stack.Title>{project?.title ?? "Project"}</Stack.Title>
      <FlatList
        contentContainerStyle={[
          { paddingHorizontal: theme.metrics.space.screenGutter },
          sessions.length === 0 ? { flexGrow: 1 } : undefined,
        ]}
        contentInsetAdjustmentBehavior="automatic"
        data={sessions}
        keyExtractor={(session) => openCodeSessionKey(session.ref)}
        ListEmptyComponent={
          <EmptyState body="This project has no active sessions." title="No sessions" />
        }
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        renderItem={renderSession}
      />
    </Page>
  );
}
