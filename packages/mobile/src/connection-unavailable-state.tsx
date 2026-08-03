import { router } from "expo-router";
import type { ReactElement } from "react";
import { View } from "react-native";

import { presentRemoteServerRecovery } from "./connection-presentation";
import { useRemote, type RemoteServer } from "./remote-context";
import { ActionButton, EmptyState, useHonkTheme } from "./ui";

export function ConnectionUnavailableState(props: {
  readonly detail?: string;
  readonly fallbackDetail: string;
  readonly onCancel?: () => void;
  readonly server: RemoteServer;
  readonly title?: string;
}): ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const presentation = presentRemoteServerRecovery(props.server);

  return (
    <>
      <EmptyState
        body={props.detail ?? presentation.detail ?? props.fallbackDetail}
        title={props.title ?? presentation.title}
      />
      <View
        style={{
          gap: theme.metrics.space.rowGap,
          padding: theme.metrics.space.screenGutter,
        }}
      >
        {presentation.action === null ? null : (
          <ActionButton
            label={presentation.action === "retry" ? "Retry now" : "Manage computers"}
            onPress={() => {
              if (presentation.action === "retry") {
                void remote.retry(props.server.descriptor.key);
                return;
              }
              router.push("/(tabs)/settings/computers");
            }}
            tone="neutral"
          />
        )}
        {props.onCancel === undefined ? null : (
          <ActionButton label="Cancel" onPress={props.onCancel} tone="neutral" />
        )}
      </View>
    </>
  );
}
