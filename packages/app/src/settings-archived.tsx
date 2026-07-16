import * as stylex from "@stylexjs/stylex";
import { Icon, Text } from "@honk/ui";
import { IconArchive1 } from "@honk/ui/icons";
import { spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { SettingsSection } from "./settings-controls";

const styles = stylex.create({
  empty: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
});

export function SettingsArchived(): React.ReactElement {
  return (
    <SettingsSection title="Archived">
      <div {...stylex.props(styles.empty)}>
        <Icon icon={IconArchive1} size="lg" tone="faint" />
        <Text as="p" size="base" weight="medium">
          Archived threads unavailable
        </Text>
        <Text as="p" size="sm" tone="muted">
          This server can&apos;t list or restore archived threads yet.
        </Text>
      </div>
    </SettingsSection>
  );
}
