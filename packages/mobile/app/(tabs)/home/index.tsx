import * as React from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, Stack, router } from "expo-router";
import type { ThreadRowStatus } from "@honk/api/core/v1";
import { TextField } from "@honk/ui/text-field";

import { useRemote } from "../../../src/remote-context";
import { ThreadRow } from "../../../src/thread-row";
import { DetailText, EmptyState, LoadingState, Page, useHonkTheme } from "../../../src/ui";

type StatusFilter = "all" | ThreadRowStatus;

const filters: ReadonlyArray<{ readonly label: string; readonly value: StatusFilter }> = [
  { label: "All", value: "all" },
  { label: "Running", value: "running" },
  { label: "Needs attention", value: "needs_attention" },
  { label: "Idle", value: "idle" },
  { label: "Stopped", value: "stopped" },
  { label: "Error", value: "error" },
];

export default function HomeRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const [query, setQuery] = React.useState("");
  const [refreshing, setRefreshing] = React.useState(false);

  if (remote.client === null) return <Redirect href="/connect" />;
  if (remote.workspace === null) return <LoadingState label="Loading tasks…" />;

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const statusFilters = remote.workspace.uiState.statusFilters;
  const threads = remote.workspace.threads.filter((thread) => {
    if (statusFilters.length > 0 && !statusFilters.includes(thread.rowStatus)) return false;
    if (normalizedQuery === "") return true;
    return (
      thread.title.toLocaleLowerCase().includes(normalizedQuery) ||
      String(thread.model).toLocaleLowerCase().includes(normalizedQuery)
    );
  });

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
      <Stack.Screen
        options={{
          title: "Tasks",
          headerRight: () => (
            <View style={{ flexDirection: "row", gap: theme.metrics.space.rowGap }}>
              <Pressable
                accessibilityLabel="Open archived tasks"
                accessibilityRole="button"
                hitSlop={theme.metrics.space.contentGap}
                onPress={() => router.push("/archived")}
              >
                <Text
                  allowFontScaling
                  style={{
                    color: theme.colors.textMuted,
                    fontSize: theme.metrics.font.detailSize,
                    fontWeight: theme.metrics.font.weightMedium,
                  }}
                >
                  Archived
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Create task"
                accessibilityRole="button"
                hitSlop={theme.metrics.space.contentGap}
                onPress={() => router.push("/new")}
              >
                <Text
                  allowFontScaling
                  style={{
                    color: theme.colors.accent,
                    fontSize: theme.metrics.font.bodySize,
                    fontWeight: theme.metrics.font.weightSemibold,
                  }}
                >
                  New
                </Text>
              </Pressable>
            </View>
          ),
        }}
      />
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
          Core is {remote.status}
        </DetailText>
      )}
      <FlatList
        contentContainerStyle={threads.length === 0 ? { flexGrow: 1 } : undefined}
        contentInsetAdjustmentBehavior="automatic"
        data={threads}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(thread) => String(thread.id)}
        ListHeaderComponent={
          <View
            style={{
              gap: theme.metrics.space.contentGap,
              padding: theme.metrics.space.screenGutter,
            }}
          >
            <TextField
              autoCapitalize="none"
              autoCorrect={false}
              label="Search tasks"
              onChangeText={setQuery}
              placeholder="Title or model"
              returnKeyType="search"
              value={query}
            />
            <ScrollView
              contentContainerStyle={{ gap: theme.metrics.space.compactGap }}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {filters.map((filter) => {
                const selected =
                  filter.value === "all"
                    ? statusFilters.length === 0
                    : statusFilters.includes(filter.value);
                return (
                  <Pressable
                    key={filter.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => {
                      const next =
                        filter.value === "all"
                          ? []
                          : selected
                            ? statusFilters.filter((value) => value !== filter.value)
                            : [...statusFilters, filter.value];
                      void remote.client?.uiState.update({ statusFilters: next });
                    }}
                    style={({ pressed }) => ({
                      backgroundColor: selected ? theme.colors.accentSubtle : theme.colors.control,
                      borderColor: selected ? theme.colors.accent : theme.colors.borderBase,
                      borderRadius: theme.metrics.radius.control,
                      borderWidth: theme.metrics.field.borderWidth,
                      minHeight: theme.metrics.interaction.touchTarget,
                      justifyContent: "center",
                      opacity: pressed ? theme.metrics.interaction.pressedOpacity : 1,
                      paddingHorizontal: theme.metrics.space.panelPad,
                    })}
                  >
                    <DetailText style={{ color: selected ? theme.colors.accent : undefined }}>
                      {filter.label}
                    </DetailText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            body={
              query.trim() === "" && statusFilters.length === 0
                ? "Create a task here or on desktop; both clients watch the same Core workspace."
                : "Try a different search or status filter."
            }
            title={query.trim() === "" && statusFilters.length === 0 ? "No tasks yet" : "No matches"}
          />
        }
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        renderItem={({ item }) => (
          <ThreadRow
            href={{ pathname: "/(tabs)/home/[threadId]", params: { threadId: String(item.id) } }}
            readAt={remote.workspace?.uiState.threadReadAt[String(item.id)] ?? null}
            thread={item}
          />
        )}
      />
    </Page>
  );
}
