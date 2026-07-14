import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link, type Href } from "expo-router";
import type { ThreadSummary } from "@honk/api/core/v1";

import { formatTimestamp } from "./format";
import { DetailText, useHonkTheme } from "./ui";

const statusLabel = (thread: ThreadSummary): string => {
  switch (thread.rowStatus) {
    case "running":
      return "Running";
    case "needs_attention":
      return "Needs attention";
    case "stopped":
      return "Stopped";
    case "error":
      return "Error";
    case "idle":
      return "Idle";
  }
};

export function ThreadRow({
  href,
  readAt = null,
  thread,
}: {
  readonly href: Href;
  readonly readAt?: string | null;
  readonly thread: ThreadSummary;
}): React.ReactElement {
  const theme = useHonkTheme();
  const emphasized = thread.rowStatus === "needs_attention" || thread.rowStatus === "error";
  const statusColor =
    thread.rowStatus === "running"
      ? theme.colors.accent
      : emphasized
        ? theme.colors.errFg
        : theme.colors.textMuted;
  const unread =
    thread.readableAt !== null && (readAt === null || thread.readableAt.localeCompare(readAt) > 0);
  return (
    <Link asChild href={href}>
      <Pressable
        accessibilityHint="Opens this task"
        accessibilityLabel={`${thread.title}, ${statusLabel(thread)}${unread ? ", unread" : ""}`}
        style={({ pressed }) => [
          styles.root,
          {
            backgroundColor: pressed ? theme.colors.statePress : theme.colors.bgBase,
            borderBottomColor: theme.colors.borderMuted,
            borderBottomWidth: theme.metrics.field.borderWidth,
            gap: theme.metrics.space.compactGap,
            paddingHorizontal: theme.metrics.space.screenGutter,
            paddingVertical: theme.metrics.feed.rowPaddingBlock,
          },
        ]}
      >
        <View style={[styles.line, { gap: theme.metrics.space.contentGap }]}>
          <Text
            allowFontScaling
            numberOfLines={2}
            style={[
              styles.title,
              {
                color: theme.colors.textPrimary,
                fontSize: theme.metrics.font.bodySize,
                fontWeight: theme.metrics.font.weightSemibold,
                lineHeight: theme.metrics.font.bodyLeading,
              },
            ]}
          >
            {thread.title}
          </Text>
          <View style={[styles.status, { gap: theme.metrics.space.compactGap }]}>
            <View
              style={{
                backgroundColor: statusColor,
                borderRadius: theme.metrics.radius.pill,
                height: theme.metrics.space.contentGap,
                width: theme.metrics.space.contentGap,
              }}
            />
            <Text
              allowFontScaling
              style={{
                color: statusColor,
                fontSize: theme.metrics.font.captionSize,
                fontWeight: theme.metrics.font.weightMedium,
                lineHeight: theme.metrics.font.captionLeading,
              }}
            >
            {statusLabel(thread)}
          </Text>
          {unread ? (
            <Text
              allowFontScaling
              style={{
                color: theme.colors.accent,
                fontSize: theme.metrics.font.captionSize,
                fontWeight: theme.metrics.font.weightSemibold,
              }}
            >
              New
            </Text>
          ) : null}
          </View>
        </View>
        <DetailText numberOfLines={1}>
          {String(thread.model)} · {formatTimestamp(thread.updatedAt)}
        </DetailText>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  root: {
    width: "100%",
  },
  line: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  title: {
    flex: 1,
  },
  status: {
    alignItems: "center",
    flexDirection: "row",
  },
});
