import * as stylex from "@stylexjs/stylex";
import type { OpenCodeClient, OpenCodeSavedPermission } from "@honk/opencode";
import { Badge, Button, Spinner } from "@honk/ui";
import { controlVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { errorMessage } from "./error-message";
import { SettingsRow, SettingsRows, SettingsSection } from "./settings-controls";
import {
  SettingsAlert,
  SettingsInventoryStatus,
  SettingsNote,
  useSettingsInventory,
} from "./settings-inventory";
import { actions as settingsActions } from "./settings-store";
import { getBoundOpenCodeClient } from "./watch-registry";

const styles = stylex.create({
  actions: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
  },
});

function loadSavedPermissions(client: OpenCodeClient) {
  return client.savedPermissions.list();
}

export function SettingsHooks(): React.ReactElement {
  const inventory = useSettingsInventory(loadSavedPermissions);
  const [pending, setPending] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const rules = inventory.state.phase === "ready" ? inventory.state.data : [];

  const revoke = (rule: OpenCodeSavedPermission): void => {
    const client = getBoundOpenCodeClient();
    if (client === null) return;
    setPending(rule.id);
    setFailure(null);
    void client.savedPermissions
      .remove(rule.id)
      .then(
        () => {
          inventory.reload();
        },
        (cause: unknown) => {
          setFailure(`${savedPermissionTitle(rule)} could not be revoked. ${errorMessage(cause)}`);
        },
      )
      .then(() => {
        setPending(null);
      });
  };

  return (
    <>
      <SettingsSection
        title="Saved permission rules"
        description="Permissions you answered with “Always allow” or “Always deny”. They apply to every session on this server."
      >
        <SettingsInventoryStatus
          state={inventory.state}
          loading="Loading saved permission rules…"
          unavailable="Connect to an OpenCode server to view saved permission rules."
          onRetry={inventory.reload}
        />
        {inventory.state.phase === "ready" && rules.length === 0 ? (
          <SettingsNote>
            No saved rules yet. A rule appears here when you choose “Always allow” on a permission
            prompt.
          </SettingsNote>
        ) : null}
        {rules.length === 0 ? null : (
          <SettingsRows>
            {rules.map((rule) => {
              const denied = "effect" in rule && rule.effect === "deny";
              return (
                <SettingsRow
                  key={rule.id}
                  title={savedPermissionTitle(rule)}
                  description={rule.action}
                  control={
                    <div {...stylex.props(styles.actions)}>
                      <Badge size="sm" tone={denied ? "err" : "ok"}>
                        {denied ? "Always deny" : "Always allow"}
                      </Badge>
                      {pending === rule.id ? <Spinner size="sm" /> : null}
                      <Button
                        size="sm"
                        variant="quiet"
                        disabled={pending !== null}
                        aria-busy={pending === rule.id}
                        onClick={() => {
                          revoke(rule);
                        }}
                      >
                        Revoke
                      </Button>
                    </div>
                  }
                />
              );
            })}
          </SettingsRows>
        )}
        {failure === null ? null : <SettingsAlert>{failure}</SettingsAlert>}
      </SettingsSection>

      <SettingsSection
        description="OpenCode has no separate hooks config. Hooks run as plugin code, so a custom hook ships inside a plugin."
        action={
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              settingsActions.setSection("plugins");
            }}
          >
            Open plugins
          </Button>
        }
      >
        <SettingsNote>
          Loaded plugins are listed under Plugins. Add a plugin in the plugin section of
          opencode.json to run your own hooks.
        </SettingsNote>
      </SettingsSection>
    </>
  );
}

// Saved rules identify the thing they cover by resource; older servers may use a bare pattern.
function savedPermissionTitle(rule: OpenCodeSavedPermission): string {
  if (rule.resource.trim().length > 0) return rule.resource;
  return "pattern" in rule && typeof rule.pattern === "string" ? rule.pattern : rule.action;
}
