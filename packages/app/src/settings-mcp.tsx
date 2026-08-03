import * as stylex from "@stylexjs/stylex";
import type { OpenCodeClient, OpenCodeMcpServerConfig, OpenCodeMcpStatus } from "@honk/opencode";
import { Badge, Button, Field, SegmentedControl, Spinner, Text } from "@honk/ui";
import * as React from "react";

import { persistDesktopMcpServer, readDesktopMcpAvailability } from "./desktop-bridge";
import { errorMessage } from "./error-message";
import { SettingsRow, SettingsRows, SettingsSection } from "./settings-controls";
import {
  SettingsAlert,
  SettingsInventoryStatus,
  SettingsNote,
  useSettingsInventory,
} from "./settings-inventory";
import { getBoundOpenCodeClient } from "./watch-registry";

const MCP_STATUS_LABELS = {
  connected: { label: "Connected", tone: "ok" },
  disabled: { label: "Disabled", tone: "neutral" },
  failed: { label: "Failed", tone: "err" },
  needs_auth: { label: "Needs sign-in", tone: "warn" },
  needs_client_registration: { label: "Needs registration", tone: "err" },
} as const;

const MCP_TYPE_OPTIONS = [
  { value: "local", label: "Local" },
  { value: "remote", label: "Remote" },
] as const;

const styles = stylex.create({
  sectionAction: {
    marginInlineStart: "auto",
  },
});

type McpDraft = {
  readonly type: "local" | "remote";
  readonly name: string;
  readonly target: string;
};

function loadMcp(client: OpenCodeClient) {
  return Promise.all([client.config.get(), client.mcp.status()]).then(([config, status]) => ({
    config,
    status,
  }));
}

