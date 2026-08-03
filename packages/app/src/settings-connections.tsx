import * as stylex from "@stylexjs/stylex";
import {
  DESKTOP_REMOTE_NAME_MAX_LENGTH,
  type DesktopRemoteHostDevice,
  type DesktopServerExposureConfiguration,
  type DesktopServerExposureState,
} from "@honk/shared/desktop-api";
import { AlertDialog, Badge, Button, Field, Icon, Picker, Spinner, Text } from "@honk/ui";
import { IconComputerUse, IconExclamationCircle } from "@honk/ui/icons";
import { borderVars, colorVars, controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import { useState, type ReactElement } from "react";

import { CONNECTION_METHODS, connectionMethodFrom, type ConnectionMethod } from "./connect-device";
import { connectDeviceController } from "./connect-device-controller";
import { useConnectionsSettingsState } from "./settings-connections-state";
import { SettingsSection } from "./settings-controls";
import { actions as settingsActions } from "./settings-store";

const CONNECTION_METHOD_ORDER = ["lan", "tailscale", "tunnel", "custom-https", "off"] as const;

// The section can be sitting in any method, including Same Wi-Fi, where the device password and the
// session cross the network in the clear. So it frames the job, names the one thing every method
// has in common, and hands the encryption question to the method the user picks below.
const DEVICE_ACCESS_DESCRIPTION =
  "Use this computer from your phone, tablet, or another computer. Every device needs a one-time code, and the connection method decides whether traffic is encrypted.";

export function exposureConfigurationFor(
  method: ConnectionMethod,
  customUrl: string | null,
): DesktopServerExposureConfiguration {
  if (method === "off") return { mode: "local-only", publicUrl: null };
  if (method === "tailscale") return { mode: "tailscale", publicUrl: null };
  if (method === "tunnel") return { mode: "tunnel", publicUrl: null };
  if (method === "lan") return { mode: "network-accessible", publicUrl: null };
  return { mode: "network-accessible", publicUrl: customUrl };
}

// The one place the user lives with a method rather than choosing it, so it names the address and
// the constraint that address carries.
export function connectionStatusLine(exposure: DesktopServerExposureState): string {
  const method = connectionMethodFrom(exposure);
  if (method === "off") return CONNECTION_METHODS.off.description;
  if (method === "tunnel") {
    if (exposure.endpointUrl === null) {
      return "Honk opens a temporary link when it starts. Devices need a new code after each restart.";
    }
    return `Devices can reach ${exposure.endpointUrl} until Honk restarts. Cloudflare carries the traffic, so it is not private end to end.`;
  }
  if (method === "lan") {
    if (exposure.endpointUrl === null) {
      return "Honk has not found this computer's address on the network yet.";
    }
    return `Devices on this network can reach ${exposure.endpointUrl}. Cellular does not work, and traffic is not encrypted.`;
  }
  if (method === "custom-https") {
    if (exposure.customUrl === null) return "Enter the address that forwards to this computer.";
    return `Devices can reach this computer at ${exposure.customUrl}.`;
  }
  if (exposure.endpointUrl === null) {
    return "Devices signed in to your Tailscale network can reach this computer.";
  }
  return `Devices signed in to your Tailscale network can reach ${exposure.endpointUrl}.`;
}

// The picker's trade-offs disappear behind the confirmation, so the last screen before the switch
// repeats what the chosen method costs and what it does to devices that are already connected.
export function switchConfirmationBody(method: ConnectionMethod): string {
  if (method === "off") {
    return "Honk closes and reopens. After that, only this computer can reach Honk, and connected devices stay saved but cannot reach it.";
  }
  return `${CONNECTION_METHODS[method].description} Honk closes and reopens, and this computer's address changes, so connected devices need the new address before they work again.`;
}

const COMPACT_CONNECTIONS_MEDIA = "@media (max-width: 620px)";

const styles = stylex.create({
  hostPanel: {
    display: "grid",
    gridTemplateColumns: {
      default: "auto minmax(0, 1fr) auto",
      [COMPACT_CONNECTIONS_MEDIA]: "minmax(0, 1fr)",
    },
    alignItems: {
      default: "center",
      [COMPACT_CONNECTIONS_MEDIA]: "stretch",
    },
    gap: spaceVars["--honk-space-panel-pad"],
    padding: spaceVars["--honk-space-panel-pad"],
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  hostIcon: {
    boxSizing: "border-box",
    width: controlVars["--honk-control-h-lg"],
    aspectRatio: "1",
    display: "grid",
    placeItems: "center",
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-base"],
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
  hostCopy: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  hostAction: {
    display: "flex",
    justifyContent: {
      default: "flex-end",
      [COMPACT_CONNECTIONS_MEDIA]: "stretch",
    },
  },
  endpoint: {
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  errorLine: {
    display: "flex",
    alignItems: "flex-start",
    gap: controlVars["--honk-control-gap"],
  },
  nameEditor: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) minmax(260px, 360px)",
      [COMPACT_CONNECTIONS_MEDIA]: "minmax(0, 1fr)",
    },
    alignItems: "center",
    gap: spaceVars["--honk-space-panel-pad"],
    paddingInline: controlVars["--honk-control-pad-sm"],
    paddingBlock: spaceVars["--honk-space-gutter"],
  },
  inputAction: {
    width: "100%",
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) auto",
      [COMPACT_CONNECTIONS_MEDIA]: "minmax(0, 1fr)",
    },
    gap: controlVars["--honk-control-gap"],
  },
  sectionHeading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: controlVars["--honk-control-pad-sm"],
  },
  deviceList: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  deviceRow: {
    minHeight: controlVars["--honk-control-h-lg"],
    display: "flex",
    justifyContent: "space-between",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
    paddingBlock: controlVars["--honk-control-pad-md"],
    borderBottomWidth: {
      default: borderVars["--honk-border-hairline"],
      ":last-child": 0,
    },
    borderBottomStyle: "solid",
    borderBottomColor: colorVars["--honk-color-border-muted"],
    flexDirection: {
      default: "row",
      [COMPACT_CONNECTIONS_MEDIA]: "column",
    },
    alignItems: {
      default: "center",
      [COMPACT_CONNECTIONS_MEDIA]: "stretch",
    },
  },
  deviceCopy: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    overflowWrap: "anywhere",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
  },
  edit: {
    width: "100%",
    display: "grid",
    gap: controlVars["--honk-control-gap"],
    gridTemplateColumns: {
      default: "minmax(0, 1fr) auto auto",
      [COMPACT_CONNECTIONS_MEDIA]: "minmax(0, 1fr)",
    },
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    padding: `calc(${spaceVars["--honk-space-panel-pad"]} * 2)`,
    textAlign: "center",
  },
  disclosure: {
    minWidth: 0,
  },
  recordDisclosure: {
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  summary: {
    paddingInline: controlVars["--honk-control-pad-sm"],
    paddingBlock: spaceVars["--honk-space-gutter"],
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
  },
  disclosureBody: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-panel-pad"],
    paddingInline: controlVars["--honk-control-pad-sm"],
    paddingBottom: spaceVars["--honk-space-panel-pad"],
  },
  advancedRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spaceVars["--honk-space-gutter"],
    flexWrap: "wrap",
  },
  advancedCopy: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  loading: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    padding: spaceVars["--honk-space-panel-pad"],
  },
  loadFailure: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
  },
});

