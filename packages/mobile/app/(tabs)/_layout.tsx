import * as React from "react";
import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useRemote } from "../../src/remote-context";
import { useHonkTheme } from "../../src/ui";

export default function TabsLayout(): React.ReactElement {
  const theme = useHonkTheme();
  const { workspace } = useRemote();
  const activityCount =
    workspace?.threads.filter(
      (thread) => thread.rowStatus === "running" || thread.rowStatus === "needs_attention",
    ).length ?? 0;

  return (
    <NativeTabs
      backgroundColor={theme.colors.bgBase}
      iconColor={{ default: theme.colors.textMuted, selected: theme.colors.accent }}
      indicatorColor={theme.colors.accentSubtle}
      labelStyle={{ color: theme.colors.textMuted, fontSize: theme.metrics.font.captionSize }}
      tintColor={theme.colors.accent}
    >
      <NativeTabs.Trigger name="home">
        <NativeTabs.Trigger.Label>Tasks</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="activity">
        <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
        {activityCount > 0 ? (
          <NativeTabs.Trigger.Badge>{String(activityCount)}</NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