export function SettingsMcp(): React.ReactElement {
  const inventory = useSettingsInventory(loadMcp);
  const [draft, setDraft] = React.useState<McpDraft | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const data = inventory.state.phase === "ready" ? inventory.state.data : null;
  const servers = data === null ? [] : mcpServerNames(data.config.mcp, data.status);
  const availability = readDesktopMcpAvailability();
  const canAdd = availability.status === "ready" && data !== null;

  const runServerAction = (
    name: string,
    fallback: string,
    action: (client: OpenCodeClient) => Promise<unknown>,
  ): void => {
    const client = getBoundOpenCodeClient();
    if (client === null) return;
    setPending(name);
    setFailure(null);
    void action(client)
      .then(
        () => {
          inventory.reload();
        },
        (cause: unknown) => {
          setFailure(`${fallback} ${errorMessage(cause)}`);
        },
      )
      .then(() => {
        setPending(null);
      });
  };

  const addServer = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (draft === null) return;
    const client = getBoundOpenCodeClient();
    if (client === null) {
      setFailure("Connect to OpenCode before adding an MCP server.");
      return;
    }
    const name = draft.name.trim();
    const target = draft.target.trim();
    if (name.length === 0 || target.length === 0) {
      setFailure("Enter a name and command or URL.");
      return;
    }
    if (name === "honk") {
      setFailure('The MCP server name "honk" is reserved.');
      return;
    }
    const config =
      draft.type === "local"
        ? { type: "local" as const, command: target.split(/\s+/) }
        : { type: "remote" as const, url: target };
    setPending(name);
    setFailure(null);
    void persistDesktopMcpServer({ name, config })
      .then(
        () => {
          return client.mcp.add(name, config).then(
            () => {
              setDraft(null);
              inventory.reload();
            },
            (cause: unknown) => {
              setFailure(
                `${name} was saved, but OpenCode could not load it. ${errorMessage(cause)}`,
              );
              inventory.reload();
            },
          );
        },
        (cause: unknown) => {
          setFailure(`${name} could not be saved. ${errorMessage(cause)}`);
        },
      )
      .then(() => {
        setPending(null);
      });
  };

  return (
    <SettingsSection
      description="Definitions are saved by Honk and loaded by OpenCode immediately."
      action={
        data === null || draft !== null ? undefined : (
          <div {...stylex.props(styles.sectionAction)}>
            <Button
              size="sm"
              variant="neutral"
              disabled={!canAdd}
              onClick={() => {
                setFailure(null);
                setDraft({ type: "local", name: "", target: "" });
              }}
            >
              Add server
            </Button>
          </div>
        )
      }
    >
      {draft === null ? null : (
        <form onSubmit={addServer}>
          <SettingsRows>
            <SettingsRow
              title="Type"
              description={
                draft.type === "local"
                  ? "Runs a command on this computer."
                  : "Connects to a remote MCP endpoint."
              }
              control={
                <SegmentedControl
                  value={draft.type}
                  disabled={pending !== null}
                  options={MCP_TYPE_OPTIONS}
                  size="sm"
                  accessibilityLabel="MCP server type"
                  onValueChange={(value) => {
                    setDraft((current) =>
                      current === null
                        ? null
                        : {
                            ...current,
                            type: value,
                            target: "",
                          },
                    );
                  }}
                />
              }
            />
            <SettingsRow
              title="Name"
              description="Existing servers with the same name are replaced."
              control={
                <Field>
                  <Field.Input
                    required
                    autoFocus
                    size={28}
                    aria-label="MCP server name"
                    placeholder="linear"
                    value={draft.name}
                    disabled={pending !== null}
                    onChange={(event) => {
                      setDraft({ ...draft, name: event.currentTarget.value });
                    }}
                  />
                </Field>
              }
            />
            <SettingsRow
              title={draft.type === "local" ? "Command" : "URL"}
              description={
                draft.type === "local"
                  ? "The executable and arguments, separated by spaces."
                  : "The HTTP endpoint exposed by the MCP server."
              }
              control={
                <Field>
                  <Field.Input
                    required
                    size={28}
                    type={draft.type === "remote" ? "url" : "text"}
                    aria-label={draft.type === "local" ? "MCP server command" : "MCP server URL"}
                    placeholder={
                      draft.type === "local"
                        ? "npx -y @example/mcp-server"
                        : "https://mcp.example.com"
                    }
                    value={draft.target}
                    disabled={pending !== null}
                    onChange={(event) => {
                      setDraft({ ...draft, target: event.currentTarget.value });
                    }}
                  />
                </Field>
              }
            />
            <SettingsRow
              title="Add server"
              description="Honk saves the definition before asking OpenCode to load it."
              control={
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="quiet"
                    disabled={pending !== null}
                    onClick={() => {
                      setDraft(null);
                      setFailure(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" variant="primary" disabled={pending !== null}>
                    {pending === null ? "Add" : "Adding…"}
                  </Button>
                  {pending === null ? null : <Spinner size="sm" />}
                </>
              }
            />
          </SettingsRows>
        </form>
      )}

      <SettingsInventoryStatus
        state={inventory.state}
        loading="Loading MCP servers…"
        unavailable="Connect to an OpenCode server to view MCP servers."
        onRetry={inventory.reload}
      />
      {data !== null && availability.status === "restart-required" ? (
        <SettingsNote>Restart Honk once to enable MCP editing.</SettingsNote>
      ) : null}
      {data !== null && availability.status === "web" ? (
        <SettingsNote>Add servers from the desktop app.</SettingsNote>
      ) : null}
      {data !== null && servers.length === 0 ? (
        <SettingsNote>No MCP servers configured.</SettingsNote>
      ) : null}
      {servers.length === 0 ? null : (
        <SettingsRows>
          {servers.map((name) => {
            const definition = data?.config.mcp?.[name];
            const status = data?.status[name];
            const detail = status === undefined ? null : MCP_STATUS_LABELS[status.status];
            const reason = status !== undefined && "error" in status ? status.error : null;
            const transport =
              definition !== undefined && "type" in definition ? definition.type : null;
            const action = mcpAction(status);
            return (
              <SettingsRow
                key={name}
                title={name}
                description={
                  <>
                    {mcpEndpoint(definition)}
                    {reason === null ? null : (
                      <Text as="span" role="alert" size="sm" tone="err">
                        {` · ${reason}`}
                      </Text>
                    )}
                  </>
                }
                control={
                  <>
                    {transport === null ? null : (
                      <Badge size="sm" tone="outline">
                        {transport === "local" ? "Local" : "Remote"}
                      </Badge>
                    )}
                    <Badge size="sm" tone={detail?.tone ?? "neutral"}>
                      {detail?.label ?? "Not connected"}
                    </Badge>
                    {pending === name ? <Spinner size="sm" /> : null}
                    {action === null ? null : (
                      <Button
                        size="sm"
                        variant={action.variant}
                        disabled={pending !== null}
                        aria-busy={pending === name}
                        onClick={() => {
                          runServerAction(name, `${name} could not ${action.failure}.`, (client) =>
                            action.run(client, name),
                          );
                        }}
                      >
                        {action.label}
                      </Button>
                    )}
                  </>
                }
              />
            );
          })}
        </SettingsRows>
      )}
      {failure === null ? null : <SettingsAlert>{failure}</SettingsAlert>}
    </SettingsSection>
  );
}

function mcpAction(status: OpenCodeMcpStatus | undefined) {
  if (status?.status === "disabled") return null;
  if (status?.status === "needs_auth") {
    return {
      label: "Sign in",
      variant: "neutral",
      failure: "sign in",
      run: (client: OpenCodeClient, name: string) => client.mcp.authenticate(name),
    } as const;
  }
  if (status?.status === "connected") {
    return {
      label: "Disconnect",
      variant: "quiet",
      failure: "be disconnected",
      run: (client: OpenCodeClient, name: string) => client.mcp.disconnect(name),
    } as const;
  }
  return {
    label: "Connect",
    variant: "neutral",
    failure: "be connected",
    run: (client: OpenCodeClient, name: string) => client.mcp.connect(name),
  } as const;
}

function mcpEndpoint(definition: OpenCodeMcpServerConfig | undefined): string {
  if (definition === undefined) return "Not present in the merged config.";
  if ("type" in definition) {
    return definition.type === "local" ? definition.command.join(" ") : definition.url;
  }
  return definition.enabled ? "Enabled by OpenCode." : "Disabled by OpenCode.";
}

function mcpServerNames(
  definitions: Readonly<Record<string, unknown>> | undefined,
  status: Readonly<Record<string, OpenCodeMcpStatus>>,
): readonly string[] {
  return [...new Set([...Object.keys(definitions ?? {}), ...Object.keys(status)])].toSorted(
    (left, right) => left.localeCompare(right),
  );
}
