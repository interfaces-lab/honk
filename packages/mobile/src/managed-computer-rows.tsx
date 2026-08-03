import { ListRow } from "@honk/ui";
import { StyleSheet, View } from "react-native";
import type { ReactElement } from "react";

import {
  additionalManagedEnvironmentRows,
  presentManagedEnvironmentRow,
} from "./managed-computer-presentation";
import { useManagedRemote } from "./managed-remote-context";
import { ActionButton, BodyText, DetailText, useHonkTheme } from "./ui";

export function ManagedComputerRows(props: {
  readonly savedEnvironmentIds: ReadonlySet<string>;
}): ReactElement | null {
  const theme = useHonkTheme();
  const managed = useManagedRemote();
  if (!managed.configured || managed.accountId === null) return null;

  const rows = additionalManagedEnvironmentRows(managed.discovery, props.savedEnvironmentIds);

  return (
    <View style={{ gap: theme.metrics.space.contentGap }}>
      <View style={styles.header}>
        <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
          Linked computers
        </BodyText>
        <ActionButton
          disabled={managed.discovery.offline}
          label="Refresh"
          onPress={() => void managed.refresh()}
          pending={managed.discovery.refreshing}
          size="compact"
          tone="neutral"
        />
      </View>
      {managed.discovery.offline ? (
        <DetailText>
          You’re offline. Linked computers remain visible and will refresh automatically.
        </DetailText>
      ) : null}
      {managed.discovery.error === null ? null : (
        <View
          style={{
            backgroundColor: theme.colors.layer01,
            borderCurve: "continuous",
            borderRadius: theme.metrics.radius.panel,
            gap: theme.metrics.space.rowGap,
            padding: theme.metrics.space.panelPad,
          }}
        >
          <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
            Could not load linked computers
          </BodyText>
          <DetailText accessibilityLiveRegion="polite">
            {managed.discovery.error.message}
          </DetailText>
        </View>
      )}
      {rows.length === 0 && managed.discovery.error === null ? (
        <DetailText>
          {managed.discovery.refreshing
            ? "Loading linked computers…"
            : "No additional linked computers."}
        </DetailText>
      ) : rows.length > 0 ? (
        <View
          style={{
            backgroundColor: theme.colors.layer01,
            borderCurve: "continuous",
            borderRadius: theme.metrics.radius.panel,
            overflow: "hidden",
          }}
        >
          {rows.map((row, index) => {
            const presentation = presentManagedEnvironmentRow(row);
            const color =
              presentation.tone === "success"
                ? theme.colors.okFg
                : presentation.tone === "warning"
                  ? theme.colors.warnFg
                  : presentation.tone === "error"
                    ? theme.colors.errFg
                    : theme.colors.textMuted;
            return (
              <View
                key={row.environment.environmentId}
                style={
                  index === 0
                    ? undefined
                    : {
                        borderTopColor: theme.colors.borderBase,
                        borderTopWidth: StyleSheet.hairlineWidth,
                      }
                }
              >
                <ListRow>
                  <ListRow.Content>
                    <ListRow.Title>{row.environment.label}</ListRow.Title>
                    <ListRow.Description>{presentation.detail}</ListRow.Description>
                  </ListRow.Content>
                  <ListRow.Meta>
                    <DetailText style={{ color }}>{presentation.title}</DetailText>
                  </ListRow.Meta>
                </ListRow>
              </View>
            );
          })}
        </View>
      ) : null}
      {rows.length === 0 ? null : (
        <DetailText>
          Scan a linked computer’s Honk QR code before connecting it on this phone.
        </DetailText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
