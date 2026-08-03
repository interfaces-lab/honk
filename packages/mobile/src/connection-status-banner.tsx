import { ListRow } from "@honk/ui";
import { router } from "expo-router";
import * as React from "react";
import { View } from "react-native";

import { homeConnectionNotice } from "./connection-presentation";
import type { RemoteServer } from "./remote-context";
import { DetailText, useHonkTheme } from "./ui";

export function ConnectionStatusBanner(props: {
  readonly servers: readonly RemoteServer[];
}): React.ReactElement | null {
  const theme = useHonkTheme();
  const notice = homeConnectionNotice(props.servers);
  if (notice === null) return null;
  const foreground =
    notice.tone === "error"
      ? theme.colors.errFg
      : notice.tone === "warning"
        ? theme.colors.warnFg
        : theme.colors.textMuted;

  return (
    <View
      style={{
        backgroundColor:
          notice.tone === "error"
            ? theme.colors.errBg
            : notice.tone === "warning"
              ? theme.colors.warnBg
              : theme.colors.layer01,
        borderCurve: "continuous",
        borderRadius: theme.metrics.radius.panel,
        marginBottom: theme.metrics.space.contentGap,
      }}
    >
      <ListRow
        accessibilityLabel={`${notice.title}. ${notice.detail}. Manage computers.`}
        onClick={() => router.push("/(tabs)/settings/computers")}
      >
        <ListRow.Content>
          <ListRow.Title>{notice.title}</ListRow.Title>
          <ListRow.Description>{notice.detail}</ListRow.Description>
        </ListRow.Content>
        <ListRow.Meta>
          <DetailText style={{ color: foreground }}>Manage</DetailText>
        </ListRow.Meta>
      </ListRow>
    </View>
  );
}
