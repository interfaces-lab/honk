import { Switch } from "@honk/ui";
import * as React from "react";

import { useHonkDesktopCell } from "./desktop-extensions/runtime";
import type { HonkDesktopSettingsToggleContribution } from "./desktop-extensions/sdk";
import { SettingsRow } from "./settings-controls";

export function DesktopSettingsToggleRow(props: {
  readonly setting: HonkDesktopSettingsToggleContribution;
}): React.ReactElement {
  const isEnabled = useHonkDesktopCell(props.setting.value);

  return (
    <SettingsRow
      title={props.setting.title}
      description={props.setting.description ?? props.setting.extension.name}
      control={
        <Switch
          size="sm"
          checked={isEnabled}
          aria-label={props.setting.title}
          onCheckedChange={(checked) => {
            props.setting.value.set(checked);
          }}
        />
      }
    />
  );
}
