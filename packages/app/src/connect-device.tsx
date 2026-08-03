import * as stylex from "@stylexjs/stylex";
import type { DesktopServerExposureState } from "@honk/shared/desktop-api";
import {
  Badge,
  Button,
  Dialog,
  Field,
  Icon,
  IconButton,
  SegmentedControl,
  Spinner,
  Text,
} from "@honk/ui";
import {
  IconArrowRotateClockwise,
  IconCircleCheck,
  IconComputerUse,
  IconCrossMedium,
  IconExclamationCircle,
  IconGlobe,
  IconSleep,
} from "@honk/ui/icons";
import {
  borderVars,
  colorVars,
  controlVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { toQR } from "toqr";

import {
  connectDeviceController,
  type ConnectDeviceSnapshot,
  useConnectDeviceSnapshot,
} from "./connect-device-controller";
import { canManageDesktopRemoteHost, openDesktopExternal } from "./desktop-bridge";
import { actions as settingsActions } from "./settings-store";
import { actions as toastActions } from "./toast-store";

/**
 * The connection method is the one product object behind "how devices connect". The contract keeps a
 * single network-accessible mode, so a stored custom address is what separates a plain Wi-Fi address
 * Honk derives itself from a secure address the user points at this computer.
 */
export type ConnectionMethod = "lan" | "tailscale" | "tunnel" | "custom-https" | "off";

export const CONNECTION_METHODS = {
  lan: {
    label: "Same Wi-Fi",
    description:
      "No setup. Works only while both devices are on this network, and traffic is not encrypted.",
  },
  tailscale: {
    label: "Tailscale",
    description: "Works anywhere. Needs Tailscale running on both devices.",
  },
  tunnel: {
    label: "Temporary link",
    description:
      "A public web address that changes every time Honk restarts. Cloudflare carries the traffic, so it is not private end to end.",
  },
  "custom-https": {
    label: "Custom HTTPS address",
    description: "Use a secure address you already point at this computer.",
  },
  off: { label: "Off", description: "Only this computer can reach Honk." },
} as const satisfies Record<
  ConnectionMethod,
  { readonly label: string; readonly description: string }
>;

export function connectionMethodFrom(exposure: DesktopServerExposureState): ConnectionMethod {
  if (exposure.mode === "local-only") return "off";
  if (exposure.mode === "tailscale") return "tailscale";
  if (exposure.mode === "tunnel") return "tunnel";
  return exposure.customUrl === null ? "lan" : "custom-https";
}

const STARTING_BODY: Record<ConnectionMethod, string> = {
  lan: "Honk is finding this computer's address on your network.",
  tailscale: "Honk is preparing a private address for this computer.",
  tunnel: "Honk is opening a temporary link for this computer.",
  "custom-https": "Honk is publishing your address.",
  off: "Honk is preparing this computer's address.",
};

const PAIRING_BODY: Record<ConnectionMethod, string> = {
  lan: "Both devices must stay on this Wi-Fi network. On cellular, this stops working. Traffic to this computer is not encrypted, so use Tailscale on a network you do not trust.",
  tailscale: "Works on Wi-Fi and cellular while Tailscale is connected on both devices.",
  tunnel:
    "Works anywhere while Honk is open. The link changes when Honk restarts, so devices need a new code after that. Cloudflare carries this traffic.",
  "custom-https": "Works wherever your address is reachable.",
  off: "This code works only while device connections are on.",
};

const QR_MARGIN = 4;
const TAILSCALE_HELP_URL = "https://tailscale.com/docs/install";
const CONNECT_DEVICE_COMPACT_MEDIA = "@media (max-width: 460px)";
// A stable square stage prevents the dialog from jumping between connection states.
const CONNECTION_STAGE_SIZE = "288px";
const CONNECTION_COPY_MAX_WIDTH = "440px";

const stateEnter = stylex.keyframes({
  from: {
    opacity: 0,
    transform: `translateY(${spaceVars["--honk-space-gutter"]})`,
  },
  to: {
    opacity: 1,
    transform: "translateY(0)",
  },
});

const styles = stylex.create({
  close: {
    position: "absolute",
    top: spaceVars["--honk-space-gutter"],
    right: spaceVars["--honk-space-gutter"],
  },
  body: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minWidth: 0,
  },
  state: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
    animationName: stateEnter,
    animationDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  stage: {
    width: CONNECTION_STAGE_SIZE,
    maxWidth: "100%",
    aspectRatio: "1",
    boxSizing: "border-box",
    display: "grid",
    placeItems: "center",
    borderRadius: radiusVars["--honk-radius-window"],
    overflow: "hidden",
  },
  stageNeutral: {
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  stageWarn: {
    backgroundColor: colorVars["--honk-color-warn-bg"],
  },
  stageError: {
    backgroundColor: colorVars["--honk-color-err-bg"],
  },
  stageSuccess: {
    backgroundColor: colorVars["--honk-color-ok-bg"],
  },
  stageVisual: {
    boxSizing: "border-box",
    width: `calc(${controlVars["--honk-control-h-lg"]} * 2)`,
    aspectRatio: "1",
    display: "grid",
    placeItems: "center",
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-base"],
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
  qrFrame: {
    width: CONNECTION_STAGE_SIZE,
    maxWidth: "100%",
    aspectRatio: "1",
    boxSizing: "border-box",
    padding: spaceVars["--honk-space-panel-pad"],
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-base"],
    borderRadius: radiusVars["--honk-radius-window"],
    // QR codes require a pure white field in every theme for reliable scanner contrast.
    // oxlint-disable-next-line honk/design-no-raw-values
    backgroundColor: "#ffffff",
  },
  qr: {
    display: "block",
    width: "100%",
    height: "100%",
  },
  copy: {
    width: "100%",
    maxWidth: CONNECTION_COPY_MAX_WIDTH,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
  actions: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
  },
  pairingMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: controlVars["--honk-control-gap"],
    flexWrap: "wrap",
  },
  linkFallback: {
    width: "100%",
    maxWidth: CONNECTION_COPY_MAX_WIDTH,
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    textAlign: "start",
  },
  linkAction: {
    width: "100%",
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) auto",
      [CONNECT_DEVICE_COMPACT_MEDIA]: "minmax(0, 1fr)",
    },
    gap: controlVars["--honk-control-gap"],
  },
  endpoint: {
    maxWidth: "100%",
    overflowWrap: "anywhere",
    paddingInline: controlVars["--honk-control-pad-sm"],
    paddingBlock: controlVars["--honk-control-gap"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  liveStatus: {
    position: "absolute",
    width: borderVars["--honk-border-hairline"],
    height: borderVars["--honk-border-hairline"],
    padding: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
});

function encodePairingQr(value: string) {
  try {
    const modules = toQR(value);
    const size = Math.sqrt(modules.length);
    if (!Number.isInteger(size)) return null;
    return {
      path: Array.from(modules, (module, index) =>
        module === 1
          ? `M${(index % size) + QR_MARGIN} ${Math.floor(index / size) + QR_MARGIN}h1v1h-1z`
          : "",
      ).join(""),
      viewBoxSize: size + QR_MARGIN * 2,
    };
  } catch {
    return null;
  }
}

function PairingQrCode(props: { readonly value: string; readonly label: string }): ReactElement {
  const encoded = encodePairingQr(props.value);
  if (encoded === null) {
    return (
      <div {...stylex.props(styles.stage, styles.stageError)}>
        <div {...stylex.props(styles.copy)}>
          <Icon icon={IconExclamationCircle} size="xl" tone="err" />
          <Text as="p" size="sm" tone="err">
            Could not draw the code. Use the connection link below.
          </Text>
        </div>
      </div>
    );
  }
  return (
    <div {...stylex.props(styles.qrFrame)}>
      <svg
        viewBox={`0 0 ${encoded.viewBoxSize} ${encoded.viewBoxSize}`}
        role="img"
        aria-label={props.label}
        shapeRendering="crispEdges"
        {...stylex.props(styles.qr)}
      >
        <rect width={encoded.viewBoxSize} height={encoded.viewBoxSize} fill="#ffffff" />
        <path d={encoded.path} fill="#000000" />
      </svg>
    </div>
  );
}

function ConnectionState(props: {
  readonly tone?: "neutral" | "warn" | "error" | "success";
  readonly visual: ReactElement;
  readonly title: string;
  readonly description: ReactNode;
  readonly actions?: ReactNode;
}): ReactElement {
  return (
    <div {...stylex.props(styles.state)}>
      <div
        {...stylex.props(
          styles.stage,
          props.tone === "warn"
            ? styles.stageWarn
            : props.tone === "error"
              ? styles.stageError
              : props.tone === "success"
                ? styles.stageSuccess
                : styles.stageNeutral,
        )}
      >
        <div {...stylex.props(styles.stageVisual)}>{props.visual}</div>
      </div>
      <div {...stylex.props(styles.copy)}>
        <Text as="p" size="lg" weight="semibold">
          {props.title}
        </Text>
        {props.description}
      </div>
      {props.actions === undefined ? null : (
        <div {...stylex.props(styles.actions)}>{props.actions}</div>
      )}
    </div>
  );
}

function openConnectionSettings(): void {
  connectDeviceController.actions.close();
  settingsActions.open("connections");
}

export function ConnectDeviceBody(props: {
  readonly snapshot: ConnectDeviceSnapshot;
}): ReactElement {
  const snapshot = props.snapshot;
  const connectionLink = useRef<HTMLInputElement>(null);
  const [preferredTarget, setPreferredTarget] = useState<"app" | "browser">("app");

  if (
    snapshot.status === "cancelling" ||
    snapshot.status === "loading" ||
    snapshot.status === "issuing" ||
    snapshot.status === "restarting"
  ) {
    const title =
      snapshot.status === "loading"
        ? "Checking this computer"
        : snapshot.status === "cancelling"
          ? "Canceling this code"
          : snapshot.status === "restarting"
            ? "Restarting connections"
            : "Creating a one-time code";
    return (
      <ConnectionState
        visual={<Spinner size="lg" />}
        title={title}
        description={
          <Text as="p" size="sm" tone="muted">
            This should only take a moment.
          </Text>
        }
      />
    );
  }

  if (snapshot.status === "setup" || snapshot.status === "enabling") {
    return (
      <ConnectionState
        visual={<Icon icon={IconGlobe} size="xl" tone="accent" />}
        title="Turn on device connections"
        description={
          <>
            <Text as="p" size="sm" tone="muted">
              Tailscale gives this computer a private address only your devices can reach.
            </Text>
            <Text as="p" size="sm" tone="muted">
              To use {CONNECTION_METHODS.lan.label} or your own address instead, change how devices
              connect in Settings.
            </Text>
          </>
        }
        actions={
          <>
            <Button
              variant="primary"
              disabled={snapshot.status === "enabling"}
              iconStart={snapshot.status === "enabling" ? <Spinner size="sm" /> : undefined}
              onClick={connectDeviceController.actions.enableTailscale}
            >
              Turn on with Tailscale
            </Button>
            <Button disabled={snapshot.status === "enabling"} onClick={openConnectionSettings}>
              Change how devices connect
            </Button>
            <Button variant="quiet" onClick={() => void openDesktopExternal(TAILSCALE_HELP_URL)}>
              Installation help
            </Button>
          </>
        }
      />
    );
  }

  if (snapshot.status === "starting") {
    return (
      <ConnectionState
        visual={<Spinner size="lg" />}
        title="Starting device connections"
        description={
          <Text as="p" size="sm" tone="muted">
            {STARTING_BODY[connectionMethodFrom(snapshot.exposure)]}
          </Text>
        }
      />
    );
  }

  if (snapshot.status === "host-error") {
    const method = connectionMethodFrom(snapshot.exposure);
    // The host reports no LAN address at all when this computer is off every network, which is the
    // one blocked state the user fixes outside Honk rather than by restarting it.
    if (method === "lan" && snapshot.exposure.endpointUrl === null) {
      return (
        <ConnectionState
          tone="warn"
          visual={<Icon icon={IconExclamationCircle} size="xl" tone="warn" />}
          title="This computer is not on a network"
          description={
            <Text as="p" size="sm" tone="muted">
              Connect this computer to Wi-Fi or Ethernet, or switch to a method that works anywhere.
            </Text>
          }
          actions={
            <>
              {/* Retry relaunches Honk so the host re-scans for an address; the label says so. */}
              <Button variant="primary" onClick={connectDeviceController.actions.retry}>
                Restart Honk
              </Button>
              <Button onClick={openConnectionSettings}>Use a different method</Button>
            </>
          }
        />
      );
    }
    if (method === "tunnel") {
      return (
        <ConnectionState
          tone="error"
          visual={<Icon icon={IconExclamationCircle} size="xl" tone="err" />}
          title="Could not open a temporary link"
          description={
            <Text as="p" role="alert" size="sm" tone="err">
              {snapshot.host.errorMessage ??
                "Honk could not reach the tunnel service. Check this computer's internet connection and try again."}
            </Text>
          }
          actions={
            <>
              <Button
                variant="primary"
                iconStart={<Icon icon={IconArrowRotateClockwise} size="sm" />}
                onClick={connectDeviceController.actions.retry}
              >
                Restart Honk
              </Button>
              <Button onClick={openConnectionSettings}>Use a different method</Button>
            </>
          }
        />
      );
    }
    if (method === "lan" || method === "custom-https") {
      return (
        <ConnectionState
          tone="error"
          visual={<Icon icon={IconExclamationCircle} size="xl" tone="err" />}
          title={`${CONNECTION_METHODS[method].label} is not working`}
          description={
            <Text as="p" role="alert" size="sm" tone="err">
              {snapshot.host.errorMessage ??
                "Honk could not reach this computer at that address. Check it, then try again."}
            </Text>
          }
          actions={
            <>
              <Button
                variant="primary"
                iconStart={<Icon icon={IconArrowRotateClockwise} size="sm" />}
                onClick={connectDeviceController.actions.retry}
              >
                Restart Honk
              </Button>
              <Button onClick={openConnectionSettings}>Use a different method</Button>
            </>
          }
        />
      );
    }
    const serveEnableUrl = snapshot.host.serveEnableUrl;
    if (serveEnableUrl !== null) {
      return (
        <ConnectionState
          tone="warn"
          visual={<Icon icon={IconExclamationCircle} size="xl" tone="warn" />}
          title="Approve Tailscale Serve"
          description={
            <Text as="p" size="sm" tone="muted">
              {snapshot.host.errorMessage ??
                "Tailscale needs one-time approval to give this computer a private HTTPS address."}
            </Text>
          }
          actions={
            <>
              <Button variant="primary" onClick={() => void openDesktopExternal(serveEnableUrl)}>
                Approve in Tailscale
              </Button>
              <Button onClick={connectDeviceController.actions.retry}>Restart Honk</Button>
            </>
          }
        />
      );
    }
    return (
      <ConnectionState
        tone="error"
        visual={<Icon icon={IconExclamationCircle} size="xl" tone="err" />}
        title="Reconnect Tailscale"
        description={
          <Text as="p" role="alert" size="sm" tone="err">
            {snapshot.host.errorMessage ??
              "Open Tailscale from the menu bar and make sure it is connected."}
          </Text>
        }
        actions={
          <>
            <Button
              variant="primary"
              iconStart={<Icon icon={IconArrowRotateClockwise} size="sm" />}
              onClick={connectDeviceController.actions.retry}
            >
              Restart Honk
            </Button>
            <Button onClick={() => void openDesktopExternal(TAILSCALE_HELP_URL)}>
              Tailscale help
            </Button>
          </>
        }
      />
    );
  }

  if (snapshot.status === "pairing") {
    const remaining = `${Math.floor(snapshot.remaining / 60)}:${String(snapshot.remaining % 60).padStart(2, "0")}`;
    // The host omits the browser link for plaintext endpoints, where browser pairing cannot work at
    // all. Reading the contract field keeps the browser affordances honest without a UI heuristic.
    const browserLink = snapshot.pairing.url;
    const target = browserLink === null ? "app" : preferredTarget;
    const link =
      target === "app" || browserLink === null ? snapshot.pairing.mobileUrl : browserLink;
    return (
      <div {...stylex.props(styles.state)}>
        <PairingQrCode
          value={link}
          label={
            target === "app" ? "One-time code for the Honk app" : "One-time code for a web browser"
          }
        />
        <div {...stylex.props(styles.copy)}>
          <Text as="p" size="lg" weight="semibold">
            {target === "app" ? "Scan with the Honk app" : "Open Honk in your browser"}
          </Text>
          {browserLink === null ? (
            <Text as="p" size="sm" tone="muted">
              Only the Honk app can use a {CONNECTION_METHODS.lan.label} connection. Browsers need a
              secure address.
            </Text>
          ) : (
            <SegmentedControl
              value={target}
              accessibilityLabel="Where to open Honk"
              options={[
                { value: "app", label: "Honk app" },
                { value: "browser", label: "Web browser" },
              ]}
              onValueChange={setPreferredTarget}
            />
          )}
          <Text as="p" size="sm" tone="muted">
            {PAIRING_BODY[connectionMethodFrom(snapshot.exposure)]}
          </Text>
          <div {...stylex.props(styles.pairingMeta)}>
            <Badge tone="outline">One-time code</Badge>
            <Text as="span" size="xs" tone="faint" tabularNums>
              Expires in {remaining}
            </Text>
          </div>
        </div>
        <div {...stylex.props(styles.linkFallback)}>
          <Text as="p" size="xs" tone="muted">
            {target === "app"
              ? "Or paste this link into the Honk app on the other device"
              : "Or open this link in a browser on the other device"}
          </Text>
          <div {...stylex.props(styles.linkAction)}>
            <Field>
              <Field.Input
                ref={connectionLink}
                aria-label="Connection link"
                readOnly
                value={link}
                onFocus={(event) => event.currentTarget.select()}
              />
            </Field>
            <Button
              onClick={() => {
                const selectAndCopy = (): boolean => {
                  if (connectionLink.current === null) return false;
                  connectionLink.current.focus();
                  connectionLink.current.select();
                  if (typeof document.execCommand !== "function") return false;
                  try {
                    return document.execCommand("copy");
                  } catch {
                    return false;
                  }
                };
                const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard);
                if (writeText === undefined) {
                  const copied = selectAndCopy();
                  toastActions.add({
                    type: copied ? "success" : "info",
                    title: copied
                      ? "Connection link copied"
                      : "Connection link selected. Use your copy shortcut.",
                  });
                  return;
                }
                void Promise.resolve()
                  .then(() => writeText(link))
                  .then(
                    () => toastActions.add({ type: "success", title: "Connection link copied" }),
                    () => {
                      const copied = selectAndCopy();
                      toastActions.add({
                        type: copied ? "success" : "info",
                        title: copied
                          ? "Connection link copied"
                          : "Connection link selected. Use your copy shortcut.",
                      });
                    },
                  );
              }}
            >
              Copy link
            </Button>
          </div>
        </div>
        <Text as="p" size="xs" family="mono" tone="faint" {...stylex.props(styles.endpoint)}>
          {snapshot.host.name}
        </Text>
      </div>
    );
  }

  if (snapshot.status === "expired") {
    return (
      <ConnectionState
        tone="warn"
        visual={<Icon icon={IconSleep} size="xl" tone="warn" />}
        title="This code expired"
        description={
          <Text as="p" size="sm" tone="muted">
            Create a fresh code when the other device is ready.
          </Text>
        }
        actions={
          <Button variant="primary" onClick={connectDeviceController.actions.newPairing}>
            Create new code
          </Button>
        }
      />
    );
  }

  if (snapshot.status === "connected") {
    return (
      <ConnectionState
        tone="success"
        visual={<Icon icon={IconCircleCheck} size="xl" tone="ok" />}
        title={`${snapshot.device.label} is connected`}
        description={
          <Text as="p" size="sm" tone="muted">
            It can now use {snapshot.host.name}. You can rename it or remove access in Device
            access.
          </Text>
        }
        actions={
          <>
            <Button variant="primary" onClick={connectDeviceController.actions.close}>
              Done
            </Button>
            <Button onClick={connectDeviceController.actions.connectAnother}>
              Connect another device
            </Button>
          </>
        }
      />
    );
  }

  if (snapshot.status === "error") {
    const enableFailed = snapshot.retry === "enable";
    return (
      <ConnectionState
        tone="error"
        visual={<Icon icon={IconExclamationCircle} size="xl" tone="err" />}
        title={enableFailed ? "Could not turn on connections" : "Could not continue"}
        description={
          <Text as="p" role="alert" size="sm" tone="err">
            {snapshot.message}
          </Text>
        }
        actions={
          <>
            <Button variant="primary" onClick={connectDeviceController.actions.retry}>
              {snapshot.retry === "check"
                ? "Check again"
                : snapshot.retry === "restart"
                  ? "Restart Honk"
                  : "Try again"}
            </Button>
            {enableFailed ? (
              <Button onClick={() => void openDesktopExternal(TAILSCALE_HELP_URL)}>
                Installation help
              </Button>
            ) : null}
          </>
        }
      />
    );
  }

  if (snapshot.status === "cancel-error") {
    return (
      <ConnectionState
        tone="error"
        visual={<Icon icon={IconExclamationCircle} size="xl" tone="err" />}
        title="Could not cancel this code"
        description={
          <Text as="p" role="alert" size="sm" tone="err">
            {snapshot.message}
          </Text>
        }
        actions={
          <Button variant="primary" onClick={connectDeviceController.actions.retry}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <ConnectionState
      visual={<Icon icon={IconComputerUse} size="xl" tone="muted" />}
      title="Connect a device"
      description={
        <Text as="p" size="sm" tone="muted">
          Preparing device connections.
        </Text>
      }
    />
  );
}

export function ConnectDeviceDialog(): ReactElement | null {
  const available = canManageDesktopRemoteHost();
  const snapshot = useConnectDeviceSnapshot();

  useEffect(() => {
    if (available) connectDeviceController.actions.resume();
  }, [available]);

  if (!available) return null;
  return (
    <Dialog.Root
      open={snapshot.status !== "closed"}
      onOpenChange={(open) => {
        if (!open) connectDeviceController.actions.close();
      }}
    >
      <Dialog.Popup>
        <div {...stylex.props(styles.close)}>
          <IconButton
            size="sm"
            variant="quiet"
            aria-label="Close device connection"
            disabled={snapshot.status === "cancelling"}
            onClick={connectDeviceController.actions.close}
          >
            <Icon icon={IconCrossMedium} size="sm" />
          </IconButton>
        </div>
        <Dialog.Header>
          <Dialog.Title>Connect a device</Dialog.Title>
          <Dialog.Description>
            Use this computer from your phone, tablet, or another computer.
          </Dialog.Description>
        </Dialog.Header>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          {...stylex.props(styles.liveStatus)}
        >
          {connectDeviceAnnouncement(snapshot)}
        </div>
        <div {...stylex.props(styles.body)}>
          <ConnectDeviceBody snapshot={snapshot} />
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

// Keyed on status alone. The pairing countdown republishes every second, so anything derived from
// `remaining` here would re-announce the whole state to a screen reader once per second.
export function connectDeviceAnnouncement(snapshot: ConnectDeviceSnapshot): string {
  if (snapshot.status === "loading") return "Checking device connections.";
  if (snapshot.status === "cancelling") return "Canceling the device connection code.";
  if (snapshot.status === "setup") return "Device connections need to be turned on.";
  if (snapshot.status === "enabling") return "Turning on device connections.";
  if (snapshot.status === "starting") return "Device connections are starting.";
  if (snapshot.status === "restarting") return "Restarting device connections.";
  if (snapshot.status === "issuing") return "Creating a one-time device connection code.";
  if (snapshot.status === "pairing") return "Device connection code ready.";
  if (snapshot.status === "expired") return "The device connection code expired.";
  if (snapshot.status === "connected") return `${snapshot.device.label} is connected.`;
  if (snapshot.status !== "host-error") return "";
  if (snapshot.host.serveEnableUrl !== null) return "Tailscale needs a one-time approval.";
  const method = connectionMethodFrom(snapshot.exposure);
  if (method === "tailscale") return "Tailscale needs attention.";
  return `${CONNECTION_METHODS[method].label} needs attention.`;
}
