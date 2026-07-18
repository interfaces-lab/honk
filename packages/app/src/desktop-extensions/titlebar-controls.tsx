import { IconButton, Tooltip } from "@honk/ui";
import type { ReactElement } from "react";

import { useHonkDesktopCell, useHonkDesktopTitlebarToggles } from "./runtime";
import type { HonkDesktopTitlebarToggleContribution } from "./sdk";

function HonkDesktopTitlebarControls(): ReactElement | null {
  const toggles = useHonkDesktopTitlebarToggles();
  if (toggles.length === 0) {
    return null;
  }
  return (
    <>
      {toggles.map((toggle) => (
        <TitlebarToggle key={toggle.key} toggle={toggle} />
      ))}
    </>
  );
}

function TitlebarToggle(props: {
  readonly toggle: HonkDesktopTitlebarToggleContribution;
}): ReactElement {
  const isEnabled = useHonkDesktopCell(props.toggle.value);
  return (
    <Tooltip label={props.toggle.label}>
      <IconButton
        data-shell-no-drag=""
        size="sm"
        variant={isEnabled ? "neutral" : "quiet"}
        aria-label={props.toggle.label}
        aria-pressed={isEnabled}
        onClick={() => {
          props.toggle.value.set(!isEnabled);
        }}
      >
        {props.toggle.icon(isEnabled)}
      </IconButton>
    </Tooltip>
  );
}

export { HonkDesktopTitlebarControls };