function openConnectDevice(): void {
  settingsActions.close();
  connectDeviceController.actions.open();
}

function DeviceRow(props: {
  readonly device: DesktopRemoteHostDevice;
  readonly isBusy: boolean;
  readonly onRename: (deviceID: string, label: string) => Promise<boolean>;
  readonly onRevoke: (device: DesktopRemoteHostDevice) => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(props.device.label);

  if (editing) {
    return (
      <form
        {...stylex.props(styles.deviceRow)}
        onSubmit={(event) => {
          event.preventDefault();
          void props.onRename(props.device.id, label).then((renamed) => {
            if (renamed) setEditing(false);
          });
        }}
      >
        <div {...stylex.props(styles.edit)}>
          <Field>
            <Field.Input
              aria-label={`Name for ${props.device.label}`}
              value={label}
              maxLength={DESKTOP_REMOTE_NAME_MAX_LENGTH}
              autoFocus
              disabled={props.isBusy}
              onChange={(event) => setLabel(event.currentTarget.value)}
            />
          </Field>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            disabled={props.isBusy || label.trim().length === 0}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={props.isBusy}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div {...stylex.props(styles.deviceRow)}>
      <div {...stylex.props(styles.deviceCopy)}>
        <Text as="span" size="base" weight="semibold">
          {props.device.label}
        </Text>
        <Text as="span" size="sm" tone="muted">
          Connected {new Date(props.device.createdAt).toLocaleDateString()}
        </Text>
      </div>
      <div {...stylex.props(styles.actions)}>
        <Button
          size="sm"
          variant="quiet"
          disabled={props.isBusy}
          onClick={() => {
            setLabel(props.device.label);
            setEditing(true);
          }}
        >
          Rename
        </Button>
        <Button
          size="sm"
          variant="quiet"
          disabled={props.isBusy}
          onClick={() => props.onRevoke(props.device)}
        >
          Remove access
        </Button>
      </div>
    </div>
  );
}

function ConnectionsNotice(
  props:
    | { readonly status: "loading" }
    | { readonly status: "error"; readonly message: string; readonly onRetry: () => void },
): ReactElement {
  const failed = props.status === "error";
  return (
    <SettingsSection
      description={DEVICE_ACCESS_DESCRIPTION}
      action={
        <Badge tone={failed ? "err" : "neutral"}>{failed ? "Needs attention" : "Loading"}</Badge>
      }
    >
      <div
        {...stylex.props(styles.deviceList, failed ? styles.loadFailure : styles.loading)}
        role={failed ? "alert" : "status"}
      >
        {failed ? (
          <>
            <Text as="p" size="sm" tone="err">
              {props.message}
            </Text>
            <Button size="sm" variant="primary" onClick={props.onRetry}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <Spinner size="sm" />
            <Text as="p" size="sm" tone="muted">
              Loading connections…
            </Text>
          </>
        )}
      </div>
    </SettingsSection>
  );
}

export function SettingsConnections(): ReactElement | null {
  const state = useConnectionsSettingsState();
  // The picker shows the user's pending choice until the host catches up, so a failed switch keeps
  // the choice on screen next to the reason it failed.
  const [chosenMethod, setChosenMethod] = useState<ConnectionMethod | null>(null);
  const [confirmingMethod, setConfirmingMethod] = useState<ConnectionMethod | null>(null);

  if (!state.available) return null;
  if (!state.loaded) return <ConnectionsNotice status="loading" />;
  if (state.loadError !== null) {
    return (
      <ConnectionsNotice
        status="error"
        message={state.loadError}
        onRetry={() => state.retryLoad()}
      />
    );
  }

  const hostStatus =
    state.operation?.startsWith("configure:") === true
      ? "updating"
      : state.host?.status === "starting"
        ? "starting"
        : state.host?.status === "ready"
          ? "ready"
          : state.host?.status === "error"
            ? "error"
            : "off";
  const activeMethod = state.exposure === null ? "off" : connectionMethodFrom(state.exposure);
  const method = chosenMethod ?? activeMethod;

  return (
    <>
      <SettingsSection
        description={DEVICE_ACCESS_DESCRIPTION}
        action={
          hostStatus === "updating" ? (
            <Badge tone="warn">Updating</Badge>
          ) : hostStatus === "starting" ? (
            <Badge tone="warn">Starting</Badge>
          ) : hostStatus === "ready" ? (
            <Badge tone="ok">Ready</Badge>
          ) : hostStatus === "error" ? (
            <Badge tone="err">Needs attention</Badge>
          ) : (
            <Badge tone="neutral">Off</Badge>
          )
        }
      >
        <div {...stylex.props(styles.hostPanel)}>
          <div {...stylex.props(styles.hostIcon)}>
            <Icon
              icon={hostStatus === "error" ? IconExclamationCircle : IconComputerUse}
              size="lg"
              tone={hostStatus === "error" ? "err" : hostStatus === "ready" ? "ok" : "muted"}
            />
          </div>
          <div {...stylex.props(styles.hostCopy)}>
            <Text as="p" size="base" weight="semibold">
              {state.host?.name ?? "This computer"}
            </Text>
            <Text as="p" size="sm" tone="muted" {...stylex.props(styles.endpoint)}>
              {hostStatus === "updating"
                ? "Updating device connections…"
                : hostStatus === "starting"
                  ? "Getting this computer's address…"
                  : (state.host?.publicUrl ?? CONNECTION_METHODS.off.description)}
            </Text>
            {hostStatus === "error" && state.host?.errorMessage !== null ? (
              <div {...stylex.props(styles.errorLine)}>
                <Icon icon={IconExclamationCircle} size="sm" tone="err" />
                <Text as="p" role="alert" size="sm" tone="err">
                  {state.host?.errorMessage}
                </Text>
              </div>
            ) : null}
          </div>
          <div {...stylex.props(styles.hostAction)}>
            <Button variant="primary" disabled={state.isBusy} onClick={openConnectDevice}>
              {hostStatus === "error"
                ? "Fix connection"
                : hostStatus === "ready"
                  ? "Connect device"
                  : "Set up connections"}
            </Button>
          </div>
        </div>

        <div {...stylex.props(styles.nameEditor)}>
          <div {...stylex.props(styles.hostCopy)}>
            <Text as="p" size="base">
              How devices connect
            </Text>
            <Text as="p" size="sm" tone="muted">
              {state.exposure === null
                ? CONNECTION_METHODS[method].description
                : connectionStatusLine(state.exposure)}
            </Text>
          </div>
          <div {...stylex.props(styles.hostAction)}>
            <Picker.Root
              value={method}
              disabled={state.isBusy}
              onValueChange={(next) => {
                const chosen = next as ConnectionMethod;
                setChosenMethod(chosen);
                // A custom address has to be entered and saved before there is a switch to confirm.
                if (chosen === "custom-https" || chosen === activeMethod) return;
                setConfirmingMethod(chosen);
              }}
            >
              <Picker.Trigger size="sm" accessibilityLabel="How devices connect">
                {CONNECTION_METHODS[method].label}
              </Picker.Trigger>
              <Picker.Popup label="How devices connect" width="wide" layer="dialog" align="end">
                {CONNECTION_METHOD_ORDER.map((option) => (
                  <Picker.Option
                    key={option}
                    value={option}
                    label={CONNECTION_METHODS[option].label}
                    description={CONNECTION_METHODS[option].description}
                  />
                ))}
              </Picker.Popup>
            </Picker.Root>
          </div>
        </div>

        {method === "custom-https" ? (
          <div {...stylex.props(styles.nameEditor)}>
            <div {...stylex.props(styles.hostCopy)}>
              <Text as="p" size="base">
                HTTPS address
              </Text>
              <Text as="p" size="sm" tone="muted">
                A secure web address that forwards to this computer.
              </Text>
            </div>
            <div {...stylex.props(styles.inputAction)}>
              <Field>
                <Field.Input
                  aria-label="Custom HTTPS address"
                  inputMode="url"
                  placeholder="https://honk.example.com"
                  value={state.publicUrl}
                  disabled={state.isBusy}
                  onChange={(event) => state.setPublicUrl(event.currentTarget.value)}
                />
              </Field>
              <Button
                size="sm"
                disabled={
                  state.isBusy ||
                  state.publicUrl.trim().length === 0 ||
                  (activeMethod === "custom-https" &&
                    state.publicUrl.trim() === state.exposure?.customUrl)
                }
                onClick={() => setConfirmingMethod("custom-https")}
              >
                Save address
              </Button>
            </div>
          </div>
        ) : null}

        <div {...stylex.props(styles.nameEditor)}>
          <div {...stylex.props(styles.hostCopy)}>
            <Text as="p" size="base">
              Computer name
            </Text>
            <Text as="p" size="sm" tone="muted">
              Other devices see this name before you grant access.
            </Text>
          </div>
          <div {...stylex.props(styles.inputAction)}>
            <Field>
              <Field.Input
                aria-label="Computer name"
                value={state.hostName}
                maxLength={DESKTOP_REMOTE_NAME_MAX_LENGTH}
                disabled={state.isBusy}
                onChange={(event) => state.setHostName(event.currentTarget.value)}
              />
            </Field>
            <Button
              size="sm"
              disabled={
                state.isBusy ||
                state.hostName.trim().length === 0 ||
                state.hostName.trim() === state.host?.name
              }
              iconStart={state.operation === "name" ? <Spinner size="sm" /> : undefined}
              onClick={() => void state.saveName()}
            >
              Save
            </Button>
          </div>
        </div>

        <div {...stylex.props(styles.sectionHeading)}>
          <Text as="p" size="base" weight="semibold">
            Connected devices
          </Text>
          <Badge tone="neutral">{state.activeDevices.length}</Badge>
        </div>
        {state.activeDevices.length === 0 ? (
          <div {...stylex.props(styles.deviceList, styles.empty)}>
            <Icon icon={IconComputerUse} size="lg" tone="faint" />
            <Text as="p" size="sm" tone="muted">
              No devices have access to this computer yet.
            </Text>
          </div>
        ) : (
          <div {...stylex.props(styles.deviceList)} aria-label="Connected devices">
            {state.activeDevices.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                isBusy={state.isBusy}
                onRename={state.rename}
                onRevoke={(device) => state.requestRevoke(device)}
              />
            ))}
          </div>
        )}

        {state.revokedDevices.length > 0 ? (
          <details {...stylex.props(styles.disclosure, styles.recordDisclosure)}>
            <summary {...stylex.props(styles.summary)}>
              <Text as="span" size="sm" tone="muted">
                Removed devices ({state.revokedDevices.length})
              </Text>
            </summary>
            <div {...stylex.props(styles.disclosureBody)}>
              {state.revokedDevices.map((device) => (
                <div key={device.id} {...stylex.props(styles.advancedRow)}>
                  <div {...stylex.props(styles.advancedCopy)}>
                    <Text as="span" size="sm" tone="muted">
                      {device.label}
                    </Text>
                    <Text as="span" size="xs" tone="faint">
                      Removed {new Date(device.revokedAt ?? device.createdAt).toLocaleString()}
                    </Text>
                  </div>
                  <Badge tone="neutral">Access removed</Badge>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {state.error !== null && state.error !== state.host?.errorMessage ? (
          <Text as="p" role="alert" size="sm" tone="err">
            {state.error}
          </Text>
        ) : null}
      </SettingsSection>

      <AlertDialog.Root
        open={state.revokeDevice !== null}
        onOpenChange={(open) => {
          if (!open) state.dismissRevoke();
        }}
      >
        <AlertDialog.Popup>
          <AlertDialog.Header>
            <AlertDialog.Title>Remove access for {state.revokeDevice?.label}?</AlertDialog.Title>
            <AlertDialog.Description>
              This device will no longer be able to connect. It will need a new code to regain
              access.
            </AlertDialog.Description>
            {state.revokeError === null ? null : (
              <Text as="p" role="alert" size="sm" tone="err">
                {state.revokeError}
              </Text>
            )}
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Close render={<Button variant="quiet" disabled={state.isBusy} />}>
              Cancel
            </AlertDialog.Close>
            <Button
              variant="destructive"
              disabled={state.isBusy}
              iconStart={state.operation?.startsWith("revoke:") ? <Spinner size="sm" /> : undefined}
              onClick={() => void state.revoke()}
            >
              Remove access
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Popup>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={confirmingMethod !== null}
        onOpenChange={(open) => {
          if (open || state.isBusy) return;
          setConfirmingMethod(null);
          setChosenMethod(null);
        }}
      >
        <AlertDialog.Popup>
          <AlertDialog.Header>
            <AlertDialog.Title>
              Restart Honk to switch to{" "}
              {confirmingMethod === null ? "" : CONNECTION_METHODS[confirmingMethod].label}?
            </AlertDialog.Title>
            <AlertDialog.Description>
              {confirmingMethod === null ? "" : switchConfirmationBody(confirmingMethod)}
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Close render={<Button variant="quiet" disabled={state.isBusy} />}>
              Cancel
            </AlertDialog.Close>
            <Button
              variant="primary"
              disabled={state.isBusy}
              iconStart={
                state.operation?.startsWith("configure:") === true ? (
                  <Spinner size="sm" />
                ) : undefined
              }
              onClick={() => {
                if (confirmingMethod === null) return;
                const configuration = exposureConfigurationFor(confirmingMethod, state.publicUrl);
                // The dialog stays open while the switch runs so its busy state is the real one; a
                // successful switch relaunches Honk and a failed one leaves the reason in the panel.
                void state
                  .configure(configuration.mode, configuration.publicUrl)
                  .then(() => setConfirmingMethod(null));
              }}
            >
              Restart and switch
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Popup>
      </AlertDialog.Root>
    </>
  );
}
