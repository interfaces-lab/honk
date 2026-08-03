import { openCodeSessionKey } from "@honk/opencode";
import { Redirect, Stack, router } from "expo-router";
import * as React from "react";
import { SectionList, StyleSheet, View } from "react-native";

import {
  MOBILE_HOME_SESSION_LIMIT,
  activeRootSessions,
  groupSessionsByProject,
} from "../../../src/projects";
import { ConnectionStatusBanner } from "../../../src/connection-status-banner";
import { useRemote } from "../../../src/remote-context";
import type { RemoteSession } from "../../../src/remote-context";
import { ThreadRow } from "../../../src/thread-row";
import {
  BodyText,
  DetailText,
  EmptyState,
  LoadingState,
  Page,
  useHonkTheme,
} from "../../../src/ui";

type StatusFilter = "all" | "running" | "attention" | "idle" | "failed";

const filters: ReadonlyArray<{ readonly label: string; readonly value: StatusFilter }> = [
  { label: "All", value: "all" },
  { label: "Running", value: "running" },
  { label: "Attention", value: "attention" },
  { label: "Idle", value: "idle" },
  { label: "Failed", value: "failed" },
];

const renderSession = ({ item }: { readonly item: RemoteSession }): React.ReactElement => (
  <ThreadRow
    href={{
      pathname: "/(tabs)/home/server/[serverKey]/session/[sessionId]",
      params: { serverKey: item.ref.server, sessionId: item.ref.sessionID },
    }}
    session={item}
  />
);

interface ProjectSection {
  readonly key: string;
  readonly title: string;
  readonly serverLabel: string;
  readonly data: readonly RemoteSession[];
}

export default function HomeRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [refreshing, setRefreshing] = React.useState(false);

  if (remote.status === "restoring") return <LoadingState label="Restoring servers…" />;
  if (remote.servers.length === 0) return <Redirect href="/connect" />;

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingSessions = activeRootSessions(remote.sessions).filter((session) => {
    const matchesStatus =
      statusFilter === "all" ||
      (!session.cached &&
        (statusFilter === "attention"
          ? session.needsAttention
          : statusFilter === "running"
            ? session.status === "running"
            : statusFilter === "failed"
              ? session.status === "failed"
              : session.status === "idle" && !session.needsAttention));
    if (!matchesStatus) return false;
    if (normalizedQuery === "") return true;
    return (
      session.info.title.toLocaleLowerCase().includes(normalizedQuery) ||
      (session.info.model?.id ?? "").toLocaleLowerCase().includes(normalizedQuery) ||
      session.info.location.directory.toLocaleLowerCase().includes(normalizedQuery) ||
      session.server.label.toLocaleLowerCase().includes(normalizedQuery)
    );
  });
  const sessions =
    normalizedQuery === "" && statusFilter === "all"
      ? matchingSessions.slice(0, MOBILE_HOME_SESSION_LIMIT)
      : matchingSessions;
  const sections: readonly ProjectSection[] = groupSessionsByProject(sessions).map((project) => ({
    key: project.key,
    title: project.title,
    serverLabel: project.serverLabel,
    data: project.sessions,
  }));
  const defaultEmptyState = query.trim() === "" && statusFilter === "all";
  const hasLiveComputer = remote.servers.some((server) => server.status === "live");
  const isLoadingComputer = remote.servers.some(
    (server) => server.status === "connecting" || server.status === "reconnecting",
  );
  const emptyState = !defaultEmptyState
    ? { title: "No matches", body: "Try a different search or status filter." }
    : hasLiveComputer
      ? {
          title: "No sessions yet",
          body: "Start a session here or on desktop; every client watches the same OpenCode servers.",
        }
      : isLoadingComputer
        ? {
            title: "Loading sessions",
            body: "Saved sessions will appear as soon as a computer is ready.",
          }
        : {
            title: "Sessions unavailable",
            body: "Reconnect a computer to load sessions that haven’t been cached on this phone.",
          };

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    await remote.refreshSessions().finally(() => setRefreshing(false));
  };

  return (
    <Page>
      <Stack.Title large>Sessions</Stack.Title>
      <Stack.SearchBar
        autoCapitalize="none"
        hideWhenScrolling
        onCancelButtonPress={() => setQuery("")}
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
        placeholder="Search sessions"
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="desktopcomputer">
          <Stack.Toolbar.Menu inline title="New sessions use">
            {remote.servers.map((server) => (
              <Stack.Toolbar.MenuAction
                key={server.descriptor.key}
                isOn={remote.activeServerKey === server.descriptor.key}
                onPress={() => remote.selectServer(server.descriptor.key)}
              >
                {server.descriptor.label}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction
            icon="gearshape"
            onPress={() => router.push("/(tabs)/settings/computers")}
          >
            Manage computers
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        {/* Connection actions live in the Settings tab; this menu stays scoped to session views. */}
        <Stack.Toolbar.Menu icon="line.3.horizontal.decrease">
          <Stack.Toolbar.Menu inline title="Show">
            {filters.map((filter) => (
              <Stack.Toolbar.MenuAction
                key={filter.value}
                isOn={filter.value === statusFilter}
                onPress={() => setStatusFilter(filter.value)}
              >
                {filter.label}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction
            icon="archivebox"
            onPress={() => router.push("/(tabs)/home/archived")}
          >
            Archived
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button
          accessibilityLabel="Create session"
          icon="plus"
          onPress={() => router.push("/new")}
        />
      </Stack.Toolbar>
      <SectionList
        contentContainerStyle={[
          { paddingHorizontal: theme.metrics.space.screenGutter },
          sessions.length === 0 ? { flexGrow: 1 } : undefined,
        ]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(session) => openCodeSessionKey(session.ref)}
        ListHeaderComponent={<ConnectionStatusBanner servers={remote.servers} />}
        ListEmptyComponent={<EmptyState body={emptyState.body} title={emptyState.title} />}
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        renderItem={renderSession}
        renderSectionHeader={({ section }) => (
          <View
            style={[
              styles.sectionHeader,
              {
                backgroundColor: theme.colors.bgBase,
                gap: theme.metrics.space.compactGap,
                paddingBottom: theme.metrics.space.compactGap,
                paddingTop: theme.metrics.space.sectionGap,
              },
            ]}
          >
            <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
              {section.title}
            </BodyText>
            <DetailText>
              {section.serverLabel} · {section.data.length}
            </DetailText>
          </View>
        )}
        sections={sections}
        stickySectionHeadersEnabled={false}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    alignItems: "baseline",
    flexDirection: "row",
  },
});
