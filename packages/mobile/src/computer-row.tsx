import { ListRow } from "@honk/ui";
import * as React from "react";
import { StyleSheet, View } from "react-native";

import { presentRemoteServerConnection } from "./connection-presentation";
import type { RemoteServer } from "./remote-context";
import { ActionButton, DetailText, useHonkTheme } from "./ui";

export function ComputerRow(props: {
  readonly active: boolean;
  readonly expanded: boolean;
  readonly server: RemoteServer;
  readonly onRepair: () => void;
  readonly onRemove: () => void;
  readonly onRetry: () => void;
  readonly onSelect: () => void;
  readonly onToggle: () => void;
}): React.ReactElement {
  const theme = useHonkTheme();
  const status = presentRemoteServerConnection(props.server);
  const statusColor =
    status.tone === "success"
      ? theme.colors.okFg
      : status.tone === "warning"
        ? theme.colors.warnFg
        : status.tone === "error"
          ? theme.colors.errFg
          : theme.colors.textMuted;

  return (
    <View
      style={{
        backgroundColor: theme.colors.layer01,
        borderCurve: "continuous",
        borderRadius: theme.metrics.radius.panel,
        overflow: "hidden",
      }}
    >
      <ListRow
        accessibilityLabel={`${props.server.descriptor.label}, ${status.title}`}
        isSelected={props.active}
        onClick={props.onToggle}
      >
        <ListRow.Content>
          <ListRow.Title>{props.server.descriptor.label}</ListRow.Title>
          <ListRow.Description>{props.server.descriptor.origin}</ListRow.Description>
        </ListRow.Content>
        <ListRow.Meta>
          <DetailText style={{ color: statusColor }}>{status.title}</DetailText>
        </ListRow.Meta>
      </ListRow>
      {props.expanded ? (
        <View
          style={{
            borderTopColor: theme.colors.borderBase,
            borderTopWidth: StyleSheet.hairlineWidth,
            gap: theme.metrics.space.contentGap,
            padding: theme.metrics.space.panelPad,
          }}
        >
          <DetailText>
            {props.server.environmentId === null ? "Direct connection" : "Managed connection"}
            {props.active ? " · Default computer" : ""}
          </DetailText>
          {props.server.defaultDirectory.length === 0 ? null : (
            <DetailText selectable>{props.server.defaultDirectory}</DetailText>
          )}
          {status.detail === null ? null : (
            <DetailText accessibilityLiveRegion="polite" selectable style={{ color: statusColor }}>
              {status.detail}
            </DetailText>
          )}
          <View style={[styles.actions, { gap: theme.metrics.space.rowGap }]}>
            {props.active ? null : (
              <ActionButton label="Make default" onPress={props.onSelect} size="compact" />
            )}
            {props.server.status === "closed" ? (
              <ActionButton
                label="Retry now"
                onPress={props.onRetry}
                size="compact"
                tone="neutral"
              />
            ) : null}
            {props.server.status === "unauthorized" || props.server.status === "failed" ? (
              <ActionButton
                label="Scan new code"
                onPress={props.onRepair}
                size="compact"
                tone="neutral"
              />
            ) : null}
            <ActionButton
              label="Remove from phone"
              onPress={props.onRemove}
              size="compact"
              tone="destructive"
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
  },
});
