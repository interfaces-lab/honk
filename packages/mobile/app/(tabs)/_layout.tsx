import * as React from "react";
import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useHonkTheme } from "../../src/ui";

// Triggers must stay static: toggling `hidden` remounts the navigator and drops each tab's stack.
export default function TabsLayout(): React.ReactElement {
  const theme = useHonkTheme();
  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={theme.colors.accent}>
      <NativeTabs.Trigger name="home">
        <NativeTabs.Trigger.Icon
          sf={{
            default: "bubble.left.and.bubble.right",
            selected: "bubble.left.and.bubble.right.fill",
          }}
        />
        <NativeTabs.Trigger.Label>Sessions</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
