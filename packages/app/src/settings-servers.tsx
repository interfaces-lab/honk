import * as stylex from "@stylexjs/stylex";
import type {
  DesktopRemoteHostState,
  DesktopRemotePairingLink,
  DesktopServerExposureState,
} from "@honk/shared/desktop-api";
import { Badge, Button, Field, ListRow, Text } from "@honk/ui";
import { colorVars, controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";
import { toQR } from "toqr";

import {
  canManageDesktopRemoteHost,
  canPersistRemoteCredential,
  getDesktopRemoteHostState,
  getDesktopServerExposureState,
  issueDesktopRemotePairing,
  revokeDesktopRemoteDevice,
  setDesktopServerExposureMode,
  setDesktopServerExposurePublicUrl,
} from "./desktop-bridge";
import {
  actions as serverActions,
  useOpenCodeServerConnections,
  type OpenCodeServerConnection,
} from "./server-store";
import { SettingsSection } from "./settings-controls";

// Pairing QR codes need fixed modules on a neutral white field to remain reliably scannable.
const PAIRING_QR_SIZE = "180px";

const styles = stylex.create({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-layer-01"],
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
  endpointSummary: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: controlVars["--honk-control-gap"],
  },
  pairing: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  qr: {
    display: "block",
    width: PAIRING_QR_SIZE,
    height: PAIRING_QR_SIZE,
    maxWidth: "100%",
    padding: controlVars["--honk-control-pad-md"],
    boxSizing: "border-box",
    borderRadius: radiusVars["--honk-radius-control"],
    // oxlint-disable-next-line honk/design-no-raw-values -- QR field must stay pure white in every theme for scanner contrast, no themed color token fits
    backgroundColor: "#ffffff",
  },
  pairingUrl: {
    width: "100%",
    overflowWrap: "anywhere",
    textAlign: "center",
  },
  deviceList: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  deviceRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spaceVars["--honk-space-gutter"],
    minHeight: controlVars["--honk-control-h-md"],
    paddingInline: controlVars["--honk-control-pad-md"],
  },
  deviceCopy: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    gap: controlVars["--honk-control-gap"],
  },
});

const QR_MARGIN = 4;

function remoteOperationError(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;
}

function PairingQrCode(props: { readonly value: string }): React.ReactElement | null {
  const encoded = (() => {
    try {
      const modules = toQR(props.value);
      const size = Math.sqrt(modules.length);
      if (!Number.isInteger(size)) return null;
      let path = "";
      for (let row = 0; row < size; row += 1) {
        for (let column = 0; column < size; column += 1) {
          if (modules[row * size + column] !== 1) continue;
          path += `M${column + QR_MARGIN} ${row + QR_MARGIN}h1v1h-1z`;
        }
      }
      return { path, viewBoxSize: size + QR_MARGIN * 2 };
    } catch {
      return null;
    }
  })();

  if (encoded === null) return null;
  return (
    <svg
      viewBox={`0 0 ${encoded.viewBoxSize} ${encoded.viewBoxSize}`}
      role="img"
      aria-label="Mobile pairing QR code"
      shapeRendering="crispEdges"
      {...stylex.props(styles.qr)}
    >
      <rect width={encoded.viewBoxSize} height={encoded.viewBoxSize} fill="#ffffff" />
      <path d={encoded.path} fill="#000000" />
    </svg>
  );
}

function RemoteHostStatusBadge(props: {
  readonly state: DesktopRemoteHostState | null;
}): React.ReactElement {
  switch (props.state?.status) {
    case "ready":
      return (
        <Badge size="sm" tone="ok">
          Online
        </Badge>
      );
    case "starting":
      return (
        <Badge size="sm" tone="neutral">
          Starting
        </Badge>
      );
    case "error":
      return (
        <Badge size="sm" tone="err">
          Offline
        </Badge>
      );
    case "disabled":
    case undefined:
      return (
        <Badge size="sm" tone="neutral">
          Disabled
        </Badge>
      );
  }
}

