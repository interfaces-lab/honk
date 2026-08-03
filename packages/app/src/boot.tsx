// Connection gate surfaces. Lifecycle lives in connection-store. No useEffect here.

import * as stylex from "@stylexjs/stylex";
import { Button, Field, Matrix, Shell, StatusDot, Text } from "@honk/ui";
import {
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import {
  Outlet,
  useNavigate,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import * as React from "react";

import { useAppearanceTheme } from "./appearance-store";
import {
  actions as connectionActions,
  useConnection,
  type ConnectionSnapshot,
  type ConnectionStatus,
  type PendingConnectionPairing,
} from "./connection-store";
import { shouldUseDesktopGlass } from "./desktop-bridge";
import { ONBOARDING_PATH } from "./onboarding";
import { V2_PATH } from "./v2";
import { AppShell } from "./shell";

// Wordmark is larger than the prose ramp's 16px cap, so its size stays a named intrinsic.
const SPLASH_WORDMARK_SIZE = "24px";
const CONNECTION_GATE_CARD_MAX_WIDTH = "320px";

const schemeStyles: Record<"system" | "light" | "dark", React.CSSProperties> = {
  system: { colorScheme: "light dark" },
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
};

const connectionStatus: Record<
  ConnectionStatus,
  {
    readonly tone: "ok" | "warn" | "err" | "neutral";
    readonly label: "Done" | "Working" | "Needs you" | "Failed";
    readonly detail:
      | "Connected"
      | "Connecting"
      | "Confirm connection"
      | "Password needed"
      | "Could not connect";
    readonly pulse: boolean;
  }
> = {
  authenticated: { tone: "ok", label: "Done", detail: "Connected", pulse: false },
  connecting: { tone: "neutral", label: "Working", detail: "Connecting", pulse: true },
  "confirm-pairing": {
    tone: "warn",
    label: "Needs you",
    detail: "Confirm connection",
    pulse: false,
  },
  "requires-auth": {
    tone: "warn",
    label: "Needs you",
    detail: "Password needed",
    pulse: false,
  },
  unreachable: {
    tone: "err",
    label: "Failed",
    detail: "Could not connect",
    pulse: false,
  },
};

const styles = stylex.create({
  center: {
    flexGrow: 1,
    display: "grid",
    placeItems: "center",
    padding: spaceVars["--honk-space-panel-pad"],
    minHeight: 0,
  },
  splash: {
    display: "grid",
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px splash stack gap exceeds the spacing ramp (panel-pad caps at 12px); fixed wordmark/matrix rhythm
    gap: "16px",
    justifyItems: "center",
    textAlign: "center",
  },
  card: {
    width: "100%",
    maxWidth: CONNECTION_GATE_CARD_MAX_WIDTH,
    display: "grid",
    gap: spaceVars["--honk-space-panel-pad"],
    padding: spaceVars["--honk-space-panel-pad"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    borderRadius: radiusVars["--honk-radius-panel"],
    boxShadow: elevationVars["--honk-elevation-raised"],
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
  titleBarConnection: {
    minWidth: 0,
    maxWidth: "100%",
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
  titleBarIdentity: {
    display: "block",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
    alignItems: "center",
  },
  status: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-panel-pad"],
    padding: spaceVars["--honk-space-panel-pad"],
    minHeight: 0,
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
  },
  statusCopy: {
    display: "grid",
    gap: controlVars["--honk-control-gap"],
  },
  details: {
    flexGrow: 1,
    minHeight: 0,
    overflow: "auto",
    margin: 0,
    padding: 0,
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
    lineHeight: fontVars["--honk-leading-caption"],
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    textAlign: "start",
  },
  centerFill: {
    alignSelf: "stretch",
    width: "100%",
  },
});

function ConnectionTitleBar(): React.ReactElement {
  const connection = useConnection();
  const status = connectionStatus[connection.status];
  const identity =
    connection.status === "confirm-pairing"
      ? connection.pairing.preview.name
      : (connection.origin ?? "No computer selected");
  return (
    <Shell.TitleBar
      trailing={
        <div
          data-shell-no-drag=""
          role="status"
          aria-atomic="true"
          aria-label={`Current server: ${identity}. Status: ${status.label}, ${status.detail.toLocaleLowerCase()}.`}
          {...stylex.props(styles.titleBarConnection)}
        >
          <StatusDot tone={status.tone} pulse={status.pulse} />
          <Text
            as="span"
            size="xs"
            family={connection.status === "confirm-pairing" ? "ui" : "mono"}
            tone="muted"
            style={{ flexGrow: 1, minWidth: 0 }}
          >
            <span {...stylex.props(styles.titleBarIdentity)}>{identity}</span>
          </Text>
          <Text as="span" size="xs" tone="faint" style={{ flexShrink: 0 }}>
            {status.detail}
          </Text>
        </div>
      }
    />
  );
}

function GateFrame(props: { readonly children: React.ReactNode }): React.ReactElement {
  const theme = useAppearanceTheme();
  return (
    <Shell material={shouldUseDesktopGlass() ? "glass" : "solid"} style={schemeStyles[theme]}>
      <ConnectionTitleBar />
      <Shell.Stage>
        <Shell.Sheet>
          <div {...stylex.props(styles.center, styles.centerFill)}>{props.children}</div>
        </Shell.Sheet>
      </Shell.Stage>
    </Shell>
  );
}

function ConnectingSplash(): React.ReactElement {
  if (shouldUseDesktopGlass()) {
    // Keep desktop renderer boot transparent so reload shows only the native glass window.
    return <></>;
  }

  return (
    <GateFrame>
      <div {...stylex.props(styles.splash)}>
        <Text
          size="xl"
          weight="semibold"
          style={{
            // oxlint-disable-next-line honk/design-no-raw-values -- 24px is the splash wordmark's display size above the prose ramp; no font-size token owns brand display type
            fontSize: SPLASH_WORDMARK_SIZE,
            lineHeight: 1.1,
          }}
        >
          honk
        </Text>
        <Matrix isActive grid={6} style={{ color: colorVars["--honk-color-accent"] }} />
      </div>
    </GateFrame>
  );
}

function RequiresAuthCard(props: { readonly errorMessage: string | null }): React.ReactElement {
  // Uncontrolled. Submit reads the DOM so we never sync field state in an effect.
  const inputRef = React.useRef<HTMLInputElement>(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    connectionActions.submitToken(inputRef.current?.value ?? "");
  };

  return (
    <GateFrame>
      <form {...stylex.props(styles.card)} onSubmit={onSubmit}>
        <Text size="lg" weight="semibold">
          honk
        </Text>
        <Text
          id="browser-connection-help"
          role={props.errorMessage === null ? undefined : "alert"}
          size="sm"
          tone={props.errorMessage === null ? "muted" : "err"}
        >
          {props.errorMessage ??
            "Paste a Honk connection link or computer password to connect this browser."}
        </Text>
        <Field>
          <Field.Input
            ref={inputRef}
            type="password"
            name="pairing-token"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste connection link or computer password…"
            aria-label="Connection link or computer password"
            aria-describedby="browser-connection-help"
            aria-invalid={props.errorMessage === null ? undefined : true}
          />
        </Field>
        <div {...stylex.props(styles.actions)}>
          <Button type="submit" variant="primary" size="sm">
            Connect
          </Button>
          <Button type="button" variant="neutral" size="sm" onClick={connectionActions.retry}>
            Retry
          </Button>
        </div>
      </form>
    </GateFrame>
  );
}

function UnreachableCard(props: { readonly errorMessage: string }): React.ReactElement {
  return (
    <GateFrame>
      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.titleRow)}>
          <StatusDot tone="err" />
          <Text size="base" weight="semibold">
            Couldn&apos;t reach this computer
          </Text>
        </div>
        <Text size="sm" tone="muted">
          {props.errorMessage}
        </Text>
        <div {...stylex.props(styles.actions)}>
          <Button type="button" variant="primary" size="sm" onClick={connectionActions.retry}>
            Retry
          </Button>
        </div>
      </div>
    </GateFrame>
  );
}

function PairingConfirmationCard(props: {
  readonly pairing: PendingConnectionPairing;
  readonly errorMessage: string | null;
}): React.ReactElement {
  return (
    <GateFrame>
      <div {...stylex.props(styles.card)}>
        <Text size="lg" weight="semibold">
          Connect this browser to {props.pairing.preview.name}?
        </Text>
        <Text
          role={props.errorMessage === null ? undefined : "alert"}
          size="sm"
          tone={props.errorMessage === null ? "muted" : "err"}
        >
          {props.errorMessage ?? "This browser can use this computer until you remove its access."}
        </Text>
        <Text size="xs" family="mono" tone="faint" style={{ overflowWrap: "anywhere" }}>
          {props.pairing.preview.origin}
        </Text>
        <div {...stylex.props(styles.actions)}>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => connectionActions.confirmPairing()}
          >
            {props.errorMessage === null ? "Connect browser" : "Try again"}
          </Button>
          <Button
            type="button"
            variant="neutral"
            size="sm"
            onClick={() => connectionActions.cancelPairing()}
          >
            Cancel
          </Button>
        </div>
      </div>
    </GateFrame>
  );
}

function GateByStatus(props: { readonly connection: ConnectionSnapshot }): React.ReactElement {
  switch (props.connection.status) {
    case "connecting":
      return <ConnectingSplash />;
    case "confirm-pairing":
      return (
        <PairingConfirmationCard
          pairing={props.connection.pairing}
          errorMessage={props.connection.errorMessage}
        />
      );
    case "requires-auth":
      return <RequiresAuthCard errorMessage={props.connection.errorMessage} />;
    case "unreachable":
      return <UnreachableCard errorMessage={props.connection.errorMessage} />;
    case "authenticated":
      // RootGate mounts AppShell for authenticated. This branch is unreachable there.
      return <ConnectingSplash />;
  }
}

export function RootGate(): React.ReactElement {
  const connection = useConnection();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Onboarding owns the whole window and asks nothing of the backend, so it
  // renders straight through the connection gate rather than making first run
  // wait behind a connecting splash.
  if (pathname === ONBOARDING_PATH) {
    return <Outlet />;
  }
  // The v2 harness talks only to the desktop main process, so it renders
  // without waiting for the backend connection.
  if (pathname === V2_PATH) {
    return <Outlet />;
  }
  if (connection.status === "authenticated") {
    return <AppShell />;
  }
  return <GateByStatus connection={connection} />;
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    const details = error.stack ?? error.message;
    return details.trim().length > 0 ? details : "No additional error details are available.";
  }
  if (typeof error === "string") {
    return error.trim().length > 0 ? error : "No additional error details are available.";
  }
  try {
    const details = JSON.stringify(error, null, 2);
    if (typeof details === "string" && details.trim().length > 0) {
      return details;
    }
    return "No additional error details are available.";
  } catch {
    return "No additional error details are available.";
  }
}

