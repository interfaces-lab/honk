import * as React from "react";
import { SectionList, StyleSheet, View } from "react-native";
import { Redirect, Stack, router } from "expo-router";
import type { ThreadSummary } from "@honk/opencode";

import { useRemote } from "../../../src/remote-context";
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

const renderHomeThread = ({ item }: { readonly item: ThreadSummary }): React.ReactElement => (
  <ThreadRow
    href={{ pathname: "/(tabs)/home/[threadId]", params: { threadId: item.id } }}
    thread={item}
  />
);

interface ProjectSection {
  readonly key: string;
  readonly title: string;
  readonly data: readonly ThreadSummary[];
}

const projectTitle = (thread: ThreadSummary): string => {
  const path = thread.worktree?.path?.replace(/\/+$/, "") ?? "";
  const name = path.split("/").filter(Boolean).at(-1);
  return name ?? "Other tasks";
};

const projectSections = (threads: readonly ThreadSummary[]): readonly ProjectSection[] => {
  const groups = new Map<string, ThreadSummary[]>();
  for (const thread of threads) {
    const key = thread.worktree?.path ?? thread.projectId ?? "other";
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [thread]);
    else group.push(thread);
  }
  return [...groups.entries()]
    .map(([key, data]) => ({ key, title: projectTitle(data[0]!), data }))
    .sort((left, right) =>
      (right.data[0]?.updatedAt ?? "").localeCompare(left.data[0]?.updatedAt ?? ""),
    );
};

export default function HomeRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [refreshing, setRefreshing] = React.useState(false);

  if (remote.client === null) return <Redirect href="/connect" />;
  if (remote.workspace === null) return <LoadingState label="Loading tasks…" />;

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const threads = remote.workspace.threads.filter((thread) => {
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "attention"
        ? thread.needsAttention
        : statusFilter === "running"
          ? thread.status === "running"
          : statusFilter === "failed"
            ? thread.status === "failed"
            : thread.status === "idle" && !thread.needsAttention);
    if (!matchesStatus) return false;
    if (normalizedQuery === "") return true;
    const model = thread.model?.id ?? "";
    return (
      thread.title.toLocaleLowerCase().includes(normalizedQuery) ||
      model.toLocaleLowerCase().includes(normalizedQuery) ||
      (thread.worktree?.path ?? "").toLocaleLowerCase().includes(normalizedQuery)
    );
  });
  const sections = projectSections(threads);

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
      <Stack.Title large>Tasks</Stack.Title>
      <Stack.SearchBar
        autoCapitalize="none"
        hideWhenScrolling
        onCancelButtonPress={() => setQuery("")}
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
        placeholder="Search tasks"
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
            Archived tasks
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button
          accessibilityLabel="Create task"
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
          Honk host: {remote.status}
        </DetailText>
      )}
      <SectionList
        contentContainerStyle={[
          { paddingHorizontal: theme.metrics.space.screenGutter },
          threads.length === 0 ? { flexGrow: 1 } : undefined,
        ]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(thread) => thread.id}
        ListEmptyComponent={
          <EmptyState
            body={
              query.trim() === "" && statusFilter === "all"
                ? "Create a task here or on desktop; every client watches the same Honk host."
                : "Try a different search or status filter."
            }
            title={query.trim() === "" && statusFilter === "all" ? "No tasks yet" : "No matches"}
          />
        }
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        renderItem={renderHomeThread}
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
              {section.data.length} task{section.data.length === 1 ? "" : "s"}
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
