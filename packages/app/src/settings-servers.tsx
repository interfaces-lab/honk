import * as stylex from "@stylexjs/stylex";
import { AlertDialog, Badge, Button, Field, ListRow, Text } from "@honk/ui";
import { colorVars, controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { canPersistRemoteCredential } from "./desktop-bridge";
import { serverStatus } from "./server-status";
import {
  actions as serverActions,
  useOpenCodeServerConnections,
  type OpenCodeServerConnection,
} from "./server-store";
import { SettingsSection } from "./settings-controls";

const styles = stylex.create({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: controlVars["--honk-control-pad-sm"],
    paddingTop: spaceVars["--honk-space-panel-pad"],
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  formActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
  },
  serverList: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  serverBlock: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    overflow: "hidden",
    padding: controlVars["--honk-control-gap"],
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  serverLine: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
  serverChoice: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
  },
  serverActions: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
  },
  error: {
    paddingInline: controlVars["--honk-control-pad-md"],
  },
});

function ServerRow(props: {
  readonly connection: OpenCodeServerConnection;
  readonly onForget: (connection: OpenCodeServerConnection) => void;
}): React.ReactElement {
  const status = props.connection.removing
    ? { tone: "neutral" as const, detail: "Removing…" }
    : serverStatus(props.connection.status);
  const retryable =
    props.connection.removable &&
    props.connection.status !== "live" &&
    props.connection.status !== "connecting" &&
    props.connection.status !== "credential-missing";

  return (
    <div {...stylex.props(styles.serverBlock)}>
      <div {...stylex.props(styles.serverLine)}>
        <div {...stylex.props(styles.serverChoice)}>
          <ListRow
            isSelected={props.connection.selected}
            aria-pressed={props.connection.selected}
            disabled={
              props.connection.status === "failed" ||
              props.connection.status === "credential-missing" ||
              props.connection.removing
            }
            onClick={() => serverActions.select(props.connection.server.key)}
          >
            <ListRow.Content>
              <ListRow.Title>{props.connection.server.label}</ListRow.Title>
              <ListRow.Description>{props.connection.server.origin}</ListRow.Description>
            </ListRow.Content>
            <ListRow.Meta>
              {props.connection.selected ? (
                <Badge size="sm" tone="accent">
                  Default
                </Badge>
              ) : null}
              <Badge size="sm" tone={status.tone}>
                {status.detail}
              </Badge>
              {props.connection.removable ? (
                <Badge size="sm" tone={props.connection.persistent ? "neutral" : "warn"}>
                  {props.connection.persistent ? "Saved" : "This launch"}
                </Badge>
              ) : null}
            </ListRow.Meta>
          </ListRow>
        </div>

        {props.connection.removable ? (
          <div {...stylex.props(styles.serverActions)}>
            {retryable ? (
              <Button
                size="sm"
                variant="neutral"
                onClick={() => {
                  void serverActions.retry(props.connection.server.key).catch(() => undefined);
                }}
              >
                {props.connection.removing ? "Finish removing" : "Retry"}
              </Button>
            ) : null}
            {props.connection.removing ? (
              <Button size="sm" variant="quiet" onClick={() => props.onForget(props.connection)}>
                Forget locally
              </Button>
            ) : (
              <Button
                size="sm"
                variant="quiet"
                onClick={() => serverActions.remove(props.connection.server.key)}
              >
                Remove
              </Button>
            )}
          </div>
        ) : null}
      </div>
      {props.connection.error !== null ? (
        <div {...stylex.props(styles.error)}>
          <Text as="p" role="alert" size="sm" tone="err">
            {props.connection.error}
          </Text>
        </div>
      ) : null}
    </div>
  );
}

export function SettingsServers(): React.ReactElement {
  const { servers, restoring } = useOpenCodeServerConnections();
  const [origin, setOrigin] = React.useState("");
  const [credential, setCredential] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [forgetConnection, setForgetConnection] = React.useState<OpenCodeServerConnection | null>(
    null,
  );

  const connect = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitting || credential.trim().length === 0) return;
    setSubmitting(true);
    setError(null);
    void serverActions
      .connect({ origin, credential, ...(label.trim().length > 0 ? { label } : {}) })
      .then(() => {
        setOrigin("");
        setCredential("");
        setLabel("");
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error && cause.message.trim().length > 0
            ? cause.message
            : "The server could not be added.",
        );
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <>
      <SettingsSection description="New threads use the default server. Each server keeps its own threads and sign-in.">
        <div {...stylex.props(styles.serverList)} aria-label="Connected servers">
          {servers.map((connection) => (
            <ServerRow
              key={connection.server.key}
              connection={connection}
              onForget={setForgetConnection}
            />
          ))}
          {restoring ? (
            <Text as="p" size="sm" tone="muted">
              Restoring saved servers…
            </Text>
          ) : null}
        </div>

        <form {...stylex.props(styles.form)} onSubmit={connect}>
          <Text as="p" size="base" weight="semibold">
            Add server
          </Text>
          <div {...stylex.props(styles.field)}>
            <label htmlFor="server-origin">
              <Text as="span" size="sm" weight="regular">
                Server address
              </Text>
            </label>
            <Field>
              <Field.Input
                id="server-origin"
                inputMode="url"
                placeholder="https://honk.example.com"
                value={origin}
                onChange={(event) => setOrigin(event.currentTarget.value)}
              />
            </Field>
          </div>

          <div {...stylex.props(styles.field)}>
            <label htmlFor="server-credential">
              <Text as="span" size="sm" weight="regular">
                Connection link or computer password
              </Text>
            </label>
            <Field>
              <Field.Input
                id="server-credential"
                type="password"
                autoComplete="off"
                placeholder="Paste a connection link or password"
                value={credential}
                onChange={(event) => setCredential(event.currentTarget.value)}
              />
            </Field>
          </div>

          <div {...stylex.props(styles.field)}>
            <label htmlFor="server-label">
              <Text as="span" size="sm" weight="regular">
                Name (optional)
              </Text>
            </label>
            <Field>
              <Field.Input
                id="server-label"
                placeholder="Workstation"
                value={label}
                onChange={(event) => setLabel(event.currentTarget.value)}
              />
            </Field>
          </div>

          <Text as="p" size="sm" tone="muted">
            {canPersistRemoteCredential()
              ? "Stored securely on this device."
              : "Kept for this session only."}
          </Text>
          {error !== null ? (
            <Text as="p" role="alert" size="sm" tone="err">
              {error}
            </Text>
          ) : null}
          <div {...stylex.props(styles.formActions)}>
            <Button
              type="submit"
              size="md"
              variant="primary"
              disabled={submitting || credential.trim().length === 0}
            >
              {submitting ? "Connecting…" : "Add server"}
            </Button>
          </div>
        </form>
      </SettingsSection>

      <AlertDialog.Root
        open={forgetConnection !== null}
        onOpenChange={(open) => {
          if (!open) setForgetConnection(null);
        }}
      >
        <AlertDialog.Popup>
          <AlertDialog.Header>
            <AlertDialog.Title>Forget {forgetConnection?.server.label} locally?</AlertDialog.Title>
            <AlertDialog.Description>
              Honk will stop trying to remove this device’s access on the other computer. That
              access may remain active until you remove it there.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Close render={<Button variant="quiet" />}>Keep trying</AlertDialog.Close>
            <Button
              variant="destructive"
              onClick={() => {
                if (forgetConnection === null) return;
                serverActions.forget(forgetConnection.server.key);
                setForgetConnection(null);
              }}
            >
              Forget locally
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Popup>
      </AlertDialog.Root>
    </>
  );
}