function StatusCard(props: {
  readonly title: string;
  readonly description: string;
  readonly details?: string;
  readonly actions: React.ReactNode;
}): React.ReactElement {
  const theme = useAppearanceTheme();
  return (
    <Shell material={shouldUseDesktopGlass() ? "glass" : "solid"} style={schemeStyles[theme]}>
      <ConnectionTitleBar />
      <Shell.Stage>
        <Shell.Sheet>
          <div {...stylex.props(styles.status)}>
            <div {...stylex.props(styles.statusCopy)}>
              <Text size="base" weight="semibold">
                {props.title}
              </Text>
              <Text size="sm" tone="muted">
                {props.description}
              </Text>
            </div>
            {props.details ? <pre {...stylex.props(styles.details)}>{props.details}</pre> : null}
            <div {...stylex.props(styles.actions)}>{props.actions}</div>
          </div>
        </Shell.Sheet>
      </Shell.Stage>
    </Shell>
  );
}

export function RootErrorView({ error }: ErrorComponentProps): React.ReactElement {
  const details = errorDetails(error);
  const [copyStatus, setCopyStatus] = React.useState<"idle" | "copied" | "failed">("idle");

  return (
    <StatusCard
      title="Something went wrong"
      description="An unexpected error occurred. Retry the connection or reload the window."
      details={details}
      actions={
        <>
          <Button type="button" variant="primary" size="sm" onClick={connectionActions.retry}>
            Retry
          </Button>
          <Button
            type="button"
            variant="neutral"
            size="sm"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={() => {
              const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard);
              if (writeText === undefined) {
                setCopyStatus("failed");
                return;
              }
              void writeText(details).then(
                () => setCopyStatus("copied"),
                () => setCopyStatus("failed"),
              );
            }}
          >
            {copyStatus === "copied"
              ? "Copied"
              : copyStatus === "failed"
                ? "Copy unavailable"
                : "Copy error"}
          </Button>
        </>
      }
    />
  );
}

export function RootNotFoundView(): React.ReactElement {
  const navigate = useNavigate();
  return (
    <StatusCard
      title="Page not found"
      description="The requested page could not be found."
      actions={
        <>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => {
              void navigate({ to: "/", replace: true });
            }}
          >
            Go home
          </Button>
          <Button
            type="button"
            variant="neutral"
            size="sm"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
        </>
      }
    />
  );
}