function RemoteAccessPanel(): React.ReactElement | null {
  const available = canManageDesktopRemoteHost();
  const [exposure, setExposure] = React.useState<DesktopServerExposureState | null>(null);
  const [host, setHost] = React.useState<DesktopRemoteHostState | null>(null);
  const [publicUrl, setPublicUrl] = React.useState("");
  const [deviceLabel, setDeviceLabel] = React.useState("");
  const [pairing, setPairing] = React.useState<DesktopRemotePairingLink | null>(null);
  const [operation, setOperation] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [remoteError, setRemoteError] = React.useState<string | null>(null);
  const initializedUrl = React.useRef(false);

  React.useEffect(() => {
    if (!available) return;
    let active = true;
    const poll = (): void => {
      void Promise.all([getDesktopServerExposureState(), getDesktopRemoteHostState()])
        .then(([nextExposure, nextHost]) => {
          if (!active) return;
          setExposure(nextExposure);
          setHost(nextHost);
          if (!initializedUrl.current && nextExposure !== null) {
            initializedUrl.current = true;
            setPublicUrl(nextExposure.customUrl ?? "");
          }
        })
        .catch((cause: unknown) => {
          if (active) {
            setRemoteError(remoteOperationError(cause, "Remote access state could not be loaded."));
          }
        });
    };
    poll();
    const timer = window.setInterval(poll, 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [available]);

  if (!available) return null;

  const enabled = exposure !== null && exposure.mode !== "local-only";
  const tailscaleActive = exposure?.mode === "tailscale";
  const customActive = exposure?.mode === "network-accessible";
  const ready = host?.status === "ready";

  const savePublicUrl = async (): Promise<void> => {
    setOperation("url");
    setRemoteError(null);
    try {
      const next = await setDesktopServerExposurePublicUrl(publicUrl.trim() || null);
      setExposure(next);
      setPublicUrl(next?.customUrl ?? "");
    } catch (cause) {
      setRemoteError(remoteOperationError(cause, "The public HTTPS address could not be saved."));
    } finally {
      setOperation(null);
    }
  };

  const selectTailscale = async (): Promise<void> => {
    setOperation("tailscale");
    setRemoteError(null);
    try {
      setExposure(await setDesktopServerExposureMode("tailscale"));
    } catch (cause) {
      setRemoteError(remoteOperationError(cause, "Tailscale remote access could not be enabled."));
    } finally {
      setOperation(null);
    }
  };

  const selectCustomUrl = async (): Promise<void> => {
    if (publicUrl.trim().length === 0) {
      setRemoteError("Enter the public HTTPS address that forwards to this computer first.");
      return;
    }
    setOperation("custom");
    setRemoteError(null);
    try {
      const saved = await setDesktopServerExposurePublicUrl(publicUrl.trim());
      setExposure(saved);
      setPublicUrl(saved?.customUrl ?? publicUrl.trim());
      setExposure(await setDesktopServerExposureMode("network-accessible"));
    } catch (cause) {
      setRemoteError(
        remoteOperationError(cause, "The custom HTTPS endpoint could not be enabled."),
      );
    } finally {
      setOperation(null);
    }
  };

  const disableRemoteAccess = async (): Promise<void> => {
    setOperation("disable");
    setRemoteError(null);
    try {
      setExposure(await setDesktopServerExposureMode("local-only"));
    } catch (cause) {
      setRemoteError(remoteOperationError(cause, "Remote access could not be turned off."));
    } finally {
      setOperation(null);
    }
  };

  const issuePairing = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!ready) return;
    setOperation("pairing");
    setCopied(false);
    setRemoteError(null);
    try {
      const next = await issueDesktopRemotePairing(deviceLabel.trim() || null);
      if (next === null) throw new Error("Remote access is unavailable.");
      setPairing(next);
      setDeviceLabel("");
    } catch (cause) {
      setRemoteError(remoteOperationError(cause, "A pairing link could not be created."));
    } finally {
      setOperation(null);
    }
  };

  const copyPairing = async (): Promise<void> => {
    if (pairing === null || navigator.clipboard?.writeText === undefined) return;
    try {
      await navigator.clipboard.writeText(pairing.mobileUrl);
      setCopied(true);
    } catch (cause) {
      setRemoteError(remoteOperationError(cause, "The mobile link could not be copied."));
    }
  };

  const revoke = async (deviceID: string): Promise<void> => {
    setOperation(`revoke:${deviceID}`);
    setRemoteError(null);
    try {
      setHost(await revokeDesktopRemoteDevice(deviceID));
    } catch (cause) {
      setRemoteError(remoteOperationError(cause, "The device could not be revoked."));
    } finally {
      setOperation(null);
    }
  };

  return (
    <SettingsSection
      title="Remote access"
      description="Reach this computer from the Honk mobile app over HTTPS — through Tailscale or your own tunnel."
      action={<RemoteHostStatusBadge state={host} />}
    >
      <div {...stylex.props(styles.form)}>
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.serverLine)}>
            <div {...stylex.props(styles.serverChoice)}>
              <Text as="p" size="base" weight="regular">
                Tailscale HTTPS
              </Text>
              <Text as="p" size="sm" tone="muted">
                Reachable from devices signed in to your Tailnet.
              </Text>
            </div>
            {tailscaleActive ? (
              <Badge size="sm" tone="ok">
                Active
              </Badge>
            ) : (
              <Button
                size="sm"
                variant="neutral"
                disabled={operation !== null || exposure === null}
                onClick={() => void selectTailscale()}
              >
                {operation === "tailscale" ? "Checking…" : "Use Tailscale and relaunch"}
              </Button>
            )}
          </div>
          <Text as="p" size="sm" tone="muted">
            Requires Tailscale running here and on your phone.
          </Text>
        </div>

        <div {...stylex.props(styles.field)}>
          <label htmlFor="remote-public-url">
            <Text as="span" size="sm" weight="regular">
              Custom HTTPS address
            </Text>
          </label>
          <Field>
            <Field.Input
              id="remote-public-url"
              inputMode="url"
              placeholder="https://honk.example.com"
              value={publicUrl}
              disabled={operation !== null}
              onChange={(event) => {
                setPublicUrl(event.currentTarget.value);
              }}
            />
          </Field>
          <Text as="p" size="sm" tone="muted">
            Point an HTTPS tunnel or reverse proxy at this computer.
          </Text>
          <div {...stylex.props(styles.formActions)}>
            {customActive ? (
              <Badge size="sm" tone="ok">
                Active
              </Badge>
            ) : null}
            <Button
              size="sm"
              variant="neutral"
              disabled={operation !== null}
              onClick={() => void savePublicUrl()}
            >
              {operation === "url"
                ? "Saving…"
                : customActive
                  ? "Save and relaunch"
                  : "Save address"}
            </Button>
            {!customActive ? (
              <Button
                size="sm"
                variant="neutral"
                disabled={operation !== null || exposure === null}
                onClick={() => void selectCustomUrl()}
              >
                {operation === "custom" ? "Enabling…" : "Use custom address and relaunch"}
              </Button>
            ) : null}
          </div>
        </div>

        <div {...stylex.props(styles.endpointSummary)}>
          <Text as="p" size="sm" tone="muted">
            Phone connects to: {exposure?.endpointUrl ?? "Off"}
          </Text>
          <Text as="p" size="sm" tone="muted">
            Forwards to: {exposure?.localUrl ?? "set on launch"}
          </Text>
          {host?.errorMessage !== null && host?.errorMessage !== undefined ? (
            <Text as="p" size="sm" tone="err">
              {host.errorMessage}
            </Text>
          ) : null}
        </div>

        {enabled ? (
          <div {...stylex.props(styles.formActions)}>
            <Button
              size="sm"
              variant="neutral"
              disabled={operation !== null}
              onClick={() => void disableRemoteAccess()}
            >
              {operation === "disable" ? "Turning off…" : "Turn off remote access"}
            </Button>
          </div>
        ) : null}
      </div>

      {ready ? (
        <form {...stylex.props(styles.form)} onSubmit={(event) => void issuePairing(event)}>
          <Text as="p" size="base" weight="regular">
            Pair a mobile device
          </Text>
          <div {...stylex.props(styles.field)}>
            <label htmlFor="remote-device-label">
              <Text as="span" size="sm" weight="regular">
                Device name (optional)
              </Text>
            </label>
            <Field>
              <Field.Input
                id="remote-device-label"
                placeholder="My phone"
                value={deviceLabel}
                disabled={operation !== null}
                onChange={(event) => {
                  setDeviceLabel(event.currentTarget.value);
                }}
              />
            </Field>
          </div>
          <Text as="p" size="sm" tone="muted">
            Each link works once and expires soon. You can revoke a paired device below.
          </Text>
          <div {...stylex.props(styles.formActions)}>
            <Button type="submit" size="sm" variant="primary" disabled={operation !== null}>
              {operation === "pairing" ? "Creating…" : "Create mobile pairing"}
            </Button>
          </div>
        </form>
      ) : null}

      {pairing !== null ? (
        <div {...stylex.props(styles.pairing)}>
          <PairingQrCode value={pairing.mobileUrl} />
          <div {...stylex.props(styles.pairingUrl)}>
            <Text as="p" size="sm" family="mono" tone="muted">
              {pairing.mobileUrl}
            </Text>
          </div>
          <Text as="p" size="sm" tone="muted">
            Expires {new Date(pairing.expiresAt).toLocaleString()}
          </Text>
          <Button size="sm" variant="neutral" onClick={() => void copyPairing()}>
            {copied ? "Copied" : "Copy mobile link"}
          </Button>
        </div>
      ) : null}

      {ready ? (
        <div {...stylex.props(styles.deviceList)} aria-label="Paired mobile devices">
          <Text as="p" size="base" weight="regular">
            Paired devices
          </Text>
          {host.devices.length === 0 ? (
            <Text as="p" size="sm" tone="muted">
              No devices paired yet.
            </Text>
          ) : (
            host.devices.map((device) => (
              <div key={device.id} {...stylex.props(styles.deviceRow)}>
                <div {...stylex.props(styles.deviceCopy)}>
                  <Text as="span" size="base" weight="regular">
                    {device.label}
                  </Text>
                  <Text as="span" size="sm" tone="muted">
                    Added {new Date(device.createdAt).toLocaleString()}
                  </Text>
                </div>
                {device.revokedAt === null ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={operation !== null}
                    onClick={() => void revoke(device.id)}
                  >
                    {operation === `revoke:${device.id}` ? "Revoking…" : "Revoke"}
                  </Button>
                ) : (
                  <Badge size="sm" tone="neutral">
                    Revoked
                  </Badge>
                )}
              </div>
            ))
          )}
        </div>
      ) : null}

      {remoteError !== null ? (
        <Text as="p" role="alert" size="sm" tone="err">
          {remoteError}
        </Text>
      ) : null}
    </SettingsSection>
  );
}

