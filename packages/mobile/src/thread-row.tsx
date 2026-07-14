import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link, type Href } from "expo-router";
import type { ThreadSummary } from "@honk/opencode";

import { formatTimestamp } from "./format";
import { DetailText, useHonkTheme } from "./ui";

const statusLabel = (thread: ThreadSummary): string => {
  if (thread.needsAttention) return "Needs attention";
  if (thread.status === "running") return "Running";
  if (thread.status === "failed") return "Failed";
  return "Idle";
};

export function ThreadRow({
  href,
  thread,
}: {
  readonly href: Href;
  readonly thread: ThreadSummary;
}): React.ReactElement {
  const theme = useHonkTheme();
  const emphasized = thread.needsAttention || thread.status === "failed";
  const active = emphasized || thread.status === "running";
  const statusColor =
    thread.status === "running"
      ? theme.colors.accent
      : emphasized
        ? theme.colors.errFg
        : theme.colors.textMuted;
  const model = thread.model === null ? (thread.agent ?? "Honk") : thread.model.id;

  return (
    <Link asChild href={href}>
      <Pressable
        accessibilityHint="Opens this task"
        accessibilityLabel={`${thread.title}, ${statusLabel(thread)}`}
        style={({ pressed }) => [
          styles.root,
          {
            backgroundColor: pressed ? theme.colors.statePress : theme.colors.bgBase,
            borderBottomColor: theme.colors.borderMuted,
            borderBottomWidth: theme.metrics.field.borderWidth,
            gap: theme.metrics.space.rowGap,
            paddingVertical: theme.metrics.feed.rowPaddingBlock,
          },
        ]}
      >
        <View style={[styles.statusSlot, { marginTop: theme.metrics.space.contentGap }]}>
          {active ? (
            <View
              style={[
                styles.statusMark,
                {
                  backgroundColor: statusColor,
                  borderRadius: theme.metrics.radius.pill,
                },
              ]}
            />
          ) : null}
        </View>
        <View style={[styles.content, { gap: theme.metrics.space.compactGap }]}>
          <Text
            allowFontScaling
            numberOfLines={2}
            style={{
              color: theme.colors.textPrimary,
              fontSize: theme.metrics.font.bodySize,
              fontWeight: emphasized
                ? theme.metrics.font.weightSemibold
                : theme.metrics.font.weightMedium,
              lineHeight: theme.metrics.font.bodyLeading,
            }}
          >
            {thread.title}
          </Text>
          <DetailText numberOfLines={1}>
            {active ? `${statusLabel(thread)} · ` : ""}
            {model} · {formatTimestamp(thread.updatedAt)}
          </DetailText>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  content: {
    flex: 1,
  },
  statusMark: {
    height: 8,
    width: 8,
  },
  statusSlot: {
    height: 8,
    width: 8,
  },
});
