import * as React from "react";
import { StyleSheet, View } from "react-native";
import { router, type Href } from "expo-router";
import { ListRow, Matrix } from "@honk/ui";

import { formatTimestamp } from "./format";
import type { RemoteSession } from "./remote-context";
import { useHonkTheme } from "./ui";

function statusLabel(session: RemoteSession): string {
  if (session.needsAttention) return "Needs attention";
  if (session.status === "running") return "Running";
  if (session.status === "failed") return "Failed";
  return "Idle";
}

export function ThreadRow({
  href,
  session,
}: {
  readonly href: Href;
  readonly session: RemoteSession;
}): React.ReactElement {
  const theme = useHonkTheme();
  const emphasized = session.needsAttention || session.status === "failed";
  const active = emphasized || session.status === "running";
  const statusColor = session.needsAttention
    ? theme.colors.warnFg
    : session.status === "running"
      ? theme.colors.accent
      : session.status === "failed"
        ? theme.colors.errFg
        : theme.colors.textMuted;
  const model = session.info.model?.id ?? session.info.agent ?? "Honk";

  return (
    <ListRow
      accessibilityLabel={`${session.info.title}, ${statusLabel(session)}`}
      onClick={() => router.push(href)}
    >
      <ListRow.Slot>
        <View style={styles.statusSlot}>
          {active ? (
            <Matrix
              color={statusColor}
              isActive={session.needsAttention || session.status === "running"}
              variant={session.needsAttention ? "attention" : "working"}
            />
          ) : null}
        </View>
      </ListRow.Slot>
      <ListRow.Content>
        <ListRow.Title>{session.info.title}</ListRow.Title>
        <ListRow.Description>
          {active ? `${statusLabel(session)} · ` : ""}
          {model} · {session.server.label} · {formatTimestamp(session.info.time.updated)}
        </ListRow.Description>
      </ListRow.Content>
    </ListRow>
  );
}

const styles = StyleSheet.create({
  statusSlot: {
    height: 20,
    width: 20,
  },
});
