import { openCodeSessionKey } from "@honk/opencode";
import { Redirect, Stack, router } from "expo-router";
import * as React from "react";
import { SectionList, StyleSheet, View } from "react-native";

import {
  MOBILE_HOME_SESSION_LIMIT,
  activeRootSessions,
  groupSessionsByProject,
} from "../../../src/projects";
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
      (statusFilter === "attention"
        ? session.needsAttention
        : statusFilter === "running"
          ? session.status === "running"
          : statusFilter === "failed"
            ? session.status === "failed"
            : session.status === "idle" && !session.needsAttention);
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

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await remote.refreshSessions();
    } finally {
      setRefreshing(false);
    }
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
        <Stack.Toolbar.Menu icon="line.3.horizontal.decrease">
          {filters.map((filter) => (
            <Stack.Toolbar.MenuAction
              key={filter.value}
              isOn={filter.value === statusFilter}
              onPress={() => setStatusFilter(filter.value)}
            >
              {filter.label}
            </Stack.Toolbar.MenuAction>
          ))}
          <Stack.Toolbar.MenuAction icon="archivebox" onPress={() => router.push("/archived")}>
            Archived sessions
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="server.rack" onPress={() => router.push("/connect")}>
            Manage servers
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button
          accessibilityLabel="Create session"
          icon="plus"
          onPress={() => router.push("/new")}
        />
      </Stack.Toolbar>
      {remote.status === "live" ? null : (
        <DetailText
          accessibilityLiveRegion="polite"
          style={{
            backgroundColor: theme.colors.warnBg,
            color: theme.colors.warnFg,
            padding: theme.metrics.space.contentGap,
            textAlign: "center",
          }}
        >
          Active server: {remote.status}
        </DetailText>
      )}
      <SectionList
        contentContainerStyle={[
          { paddingHorizontal: theme.metrics.space.screenGutter },
          sessions.length === 0 ? { flexGrow: 1 } : undefined,
        ]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(session) => openCodeSessionKey(session.ref)}
        ListEmptyComponent={
          <EmptyState
            body={
              query.trim() === "" && statusFilter === "all"
                ? "Start a session here or on desktop; every client watches the same OpenCode servers."
                : "Try a different search or status filter."
            }
            title={query.trim() === "" && statusFilter === "all" ? "No sessions yet" : "No matches"}
          />
        }
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
