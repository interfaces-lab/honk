import { create, props } from "@stylexjs/stylex";
import { IconButton, Tooltip } from "@honk/ui";
import { spaceVars } from "@honk/ui/tokens.stylex";
import type { ReactElement } from "react";

import { useHonkDesktopCell, useHonkDesktopNewSession } from "./runtime";
import type { HonkDesktopNewSessionToggleContribution } from "./sdk";

const styles = create({
  root: {
    marginTop: spaceVars["--honk-space-gutter"],
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: spaceVars["--honk-space-gutter"],
  },
});

function HonkDesktopNewSessionControls(): ReactElement | null {
  const toggles = useHonkDesktopNewSession();
  if (toggles.length === 0) {
    return null;
  }
  return (
    <div aria-label="Session options" {...props(styles.root)}>
      {toggles.map((toggle) => (
        <NewSessionToggle key={toggle.key} toggle={toggle} />
      ))}
    </div>
  );
}

function NewSessionToggle(input: {
  readonly toggle: HonkDesktopNewSessionToggleContribution;
}): ReactElement {
  const isEnabled = useHonkDesktopCell(input.toggle.value);
  return (
    <Tooltip label={input.toggle.title}>
      <IconButton
        size="sm"
        variant={isEnabled ? "neutral" : "quiet"}
        aria-label={input.toggle.title}
        aria-pressed={isEnabled}
        onClick={() => {
          input.toggle.value.set(!isEnabled);
        }}
      >
        {input.toggle.icon(isEnabled)}
      </IconButton>
    </Tooltip>
  );
}

export { HonkDesktopNewSessionControls };
