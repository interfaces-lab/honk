import type { OpenCodeClient } from "@honk/opencode";
import { Text } from "@honk/ui";
import * as React from "react";

import { SettingsRow, SettingsRows, SettingsSection } from "./settings-controls";
import { SettingsInventoryStatus, SettingsNote, useSettingsInventory } from "./settings-inventory";

// Honk pins this provider plugin; it is not something the user added.
const CLAUDE_CODE_PLUGIN = "@khalilgharbaoui/opencode-claude-code-plugin";

function loadPlugins(client: OpenCodeClient) {
  return client.config.get();
}

// Honk's own host plugins (absolute paths) and the pinned provider plugin are not
// user-manageable, so listing them is noise.
function isBuiltIn(spec: string) {
  if (spec.startsWith("/") || spec.startsWith("file://") || /^[A-Za-z]:[/\\]/.test(spec))
    return true;
  return spec.startsWith(CLAUDE_CODE_PLUGIN);
}

export function SettingsPlugins(): React.ReactElement {
  const inventory = useSettingsInventory(loadPlugins);
  const entries = inventory.state.phase === "ready" ? (inventory.state.data.plugin ?? []) : [];
  const plugins = entries.flatMap((entry) => {
    const spec = typeof entry === "string" ? entry : entry[0];
    if (isBuiltIn(spec)) return [];
    // Strip the version range from an npm spec without eating a leading scope "@".
    const versionAt = spec.lastIndexOf("@");
    return [
      {
        spec,
        title: versionAt > 0 ? spec.slice(0, versionAt) : spec,
        configured: typeof entry !== "string",
      },
    ];
  });

  return (
    <SettingsSection description="Plugins you add in opencode.json. Honk's built-in plugins are managed automatically and not listed here.">
      <SettingsInventoryStatus
        state={inventory.state}
        loading="Loading plugins…"
        unavailable="Connect to an OpenCode server to view plugins."
        onRetry={inventory.reload}
      />
      {inventory.state.phase === "ready" && plugins.length === 0 ? (
        <SettingsNote>
          No plugins are configured. Add them in the plugin section of opencode.json.
        </SettingsNote>
      ) : null}
      {plugins.length === 0 ? null : (
        <SettingsRows>
          {plugins.map((plugin) => (
            <SettingsRow
              key={plugin.spec}
              title={plugin.title}
              description={
                <>
                  {plugin.spec}
                  {plugin.configured ? (
                    <Text as="span" size="xs" tone="faint">
                      {" · Configured"}
                    </Text>
                  ) : null}
                </>
              }
            />
          ))}
        </SettingsRows>
      )}
    </SettingsSection>
  );
}
