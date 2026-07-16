import { Button, Text } from "@honk/ui";
import * as React from "react";

import { actions as appSettingsActions, useAppSettings } from "./app-settings-store";
import { pickFolder } from "./desktop-bridge";
import {
  SettingResetButton,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "./settings-controls";

export function SettingsGeneral(): React.ReactElement {
  const appSettings = useAppSettings();
  const directory = appSettings.defaultProjectDirectory;
  const canChooseDirectory =
    typeof window !== "undefined" && window.desktopBridge?.pickFolder !== undefined;

  const choose = (): void => {
    void pickFolder(directory).then((path) => {
      if (path !== null) appSettingsActions.setDefaultProjectDirectory(path);
    });
  };

  return (
    <SettingsSection title="General">
      <SettingsRows>
        <SettingsRow
          title="Default project folder"
          description={directory ?? "New threads use the server's default folder."}
          resetAction={
            directory === null ? null : (
              <SettingResetButton
                label="default project folder"
                onClick={() => {
                  appSettingsActions.setDefaultProjectDirectory(null);
                }}
              />
            )
          }
          control={
            canChooseDirectory ? (
              <Button size="sm" variant="neutral" onClick={choose}>
                Choose…
              </Button>
            ) : (
              <Text size="sm" tone="faint">
                Desktop only
              </Text>
            )
          }
        />
        <SettingsRow
          title="Thread titles"
          description="Automatic titles will be available when the server supports them."
          isLast
          control={
            <Text size="sm" tone="muted">
              Unavailable
            </Text>
          }
        />
      </SettingsRows>
    </SettingsSection>
  );
}
