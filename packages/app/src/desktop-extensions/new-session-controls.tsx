import { create, props } from "@stylexjs/stylex";
import { Switch, Text } from "@honk/ui";
import { controlVars, spaceVars } from "@honk/ui/tokens.stylex";
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
  toggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
  label: {
    cursor: "pointer",
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
  const id = `desktop-extension-new-session-${input.toggle.key}`;
  return (
    <div {...props(styles.toggle)}>
      <label htmlFor={id} title={input.toggle.description} {...props(styles.label)}>
        <Text size="sm" tone="muted">
          {input.toggle.title}
        </Text>
      </label>
      <Switch
        id={id}
        size="sm"
        checked={isEnabled}
        aria-label={input.toggle.title}
        onCheckedChange={(checked) => {
          input.toggle.value.set(checked);
        }}
      />
    </div>
  );
}

export { HonkDesktopNewSessionControls };