function statusBadge(connection: OpenCodeServerConnection): React.ReactElement {
  switch (connection.status) {
    case "live":
      return (
        <Badge size="sm" tone="ok">
          Online
        </Badge>
      );
    case "connecting":
      return (
        <Badge size="sm" tone="neutral">
          Connecting
        </Badge>
      );
    case "reconnecting":
      return (
        <Badge size="sm" tone="warn">
          Reconnecting
        </Badge>
      );
    case "unauthorized":
    case "credential-missing":
      return (
        <Badge size="sm" tone="warn">
          Sign in
        </Badge>
      );
    case "closed":
    case "failed":
      return (
        <Badge size="sm" tone="err">
          Offline
        </Badge>
      );
  }
}

function ServerRow(props: { connection: OpenCodeServerConnection }): React.ReactElement {
  const { connection } = props;
  const retryable =
    connection.removable &&
    connection.status !== "live" &&
    connection.status !== "connecting" &&
    connection.status !== "credential-missing";

  return (
    <div {...stylex.props(styles.serverBlock)}>
      <div {...stylex.props(styles.serverLine)}>
        <div {...stylex.props(styles.serverChoice)}>
          <ListRow
            isSelected={connection.selected}
            aria-pressed={connection.selected}
            onClick={() => {
              serverActions.select(connection.server.key);
            }}
          >
            <ListRow.Content>
              <ListRow.Title>{connection.server.label}</ListRow.Title>
              <ListRow.Description>{connection.server.origin}</ListRow.Description>
            </ListRow.Content>
            <ListRow.Meta>
              {connection.selected ? (
                <Badge size="sm" tone="accent">
                  Default
                </Badge>
              ) : null}
              {statusBadge(connection)}
              {connection.removable ? (
                <Badge size="sm" tone={connection.persistent ? "neutral" : "warn"}>
                  {connection.persistent ? "Saved" : "This launch"}
                </Badge>
              ) : null}
            </ListRow.Meta>
          </ListRow>
        </div>

        {connection.removable ? (
          <div {...stylex.props(styles.serverActions)}>
            {retryable ? (
              <Button
                size="sm"
                variant="neutral"
                onClick={() => {
                  void serverActions.retry(connection.server.key).catch(() => undefined);
                }}
              >
                Retry
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                serverActions.remove(connection.server.key);
              }}
            >
              Remove
            </Button>
          </div>
        ) : null}
      </div>
      {connection.error !== null ? (
        <div {...stylex.props(styles.error)}>
          <Text as="p" size="sm" tone="err">
            {connection.error}
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
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <>
      <SettingsSection
        title="Servers"
        description="New threads use the default server. Each server keeps its own threads and sign-in."
      >
        <div {...stylex.props(styles.serverList)} aria-label="Connected servers">
          {servers.map((connection) => (
            <ServerRow key={connection.server.key} connection={connection} />
          ))}
          {restoring ? (
            <Text as="p" size="sm" tone="muted">
              Restoring saved servers…
            </Text>
          ) : null}
        </div>

        <form {...stylex.props(styles.form)} onSubmit={connect}>
          <Text as="p" size="base" weight="regular">
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
                onChange={(event) => {
                  setOrigin(event.currentTarget.value);
                }}
              />
            </Field>
          </div>

          <div {...stylex.props(styles.field)}>
            <label htmlFor="server-credential">
              <Text as="span" size="sm" weight="regular">
                Pairing link or device password
              </Text>
            </label>
            <Field>
              <Field.Input
                id="server-credential"
                type="password"
                autoComplete="off"
                placeholder="Paste a pairing link or password"
                value={credential}
                onChange={(event) => {
                  setCredential(event.currentTarget.value);
                }}
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
                onChange={(event) => {
                  setLabel(event.currentTarget.value);
                }}
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
              size="sm"
              variant="primary"
              disabled={submitting || credential.trim().length === 0}
            >
              {submitting ? "Connecting…" : "Add server"}
            </Button>
          </div>
        </form>
      </SettingsSection>
      <RemoteAccessPanel />
    </>
  );
}
