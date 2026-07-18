// Connection gate surfaces. Lifecycle lives in connection-store. No useEffect here.

import * as stylex from "@stylexjs/stylex";
import { Button, Matrix, Shell, StatusDot, Text } from "@honk/ui";
import {
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import { type ErrorComponentProps, useNavigate } from "@tanstack/react-router";
import * as React from "react";

import { useAppearanceTheme } from "./appearance-store";
import {
  actions as connectionActions,
  useConnection,
  type ConnectionSnapshot,
} from "./connection-store";
import { readDesktopOnboardingWindowContext, shouldUseDesktopGlass } from "./desktop-bridge";
import { DesktopOnboarding } from "./onboarding";
import { AppShell } from "./shell";

// Wordmark is larger than the prose ramp's 16px cap, so its size stays a named intrinsic.
const SPLASH_WORDMARK_SIZE = "24px";
const HAIRLINE = "1px";
const FIELD_RING = `inset 0 0 0 ${HAIRLINE} ${colorVars["--honk-color-border-base"]}`;

const schemeStyles: Record<"system" | "light" | "dark", React.CSSProperties> = {
  system: { colorScheme: "light dark" },
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
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
    maxWidth: "320px",
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
  field: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: "36px",
    paddingBlock: controlVars["--honk-control-pad-sm"],
    paddingInline: controlVars["--honk-control-pad-md"],
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-control"],
    boxShadow: FIELD_RING,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-detail"],
    lineHeight: fontVars["--honk-leading-detail"],
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: HAIRLINE,
    "::placeholder": {
      color: colorVars["--honk-color-text-muted"],
    },
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

function GateFrame(props: {
  readonly children: React.ReactNode;
  readonly originChip?: string | null;
}): React.ReactElement {
  const theme = useAppearanceTheme();
  const trailing = props.originChip ? (
    <span data-shell-no-drag="">
      <Text size="xs" tone="muted" family="mono">
        {props.originChip}
      </Text>
    </span>
  ) : undefined;
  return (
    <Shell material={shouldUseDesktopGlass() ? "glass" : "solid"} style={schemeStyles[theme]}>
      <Shell.TitleBar trailing={trailing} />
      <Shell.Stage>
        <Shell.Sheet>
          <div {...stylex.props(styles.center, styles.centerFill)}>{props.children}</div>
        </Shell.Sheet>
      </Shell.Stage>
    </Shell>
  );
}

function ConnectingSplash(props: { readonly origin: string | null }): React.ReactElement {
  return (
    <GateFrame originChip={props.origin}>
      <div {...stylex.props(styles.splash)}>
        <Text
          size="xl"
          weight="semibold"
          style={{ fontSize: SPLASH_WORDMARK_SIZE, lineHeight: 1.1 }}
        >
          honk
        </Text>
        <Matrix isActive grid={6} style={{ color: colorVars["--honk-color-accent"] }} />
      </div>
    </GateFrame>
  );
}

function RequiresAuthCard(props: {
  readonly origin: string | null;
  readonly errorMessage: string | null;
}): React.ReactElement {
  // Uncontrolled. Submit reads the DOM so we never sync field state in an effect.
  const inputRef = React.useRef<HTMLInputElement>(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    connectionActions.submitToken(inputRef.current?.value ?? "");
  };

  return (
    <GateFrame originChip={props.origin}>
      <form {...stylex.props(styles.card)} onSubmit={onSubmit}>
        <Text size="lg" weight="semibold">
          honk
        </Text>
        <Text size="sm" tone="muted">
          {props.errorMessage ??
            "Paste a Honk pairing link or OpenCode password to attach this browser."}
        </Text>
        <input
          ref={inputRef}
          {...stylex.props(styles.field)}
          type="text"
          name="pairing-token"
          autoComplete="off"
          spellCheck={false}
          placeholder="paste pairing link or password…"
          aria-label="Pairing link or OpenCode password"
        />
        <div {...stylex.props(styles.actions)}>
          <Button type="submit" variant="primary" size="sm">
            Attach
          </Button>
          <Button type="button" variant="neutral" size="sm" onClick={connectionActions.retry}>
            Retry
          </Button>
        </div>
      </form>
    </GateFrame>
  );
}

function UnreachableCard(props: {
  readonly origin: string | null;
  readonly errorMessage: string | null;
}): React.ReactElement {
  return (
    <GateFrame originChip={props.origin}>
      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.titleRow)}>
          <StatusDot tone="err" />
          <Text size="base" weight="semibold">
            Couldn&apos;t reach the Honk host
          </Text>
        </div>
        <Text size="sm" tone="muted">
          {props.errorMessage ?? "Check that Honk and OpenCode are running, then retry."}
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

function GateByStatus(props: { readonly connection: ConnectionSnapshot }): React.ReactElement {
  switch (props.connection.status) {
    case "connecting":
      return <ConnectingSplash origin={props.connection.origin} />;
    case "requires-auth":
      return (
        <RequiresAuthCard
          origin={props.connection.origin}
          errorMessage={props.connection.errorMessage}
        />
      );
    case "unreachable":
      return (
        <UnreachableCard
          origin={props.connection.origin}
          errorMessage={props.connection.errorMessage}
        />
      );
    case "authenticated":
      // RootGate mounts AppShell for authenticated. This branch is unreachable there.
      return <ConnectingSplash origin={props.connection.origin} />;
  }
}

export function RootGate(): React.ReactElement {
  const connection = useConnection();
  const onboardingWindow = readDesktopOnboardingWindowContext();
  if (onboardingWindow !== null) {
    return <DesktopOnboarding isReplay={onboardingWindow.replay} />;
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

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    return;
  }
  await navigator.clipboard.writeText(value);
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
      <Shell.TitleBar />
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
  const [copied, setCopied] = React.useState(false);

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
              void copyText(details).then(() => {
                setCopied(true);
              });
            }}
          >
            {copied ? "Copied" : "Copy error"}
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
