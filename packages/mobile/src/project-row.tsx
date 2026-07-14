import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link, type Href } from "expo-router";

import type { MobileProject } from "./projects";
import { DetailText, useHonkTheme } from "./ui";

export function ProjectRow({
  href,
  project,
}: {
  readonly href: Href;
  readonly project: MobileProject;
}): React.ReactElement {
  const theme = useHonkTheme();
  const activeCount = project.threads.filter(
    (thread) => thread.status === "running" || thread.needsAttention || thread.status === "failed",
  ).length;

  return (
    <Link asChild href={href}>
      <Pressable
        accessibilityHint="Opens this project's tasks"
        accessibilityLabel={`${project.title}, ${project.threads.length} tasks`}
        style={({ pressed }) => [
          styles.root,
          {
            backgroundColor: pressed ? theme.colors.statePress : theme.colors.bgBase,
            borderBottomColor: theme.colors.borderMuted,
            borderBottomWidth: theme.metrics.field.borderWidth,
            gap: theme.metrics.space.compactGap,
            paddingVertical: theme.metrics.feed.rowPaddingBlock,
          },
        ]}
      >
        <View style={styles.titleRow}>
          <Text
            allowFontScaling
            numberOfLines={1}
            style={{
              color: theme.colors.textPrimary,
              flex: 1,
              fontSize: theme.metrics.font.bodySize,
              fontWeight: theme.metrics.font.weightMedium,
              lineHeight: theme.metrics.font.bodyLeading,
            }}
          >
            {project.title}
          </Text>
          <DetailText>{project.threads.length}</DetailText>
        </View>
        <DetailText numberOfLines={1}>
          {activeCount > 0
            ? `${activeCount} active · ${project.path ?? "No project folder"}`
            : (project.path ?? "No project folder")}
        </DetailText>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  root: {
    width: "100%",
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
  },
});
